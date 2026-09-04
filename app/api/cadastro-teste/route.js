// Auto-cadastro do teste de 30 dias.
//
// É o que fecha a venda sem intermediário: o advogado chega pela página do
// sistema, preenche quatro campos e o escritório dele nasce pronto — endereço
// próprio, conta de contratante, senha provisória por e-mail, sistema inteiro
// liberado por 30 dias. Ninguém do outro lado precisa fazer nada.
//
//   POST /api/cadastro-teste  { escritorio, nome, email, telefone?, subdominio? }
//
// Rota PÚBLICA e que CRIA COISAS — a combinação mais perigosa do sistema. Por
// isso os limites abaixo não são zelo excessivo, são o que impede um robô de
// encher o banco, o disco e o orçamento de IA numa madrugada:
//
//   - um escritório por e-mail, e nunca para quem já tem acesso;
//   - um cadastro por e-mail a cada hora (o repetido responde ok, para quem é
//     gente não descobrir que foi barrado);
//   - teto de cadastros por dia e de testes simultâneos, os dois em variável de
//     ambiente, porque o número certo só se descobre vendendo;
//   - subdomínio validado contra uma lista de nomes reservados: quem se cadastra
//     não pode escolher "www", "api" nem o endereço de um escritório que já existe.
//
// A senha provisória vai por e-mail e é obrigatória para entrar. Isso já faz as
// vezes de confirmação de endereço: quem não tem a caixa não entra, e nenhuma
// tela precisa ser construída para isso.

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { enviarEmailConta } from '../_lib/email-conta.js'
import { enviarEmailCore } from '../enviar-email/enviar.js'
import { LIMITES_TESTE, DIAS_TESTE, fimDoTeste } from '../_lib/planos.js'
import { VERSAO_TERMO } from '../../../lib/termo-uso.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const AVISAR = process.env.VENDAS_EMAIL || 'contato@djan.app.br'
const DOMINIO = (process.env.DOMINIO_BASE || 'djan.app.br').replace(/^\.+/, '')
const MAX_DIA = parseInt(process.env.TESTES_MAX_DIA, 10) || 5
const MAX_ATIVOS = parseInt(process.env.TESTES_MAX_ATIVOS, 10) || 25

// Nomes que não podem virar endereço de escritório: os do próprio produto, os
// de infraestrutura e os que se confundem com página oficial.
const RESERVADOS = new Set([
  'www', 'api', 'app', 'admin', 'painel', 'sistema', 'gestao', 'gestaojuridica',
  'cmp', 'cmpgestao', 'mail', 'smtp', 'imap', 'webmail', 'ftp', 'ns1', 'ns2',
  'teste', 'testes', 'demo', 'suporte', 'contato', 'blog', 'site', 'loja',
  'assinar', 'assinatura', 'cliente', 'clientes', 'inquilinos', 'vendas', 'status',
])

const LIM = { escritorio: 120, nome: 120, email: 160, telefone: 40, subdominio: 40 }
const corta = (v, max) => String(v == null ? '' : v).trim().slice(0, max)
const emailValido = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || '').trim())

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// Senha provisória legível ao telefone: sem 0/O nem 1/l, que viram confusão na
// hora de ditar. Mesma regra do painel-mãe.
function senhaProvisoria() {
  const alfabeto = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const bytes = crypto.randomBytes(10)
  let s = ''
  for (let i = 0; i < 10; i++) s += alfabeto[bytes[i] % alfabeto.length]
  return s
}

// "Silva & Souza Advogados Associados" -> "silvaesouza"
function apelido(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, 'e')
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 24)
}

