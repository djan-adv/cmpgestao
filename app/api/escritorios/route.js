// Painel-mãe — cadastro dos escritórios que contratam o sistema.
//
// É a rota que faltava para vender: até aqui um escritório novo só existia
// rodando SQL na mão. Aqui o dono do sistema cria o inquilino, define plano e
// limites, e a conta do contratante nasce junto — com senha provisória, que o
// contratante troca no primeiro acesso. Quem gera a senha não fica sabendo dela
// depois: é o que impede o fornecedor de entrar na conta de um escritório de
// advocacia e ver processo de cliente alheio.
//
//   POST /api/escritorios  (Authorization: Bearer <jwt>)
//     { acao:'criar',   nome, host, email_contratante, nome_contratante,
//       plano, limite_acessos, limite_processos, limite_gb }
//     { acao:'listar' }
//     { acao:'limites', id, ... }   -> muda plano/limites de um escritório
//     { acao:'ativar' | 'desativar', id }
//
// Só o escritório RAIZ (o dono do sistema) entra aqui. Um contratante manda no
// próprio escritório pela rota /api/acessos, não nesta.

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { enviarEmailConta } from '../_lib/email-conta.js'
import { PLANOS, limitesDoPlano, plano } from '../_lib/planos.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY

function admin() {
  return createClient(SB_URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })
}

// Quem pode mexer aqui: usuário do escritório marcado como raiz. Sem lista de
// e-mails no código — era assim que o sistema ficava preso ao nome do dono.
//
// Devolve { user } ou { motivo }. A separação importa: antes, sessão vencida e
// falta de permissão davam a MESMA resposta, e a tela dizia "esta tela é do
// escritório que administra o sistema" para quem só precisava entrar de novo.
async function donoDoSistema(request) {
  const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return { motivo: 'sem_sessao' }
  const { data } = await createClient(SB_URL, ANON).auth.getUser(jwt)
  const user = (data && data.user) || null
  if (!user) return { motivo: 'sem_sessao' }
  const sb = admin()
  const { data: perfil } = await sb
    .from('usuarios').select('escritorio_id, escritorios!inner(raiz)')
    .eq('id', user.id).maybeSingle()
  if (!perfil || !perfil.escritorios || perfil.escritorios.raiz !== true) return { motivo: 'sem_permissao' }
  return { user }
}

// Senha provisória legível ao telefone: sem 0/O nem 1/l, que viram confusão na
// hora de ditar. 10 caracteres de aleatoriedade criptográfica.
function senhaProvisoria() {
  const alfabeto = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const bytes = crypto.randomBytes(10)
  let s = ''
  for (let i = 0; i < 10; i++) s += alfabeto[bytes[i] % alfabeto.length]
  return s
}

function hostLimpo(h) {
  return String(h || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '')
}

function emailValido(e) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || '').trim()) }