// Endereço livre a partir do apelido. Se estiver ocupado, tenta com número —
// nunca devolve o endereço de outro escritório, que seria mandar o cliente
// novo para a porta de um cliente antigo.
async function enderecoLivre(sb, base) {
  let raiz = apelido(base)
  if (raiz.length < 3) raiz = 'escritorio' + crypto.randomBytes(2).toString('hex')
  if (RESERVADOS.has(raiz)) raiz = raiz + 'adv'
  for (let i = 0; i < 30; i++) {
    const sub = i === 0 ? raiz : raiz + (i + 1)
    const host = sub + '.' + DOMINIO
    const { data } = await sb.from('escritorios').select('id').contains('hosts', [host]).maybeSingle()
    if (!data) return { sub, host }
  }
  return null
}

export async function POST(request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ erro: 'servidor sem chave de serviço' }, { status: 500 })
  }
  let body = {}
  try { body = await request.json() } catch (e) {}

  const escritorio = corta(body.escritorio, LIM.escritorio)
  const nome = corta(body.nome, LIM.nome)
  const email = corta(body.email, LIM.email).toLowerCase()
  const telefone = corta(body.telefone, LIM.telefone)

  if (escritorio.length < 3) return Response.json({ erro: 'Informe o nome do escritório.' }, { status: 400 })
  if (nome.length < 3) return Response.json({ erro: 'Informe o seu nome.' }, { status: 400 })
  if (!emailValido(email)) return Response.json({ erro: 'Informe um e-mail válido.' }, { status: 400 })

  // Aceite do termo. Conferido no SERVIDOR, e não só pela caixa de marcar da
  // tela: o que a tela obriga, uma requisição direta contorna — e um aceite que
  // se contorna não prova nada. O escritório que entra aqui vai guardar dados
  // de clientes de terceiros, sob sigilo profissional; sem instrumento, o
  // fornecedor fica com a guarda e sem o contrato que a autoriza.
  if (body.aceite !== true) {
    return Response.json({ erro: 'É preciso aceitar o Termo de Uso e de Tratamento de Dados para começar.' }, { status: 400 })
  }
  // De onde veio o aceite. Atrás do Caddy, o endereço real está no cabeçalho —
  // sem isto, todo aceite ficaria registrado como vindo de 127.0.0.1.
  const ip = String(request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null
  const navegador = String(request.headers.get('user-agent') || '').slice(0, 300) || null

  const sb = admin()

  // ---- quem já tem acesso não cria escritório novo ------------------------
  // Sem esta conferência, quem já é cliente (ou funcionário de um) criaria um
  // escritório paralelo e levaria consigo o próprio login.
  const { data: jaUsuario } = await sb.from('usuarios').select('id').eq('email', email).maybeSingle()
  if (jaUsuario) {
    return Response.json({
      erro: 'Este e-mail já tem acesso ao sistema. Entre com ele, ou use "esqueci a senha".',
      ja_tem: true,
    }, { status: 409 })
  }

  // ---- repetição: duplo clique ou robô ------------------------------------
  try {
    const desde = new Date(Date.now() - 60 * 60000).toISOString()
    const { data: ja } = await sb.from('crm_leads')
      .select('id').eq('email', email).eq('canal', 'auto-cadastro teste').gte('criado_em', desde).limit(1)
    if (ja && ja.length) return Response.json({ ok: true, repetido: true })
  } catch (e) {}

  // ---- tetos de volume ----------------------------------------------------
  // Estes números protegem disco, banco e orçamento de IA. Estourá-los não é
  // erro do visitante: a resposta convida a falar com quem vende, em vez de
  // dizer "não" e perder o interessado.
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
  const { count: hojeCount } = await sb.from('escritorios')
    .select('id', { count: 'exact', head: true }).gte('criado_em', hoje.toISOString())
  const { count: ativosCount } = await sb.from('escritorios')
    .select('id', { count: 'exact', head: true }).not('teste_ate', 'is', null).eq('ativo', true)

  if ((hojeCount || 0) >= MAX_DIA || (ativosCount || 0) >= MAX_ATIVOS) {
    try {
      await sb.from('crm_leads').insert({
        nome, email, tel: telefone || null,
        canal: 'auto-cadastro teste', estagio: 'novo', prioridade: 'alta',
        obs: 'FILA DE ESPERA — teto de testes atingido. Escritório: ' + escritorio,
        capturado_em: new Date().toISOString(), ultima_atividade: new Date().toISOString(),
      })
    } catch (e) {}
    try {
      await enviarEmailCore({
        para: AVISAR,
        assunto: 'Teste NÃO criado (teto atingido) — ' + escritorio,
        corpo: 'Alguém tentou abrir um teste e o teto foi atingido.\n\n' +
          'Escritório: ' + escritorio + '\nNome: ' + nome + '\nE-mail: ' + email +
          (telefone ? ('\nTelefone: ' + telefone) : '') +
          '\n\nTestes ativos: ' + (ativosCount || 0) + ' (teto ' + MAX_ATIVOS + ')' +
          '\nCriados hoje: ' + (hojeCount || 0) + ' (teto ' + MAX_DIA + ')' +
          '\n\nO interessado está no Comercial como lead novo.',
        dedup: false, convidarApp: false, escritorioId: null,
      })
    } catch (e) {}
    return Response.json({
      ok: true, fila: true,
      mensagem: 'Recebemos o seu pedido. Estamos abrindo os testes por ordem de chegada — ' +
                'você recebe o acesso por e-mail em breve.',
    })
  }

  // ---- endereço -----------------------------------------------------------
  const pedido = apelido(body.subdominio || '')
  const base = pedido && !RESERVADOS.has(pedido) ? pedido : escritorio
  const end = await enderecoLivre(sb, base)
  if (!end) return Response.json({ erro: 'Não consegui reservar um endereço. Fale com a gente.' }, { status: 409 })

  // ---- cria o escritório --------------------------------------------------
  const teste_ate = fimDoTeste(DIAS_TESTE)
  const { data: esc, error: e1 } = await sb.from('escritorios').insert({
    nome: escritorio,
    subdominio: end.sub,
    hosts: [end.host],
    plano: 'teste',
    ativo: true,
    raiz: false,
    ...LIMITES_TESTE,
    teste_ate,
    // Nulo = todos os módulos ligados. O teste é do sistema INTEIRO: quem testa
    // metade não compra. O que segura o custo é o teto, não o portão.
    modulos: null,
  }).select('id,nome').single()
  if (e1) return Response.json({ erro: 'Não consegui criar agora. Tente de novo em instantes.' }, { status: 500 })

  // ---- conta do contratante ----------------------------------------------
  const senha = senhaProvisoria()
  const novo = await sb.auth.admin.createUser({ email, password: senha, email_confirm: true })
  if (novo.error) {
    // não deixa escritório órfão no banco se a conta não nascer
    await sb.from('escritorios').delete().eq('id', esc.id)
    return Response.json({ erro: 'Não consegui criar a conta com este e-mail.' }, { status: 400 })
  }
  const uid = novo.data.user.id
  const { error: e2 } = await sb.from('usuarios').insert({
    id: uid, escritorio_id: esc.id, nome, email,
    papel: 'contratante', trocar_senha: true, ativo: true,
  })
  if (e2) {
    await sb.auth.admin.deleteUser(uid).catch(() => {})
    await sb.from('escritorios').delete().eq('id', esc.id)
    return Response.json({ erro: 'Não consegui criar a conta agora.' }, { status: 500 })
  }

  // ---- registro do aceite -------------------------------------------------
  // Gravado depois de o escritório existir, para a linha já nascer ligada a
  // ele. Falha aqui NÃO desfaz o cadastro: o aceite também é reconstituível
  // pelo e-mail e pela data, e derrubar um cliente novo por causa do registro
  // seria trocar um problema pequeno por um grande.
  try {
    await sb.from('aceites_termo').insert({
      escritorio_id: esc.id, nome, email,
      versao: VERSAO_TERMO, ip, navegador, origem: 'auto-cadastro',
    })
  } catch (e) {}

  // ---- e-mail de boas-vindas ---------------------------------------------
  // O que este e-mail NÃO diz: quantos processos, acessos e GB cabem no teste.
  // Número de teto na primeira mensagem soa como aviso de que vai faltar, e o
  // teste existe para mostrar o sistema, não para negociar limite. Quando o
  // limite chegar, a própria tela avisa e propõe a contratação.
  const envio = await enviarEmailConta({
    para: email,
    assunto: 'Seu acesso de teste — ' + escritorio,
    titulo: 'Seu sistema já está no ar',
    linhas: [
      'Olá, ' + nome.replace(/</g, '&lt;') + '.',
      'O sistema do escritório <b>' + escritorio.replace(/</g, '&lt;') + '</b> está pronto em <b>' + end.host + '</b>.',
      'Entre com o e-mail <b>' + email + '</b> e a senha provisória abaixo:',
      '<b style="font-size:22px;letter-spacing:2px">' + senha + '</b>',
      'No primeiro acesso o sistema pede uma senha nova, só sua. A provisória deixa de valer nesse momento.',
      'Você tem <b>' + DIAS_TESTE + ' dias</b> com o sistema inteiro liberado. Ao contratar, <b>nada é apagado</b>: o que você cadastrar no teste continua exatamente onde está.',
      'Primeiro passo sugerido: em ⚙, cadastre as <b>inscrições na OAB</b> do escritório. É por elas que o robô do Diário de Justiça começa a trazer as suas publicações.',
      'Você aceitou o <a href="https://' + end.host + '/termos">Termo de Uso e de Tratamento de Dados</a> (versão ' + VERSAO_TERMO + ') no cadastro. Guarde este e-mail: ele é o seu comprovante.',
    ],
    botao: { texto: 'Entrar no sistema', url: 'https://' + end.host },
  })

  // ---- avisa quem vende, e registra no Comercial --------------------------
  // O escritório já existe; daqui para baixo, falha nenhuma pode virar erro
  // para quem se cadastrou — ele fez a parte dele.
  try {
    await sb.from('crm_leads').insert({
      nome, email, tel: telefone || null,
      // 'novo' e não 'teste': o Kanban do Comercial tem colunas fixas, e um
      // estágio que ele não conhece deixaria o lead invisível na tela.
      canal: 'auto-cadastro teste', estagio: 'novo', prioridade: 'alta',
      obs: 'Teste aberto sozinho pelo site. Escritório: ' + escritorio +
           ' · ' + end.host + ' · vence em ' + teste_ate,
      capturado_em: new Date().toISOString(), ultima_atividade: new Date().toISOString(),
    })
  } catch (e) {}
  try {
    await enviarEmailCore({
      para: AVISAR,
      assunto: 'Novo teste aberto — ' + escritorio,
      corpo:
        'Um escritório abriu o teste de ' + DIAS_TESTE + ' dias pelo site, sozinho.\n\n' +
        'Escritório: ' + escritorio + '\n' +
        'Responsável: ' + nome + '\n' +
        'E-mail: ' + email + '\n' +
        (telefone ? ('Telefone: ' + telefone + '\n') : '') +
        'Endereço: https://' + end.host + '\n' +
        'Teste até: ' + teste_ate + '\n' +
        (envio && envio.ok ? '' : 'ATENÇÃO: o e-mail de boas-vindas NÃO saiu. Senha provisória: ' + senha + '\n') +
        '\nEle aparece em /inquilinos marcado como "em teste", e no Comercial como lead.\n' +
        'Sua parte: contrato e cobrança, na hora em que ele contratar.',
      dedup: false, convidarApp: false, escritorioId: null,
    })
  } catch (e) {}

  return Response.json({
    ok: true,
    host: end.host,
    url: 'https://' + end.host,
    teste_ate,
    email_enviado: !!(envio && envio.ok),
  })
}