export async function POST(request) {
  if (!SERVICE) return Response.json({ erro: 'servidor sem SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })
  const quem = await donoDoSistema(request)
  if (quem.motivo === 'sem_sessao') {
    return Response.json({ erro: 'Sua sessão expirou. Entre novamente.', sessao_expirada: true }, { status: 401 })
  }
  if (!quem.user) return Response.json({ erro: 'Só o escritório raiz administra inquilinos.' }, { status: 403 })
  const dono = quem.user

  let body = {}
  try { body = await request.json() } catch (e) {}
  const acao = String(body.acao || 'listar')
  const sb = admin()

  try {
    if (acao === 'listar') {
      const { data, error } = await sb
        .from('escritorios')
        .select('id,nome,subdominio,hosts,plano,plano_codigo,ativo,raiz,limite_acessos,limite_processos,limite_gb,mensalidade,desconto,pausa_ate,suspenso_em,suspenso_motivo,observacoes,criado_em')
        .order('criado_em', { ascending: true })
      if (error) throw new Error(error.message)
      // quantos acessos e quantos processos cada um já usa (para mostrar o
      // consumo ao lado do limite — é o que sustenta a venda de mais assentos)
      const ids = (data || []).map(e => e.id)
      const uso = {}
      for (const id of ids) {
        const u = await sb.from('usuarios').select('id', { count: 'exact', head: true }).eq('escritorio_id', id)
        const p = await sb.from('processos').select('id', { count: 'exact', head: true }).eq('escritorio_id', id)
        uso[id] = { acessos: u.count || 0, processos: p.count || 0 }
      }
      return Response.json({ ok: true, planos: PLANOS, escritorios: (data || []).map(e => ({ ...e, uso: uso[e.id] })) })
    }

    if (acao === 'criar') {
      const nome = String(body.nome || '').trim()
      const host = hostLimpo(body.host)
      const email = String(body.email_contratante || '').trim().toLowerCase()
      const nomeContratante = String(body.nome_contratante || '').trim()
      if (!nome) return Response.json({ erro: 'Informe o nome do escritório.' }, { status: 400 })
      if (!host) return Response.json({ erro: 'Informe o endereço (ex.: jose.djan.app.br).' }, { status: 400 })
      if (!emailValido(email)) return Response.json({ erro: 'E-mail do contratante inválido.' }, { status: 400 })
      if (!nomeContratante) return Response.json({ erro: 'Informe o nome do contratante.' }, { status: 400 })

      // endereço é a chave de entrada: dois escritórios no mesmo endereço
      // significaria mandar o cliente para os dados do outro.
      const { data: jaHost } = await sb.from('escritorios').select('id,nome').contains('hosts', [host]).maybeSingle()
      if (jaHost) return Response.json({ erro: 'O endereço ' + host + ' já é de "' + jaHost.nome + '".' }, { status: 409 })

      // a conta de e-mail não pode já existir em outro escritório
      const { data: jaUser } = await sb.from('usuarios').select('id,escritorio_id').eq('email', email).maybeSingle()
      if (jaUser) return Response.json({ erro: 'Este e-mail já tem acesso ao sistema.' }, { status: 409 })

      const sub = host.split('.')[0]
      const { data: esc, error: e1 } = await sb.from('escritorios').insert({
        nome,
        subdominio: sub,
        hosts: [host],
        plano: String(body.plano || 'teste'),
        plano_codigo: body.plano_codigo || null,
        mensalidade: body.mensalidade == null || body.mensalidade === '' ? null : Number(body.mensalidade),
        ativo: true,
        raiz: false,
        // Nulo = sem teto. Os primeiros clientes entram com o sistema inteiro
        // liberado; restringir depois é editar estes campos, não mexer no código.
        limite_acessos: body.limite_acessos == null ? null : parseInt(body.limite_acessos, 10),
        limite_processos: body.limite_processos == null ? null : parseInt(body.limite_processos, 10),
        limite_gb: body.limite_gb == null ? null : Number(body.limite_gb),
        modulos: null,
        criado_em_por: dono.id,
      }).select('id,nome').single()
      if (e1) throw new Error(e1.message)

      // conta do contratante, com senha provisória
      const senha = senhaProvisoria()
      const novo = await sb.auth.admin.createUser({
        email, password: senha, email_confirm: true,
      })
      if (novo.error) {
        // não deixa escritório órfão no banco se a conta não nascer
        await sb.from('escritorios').delete().eq('id', esc.id)
        return Response.json({ erro: 'Não criei a conta: ' + novo.error.message }, { status: 400 })
      }
      const uid = novo.data.user.id
      const { error: e2 } = await sb.from('usuarios').insert({
        id: uid, escritorio_id: esc.id, nome: nomeContratante, email,
        papel: 'contratante', trocar_senha: true, ativo: true, criado_por: dono.id,
      })
      if (e2) {
        await sb.auth.admin.deleteUser(uid).catch(() => {})
        await sb.from('escritorios').delete().eq('id', esc.id)
        throw new Error(e2.message)
      }

      const envio = await enviarEmailConta({
        para: email,
        assunto: 'Seu acesso ao sistema — ' + nome,
        titulo: 'Seu acesso está pronto',
        linhas: [
          'Olá, ' + escaparTexto(nomeContratante) + '.',
          'O sistema do escritório <b>' + escaparTexto(nome) + '</b> já está no ar em <b>' + host + '</b>.',
          'Entre com o e-mail <b>' + escaparTexto(email) + '</b> e a senha provisória abaixo:',
          '<b style="font-size:22px;letter-spacing:2px">' + senha + '</b>',
          'No primeiro acesso o sistema pede uma senha nova, só sua. A provisória deixa de valer nesse momento.',
        ],
        botao: { texto: 'Entrar no sistema', url: 'https://' + host },
      })

      return Response.json({
        ok: true,
        escritorio: esc,
        contratante: { email, nome: nomeContratante },
        // A senha volta na tela porque o e-mail pode não sair (SMTP fora do ar,
        // caixa cheia) e o cliente estar esperando do outro lado da linha.
        senha_provisoria: senha,
        email_enviado: !!envio.ok,
        email_erro: envio.erro || null,
      })
    }

    if (acao === 'limites') {
      const id = String(body.id || '')
      if (!id) return Response.json({ erro: 'id ausente' }, { status: 400 })
      const patch = {}
      if ('plano' in body) patch.plano = String(body.plano || 'teste')
      if ('limite_acessos' in body) patch.limite_acessos = body.limite_acessos == null ? null : parseInt(body.limite_acessos, 10)
      if ('limite_processos' in body) patch.limite_processos = body.limite_processos == null ? null : parseInt(body.limite_processos, 10)
      if ('limite_gb' in body) patch.limite_gb = body.limite_gb == null ? null : Number(body.limite_gb)
      if ('host_novo' in body && body.host_novo) {
        const h = hostLimpo(body.host_novo)
        const { data: dono2 } = await sb.from('escritorios').select('id,nome').contains('hosts', [h]).maybeSingle()
        if (dono2 && dono2.id !== id) return Response.json({ erro: 'Endereço já usado por "' + dono2.nome + '".' }, { status: 409 })
        const { data: atual } = await sb.from('escritorios').select('hosts').eq('id', id).single()
        const lista = Array.from(new Set([...(atual.hosts || []), h]))
        patch.hosts = lista
      }
      const { error } = await sb.from('escritorios').update(patch).eq('id', id)
      if (error) throw new Error(error.message)
      return Response.json({ ok: true })
    }

    // Plano, valor, desconto e pausa. Tudo cadastro: mudar oferta ou preço não
    // pode virar deploy, e quem já assinou mantém o que assinou.
    if (acao === 'comercial') {
      const id = String(body.id || '')
      if (!id) return Response.json({ erro: 'id ausente' }, { status: 400 })
      const patch = {}
      if ('mensalidade' in body) patch.mensalidade = body.mensalidade === '' || body.mensalidade == null ? null : Number(body.mensalidade)
      if ('desconto' in body) patch.desconto = body.desconto === '' || body.desconto == null ? null : Number(body.desconto)
      if ('pausa_ate' in body) patch.pausa_ate = body.pausa_ate || null
      if ('observacoes' in body) patch.observacoes = String(body.observacoes || '')
      if (body.plano_codigo) {
        const lim = limitesDoPlano(body.plano_codigo)
        if (!lim) return Response.json({ erro: 'Plano desconhecido: ' + body.plano_codigo }, { status: 400 })
        // os limites do degrau são COPIADOS agora; o plano pode mudar depois
        // sem alterar quem já está dentro
        Object.assign(patch, lim)
        // O preço de tabela só entra quando o escritório ainda NÃO tem
        // mensalidade e o operador não digitou uma. Trocar o degrau de quem já
        // negociou desconto não pode devolvê-lo ao preço cheio sem ninguém
        // mandar — e nem sempre se percebe, porque a tela não pergunta.
        if (!('mensalidade' in body)) {
          const { data: atual } = await sb.from('escritorios').select('mensalidade').eq('id', id).maybeSingle()
          if (!atual || atual.mensalidade == null) {
            const p = plano(body.plano_codigo)
            if (p && p.preco_mensal) patch.mensalidade = p.preco_mensal
          }
        }
      }
      if (!Object.keys(patch).length) return Response.json({ erro: 'nada a alterar' }, { status: 400 })
      const { error } = await sb.from('escritorios').update(patch).eq('id', id)
      if (error) throw new Error(error.message)
      return Response.json({ ok: true })
    }

    // Suspender é o oposto de excluir: o acervo fica intacto, o acesso para.
    // Para escritório de advocacia, apagar é destruir processo com prazo
    // correndo dentro — por isso a saída padrão é esta.
    if (acao === 'suspender' || acao === 'reativar') {
      const id = String(body.id || '')
      if (!id) return Response.json({ erro: 'id ausente' }, { status: 400 })
      const { data: alvo } = await sb.from('escritorios').select('raiz,nome').eq('id', id).maybeSingle()
      if (!alvo) return Response.json({ erro: 'Escritório não encontrado.' }, { status: 404 })
      if (alvo.raiz) return Response.json({ erro: 'O escritório que administra o sistema não pode ser suspenso.' }, { status: 400 })
      const suspender = acao === 'suspender'
      const { error } = await sb.from('escritorios').update({
        ativo: !suspender,
        suspenso_em: suspender ? new Date().toISOString() : null,
        suspenso_motivo: suspender ? String(body.motivo || '') : null,
      }).eq('id', id)
      if (error) throw new Error(error.message)
      return Response.json({ ok: true, escritorio: alvo.nome })
    }

    // Excluir só o que nunca foi usado. Um escritório com processo dentro não
    // se apaga por clique: suspende. O engano aqui não tem desfazer.
    if (acao === 'excluir') {
      const id = String(body.id || '')
      if (!id) return Response.json({ erro: 'id ausente' }, { status: 400 })
      const { data: alvo } = await sb.from('escritorios').select('raiz,nome').eq('id', id).maybeSingle()
      if (!alvo) return Response.json({ erro: 'Escritório não encontrado.' }, { status: 404 })
      if (alvo.raiz) return Response.json({ erro: 'O escritório que administra o sistema não pode ser excluído.' }, { status: 400 })
      const { count: procs } = await sb.from('processos').select('id', { count: 'exact', head: true }).eq('escritorio_id', id)
      if (procs) {
        return Response.json({
          erro: 'Este escritório tem ' + procs + ' processo(s). Escritório com acervo não é excluído — use Suspender. ' +
                'Apagar aqui levaria junto prazo e documento de processo em andamento.',
          tem_acervo: true,
        }, { status: 409 })
      }
      // as contas de acesso somem junto (usuarios cai em cascata pelo auth)
      const { data: pessoas } = await sb.from('usuarios').select('id').eq('escritorio_id', id)
      for (const u of pessoas || []) { try { await sb.auth.admin.deleteUser(u.id) } catch (e) {} }
      const { error } = await sb.from('escritorios').delete().eq('id', id)
      if (error) throw new Error(error.message)
      return Response.json({ ok: true, excluido: alvo.nome })
    }

    // Faturas da mensalidade.
    if (acao === 'faturas') {
      const id = String(body.id || '')
      if (!id) return Response.json({ erro: 'id ausente' }, { status: 400 })
      const { data, error } = await sb.from('faturas').select('*').eq('escritorio_id', id).order('competencia', { ascending: false })
      if (error) throw new Error(error.message)
      return Response.json({ ok: true, faturas: data || [] })
    }

    if (acao === 'fatura_criar') {
      const id = String(body.id || '')
      const competencia = String(body.competencia || '').trim()   // '2026-09'
      if (!id || !/^\d{4}-\d{2}$/.test(competencia)) {
        return Response.json({ erro: 'Informe o escritório e a competência (AAAA-MM).' }, { status: 400 })
      }
      const { data: esc } = await sb.from('escritorios').select('mensalidade,desconto,pausa_ate,nome').eq('id', id).maybeSingle()
      if (!esc) return Response.json({ erro: 'Escritório não encontrado.' }, { status: 404 })
      // Pausa combinada não gera fatura: é o ponto de ter pausa. Sem esta
      // conferência, a cobrança sairia assim mesmo e o cliente receberia
      // boleto do mês que você isentou.
      if (esc.pausa_ate && competencia <= String(esc.pausa_ate).slice(0, 7)) {
        return Response.json({ erro: 'A cobrança deste escritório está pausada até ' + esc.pausa_ate + '.' }, { status: 409 })
      }
      const valorBase = body.valor == null || body.valor === '' ? esc.mensalidade : Number(body.valor)
      if (valorBase == null) return Response.json({ erro: 'Defina a mensalidade do escritório antes de gerar fatura.' }, { status: 400 })
      const valor = Math.max(0, Number(valorBase) - Number(esc.desconto || 0))
      const vencimento = String(body.vencimento || '') || (competencia + '-10')
      const { data, error } = await sb.from('faturas').insert({
        escritorio_id: id, competencia, valor, vencimento,
        status: 'aberta', observacao: String(body.observacao || '') || null,
      }).select('*').single()
      if (error) {
        if (String(error.code) === '23505') return Response.json({ erro: 'Já existe fatura para ' + competencia + '.' }, { status: 409 })
        throw new Error(error.message)
      }
      return Response.json({ ok: true, fatura: data })
    }

    if (acao === 'fatura_status') {
      const fid = String(body.fatura_id || '')
      const status = String(body.status || '')
      if (!fid || !['aberta', 'paga', 'cancelada', 'isenta'].includes(status)) {
        return Response.json({ erro: 'Informe a fatura e um status válido.' }, { status: 400 })
      }
      const { error } = await sb.from('faturas').update({
        status, pago_em: status === 'paga' ? new Date().toISOString() : null,
      }).eq('id', fid)
      if (error) throw new Error(error.message)
      return Response.json({ ok: true })
    }

    if (acao === 'ativar' || acao === 'desativar') {
      const id = String(body.id || '')
      if (!id) return Response.json({ erro: 'id ausente' }, { status: 400 })
      const { data: alvo } = await sb.from('escritorios').select('raiz').eq('id', id).maybeSingle()
      if (alvo && alvo.raiz) return Response.json({ erro: 'O escritório raiz não pode ser desativado.' }, { status: 400 })
      const { error } = await sb.from('escritorios').update({ ativo: acao === 'ativar' }).eq('id', id)
      if (error) throw new Error(error.message)
      return Response.json({ ok: true })
    }

    return Response.json({ erro: 'ação desconhecida: ' + acao }, { status: 400 })
  } catch (e) {
    return Response.json({ erro: String((e && e.message) || e) }, { status: 500 })
  }
}

function escaparTexto(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
