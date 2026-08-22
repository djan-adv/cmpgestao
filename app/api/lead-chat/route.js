// Chat público de captação — cliente novo, sem processo ainda.
// Usado pela página pública app/cliente (gestao.cmpadvogados.com.br/cliente):
// sem login, aberta a qualquer pessoa (link pro site ou mandado direto).
//
// Grava direto em crm_leads (o mesmo funil que a equipe já usa), em etapas —
// nome, mensagem, e-mail, telefone — puxadas pela conversa. O "proc_ref"
// guarda uma referência curta (data/hora) que aparece pro visitante; assim
// que e-mail E WhatsApp chegam, um CASO já é aberto em `processos` (mesma
// numeração automática ano.mes.dia.horaminuto usada no cadastro manual do
// sistema — sem risco de duplicidade) e o proc_ref passa a ser esse número.
//
// Sem chave/segredo: é EXATAMENTE o mesmo modelo de acesso que leads_publicos
// já usa (INSERT liberado pro anon) — só que passando pela API (em vez do
// client direto) porque crm_leads não é gravável por anon, e porque aqui
// precisamos de UPDATE incremental por id (leads_publicos só aceita INSERT).
//
//   POST { acao:'criar', origem_url, nome?, email? }                        -> { ok, id, ref }
//   POST { acao:'atualizar', id, nome?, email?, tel?, mensagem?, arquivo? } -> { ok }
//   POST { acao:'msg', id, de:'user'|'bot', texto }                         -> { ok }
//   POST { acao:'concluir', id }                                            -> { ok, numero }
//   POST { acao:'responder', id, mensagem }                                 -> { ok, resposta? , humano? }
//   POST { acao:'sincronizar', id, desde }                                  -> { ok, conversa: novas_entradas }
//
// Atendimento humano (pedido do dono, 20/08/2026): a equipe pode assumir a
// conversa a qualquer momento pela ficha do lead no sistema (grava direto em
// crm_leads.conversa, com de:'staff') — enquanto tiver uma entrada 'staff'
// recente (HUMANO_JANELA_MIN), a IA para de responder ESTE lead sozinha; os
// demais leads simultâneos continuam com a IA normalmente. Sem novidade do
// staff por um tempo, a IA retoma sozinha.

import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { enviarEmailCore } from '../enviar-email/enviar.js'
import { chamarClaude } from '../_ia/claude.js'

// Base de perguntas/respostas fornecida pelo escritório (28 pares — 15
// trabalhistas, 13 imobiliários), lida uma vez e mantida em texto fixo pro
// bloco cacheado do system (é a MESMA base pra toda conversa — por isso NÃO
// entra no bloco variável). Percentual de retenção, prazo de prescrição,
// precedentes/jurisprudência e valores de honorários foram deixados de fora
// DE PROPÓSITO nesses textos — a regra em SISTEMA_ATENDIMENTO_CHAT_SITE
// proíbe a IA de inventar esses números.
function baseAtendimentoTexto() {
  try {
    const p = path.join(process.cwd(), 'app', 'api', 'lead-chat', 'atendimento-cmp.json')
    const base = JSON.parse(fs.readFileSync(p, 'utf8'))
    return (base.itens || []).map(it => '### ' + it.tema + '\nP: ' + it.pergunta + '\nR: ' + it.resposta).join('\n\n')
  } catch (e) { return '' }
}
const BASE_TEXTO = baseAtendimentoTexto()

// Prompt FIXO (byte a byte idêntico em toda chamada — vai no `system` com
// cache_control, regra do CLAUDE.md). Pedido do dono (20/08/2026): o
// atendimento deve soar como uma PESSOA da equipe, não como um robô/IA — sem
// se identificar como assistente virtual, sem jargão de bot.
const SISTEMA_ATENDIMENTO_CHAT_SITE =
  'Você está atendendo pelo chat do site do escritório Crispim, Mendonça e Pinheiro Advogados (CMP), como se fosse alguém da equipe respondendo.\n\n' +
  'Esta pessoa já forneceu nome, e-mail e WhatsApp, e um atendimento já foi aberto no sistema do escritório — a conversa está em fase de contratação.\n\n' +
  'COMO FALAR:\n' +
  '- Fale como uma pessoa de verdade da equipe, não como um robô ou "assistente virtual" — nunca se descreva como IA, bot ou sistema automatizado, nem use frases como "sou um assistente".\n' +
  '- Português do Brasil, tom acolhedor e direto, respostas CURTAS (1 a 3 frases, formato de chat/WhatsApp).\n' +
  '- Não repita perguntas que a pessoa já respondeu nesta conversa.\n' +
  '- Responda em texto puro, sem markdown, sem aspas ao redor da resposta.\n\n' +
  'BASE DE PERGUNTAS E RESPOSTAS DO ESCRITÓRIO (trabalhista e imobiliário) — use como referência de conteúdo e de tom sempre que o assunto do cliente casar com algum destes temas; adapte a redação ao que a pessoa perguntou, não copie a resposta pronta se não fizer sentido:\n\n' +
  BASE_TEXTO + '\n\n' +
  'REGRAS DURAS (nunca quebrar):\n' +
  '- NUNCA informe percentual de retenção, prazo de prescrição específico, precedente/jurisprudência ou valor de honorários que não esteja EXPLICITAMENTE escrito na base acima. Se perguntarem algum desses números, diga que isso é avaliado no caso concreto, na análise com o advogado — não estime, não arredonde, não "dê uma ideia".\n' +
  '- NUNCA dê parecer jurídico, prognóstico de resultado ou prazo processual — isso só o advogado responsável define.\n' +
  '- Nunca invente informação sobre o escritório que não esteja nas instruções acima.\n' +
  '- Sempre que fizer sentido, reforce que dá pra continuar agora mesmo pelo WhatsApp do escritório, e que a equipe já foi avisada.\n' +
  '- Se a pessoa pedir para falar com um advogado/humano, ou o assunto for delicado demais (urgência real, ameaça, risco), diga que a equipe já está a par e vai assumir a conversa.'

// bloco VARIÁVEL — sempre depois do breakpoint do cache_control
function montarConteudoChat(lead, historico, mensagem) {
  const transcricao = historico.map(h => ((h.de === 'user') ? 'Cliente: ' : 'Você: ') + h.texto).join('\n')
  return 'Dados já capturados: nome=' + (lead.nome || '—') + '; e-mail=' + (lead.email || '—') + '; whatsapp=' + (lead.tel || '—') + '.\n\n' +
    (transcricao ? ('Histórico da conversa até agora:\n' + transcricao + '\n\n') : '') +
    'Nova mensagem do cliente: "' + mensagem + '"\n\nResponda seguindo as regras do system.'
}

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ESCRITORIO_CMP = '908f77fc-19f5-4d86-9576-f5590af09e0a'
const MAX_TEXTO = 4000
const MAX_TURNOS_IA = 40   // trava de custo: acima disso, resposta fixa sem chamar a IA
const HUMANO_JANELA_MIN = 15   // minutos após a última resposta do staff em que a IA fica calada

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}
function agoraBR() { return new Date(Date.now() - 3 * 3600 * 1000) }
// mesmo esquema do _numCasoAuto() do sistema.html: ano.mes.dia.horaminuto —
// colisão (raríssima) resolve acrescentando os segundos.
function numeroCasoAuto(d) {
  const p2 = n => String(n).padStart(2, '0')
  return d.getUTCFullYear() + '.' + p2(d.getUTCMonth() + 1) + '.' + p2(d.getUTCDate()) + '.' + p2(d.getUTCHours()) + p2(d.getUTCMinutes())
}

// referência curta tipo "13/08-0952" — não é o número CNJ (ainda não existe),
// é só pra achar essa conversa rápido no funil e cruzar com o WhatsApp
function referencia(d) {
  const dt = d || new Date()
  const dd = String(dt.getDate()).padStart(2, '0')
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const hh = String(dt.getHours()).padStart(2, '0')
  const mi = String(dt.getMinutes()).padStart(2, '0')
  return dd + '/' + mm + '-' + hh + mi
}

export async function POST(request) {
  let body
  try { body = await request.json() } catch (e) { return Response.json({ erro: 'json inválido' }, { status: 400 }) }
  const sb = admin()

  if (body.acao === 'criar') {
    const agora = new Date()
    const ref = referencia(agora)
    const nome = String(body.nome || '').trim().slice(0, 200) || null
    const email = String(body.email || '').trim().slice(0, 200) || null
    const origem = String(body.origem_url || '').slice(0, 500)
    const ins = await sb.from('crm_leads').insert({
      escritorio_id: ESCRITORIO_CMP, nome, email, canal: 'Chat do site', estagio: 'novo',
      prioridade: 'media', proc_ref: ref, data: agora.toISOString().slice(0, 10),
      obs: origem ? ('Origem: ' + origem) : null,
      capturado_em: agora.toISOString(), ultima_atividade: agora.toISOString(), ordem: Date.now(),
    }).select('id').single()
    if (ins.error) return Response.json({ erro: ins.error.message }, { status: 500 })
    // já veio com nome (link personalizado) -> avisa o escritório de cara
    if (nome) {
      try { fetch(new URL('/api/notificar-jader?lead=' + ins.data.id, request.url).toString(), { cache: 'no-store' }).catch(() => {}) } catch (e) {}
    }
    return Response.json({ ok: true, id: ins.data.id, ref })
  }

  if (body.acao === 'atualizar') {
    const id = String(body.id || '')
    if (!id) return Response.json({ erro: 'id ausente' }, { status: 400 })
    const atual = await sb.from('crm_leads').select('obs,arquivos,nome').eq('id', id).eq('escritorio_id', ESCRITORIO_CMP).maybeSingle()
    if (!atual.data) return Response.json({ erro: 'não encontrado' }, { status: 404 })

    const patch = { ultima_atividade: new Date().toISOString() }
    if (body.nome) patch.nome = String(body.nome).trim().slice(0, 200)
    if (body.email) patch.email = String(body.email).trim().slice(0, 200)
    if (body.tel) patch.tel = String(body.tel).trim().slice(0, 60)
    if (body.mensagem) {
      const linha = String(body.mensagem).trim().slice(0, MAX_TEXTO)
      if (linha) patch.obs = (atual.data.obs ? (atual.data.obs + '\n\n') : '') + linha
    }
    if (body.arquivo && body.arquivo.path) {
      const lista = Array.isArray(atual.data.arquivos) ? atual.data.arquivos.slice() : []
      lista.push({
        nome: String(body.arquivo.nome || 'arquivo').slice(0, 200),
        path: String(body.arquivo.path).slice(0, 500),
        tipo: String(body.arquivo.tipo || ''),
        tamanho: Number(body.arquivo.tamanho) || 0,
        quando: new Date().toISOString(),
      })
      patch.arquivos = lista
    }
    const upd = await sb.from('crm_leads').update(patch).eq('id', id)
    if (upd.error) return Response.json({ erro: upd.error.message }, { status: 500 })

    // primeira vez que dá pra identificar quem é (nome chegou) -> avisa o escritório
    if (patch.nome && !atual.data.nome) {
      try { fetch(new URL('/api/notificar-jader?lead=' + id, request.url).toString(), { cache: 'no-store' }).catch(() => {}) } catch (e) {}
    }
    return Response.json({ ok: true })
  }

  // ===== 'msg': grava UMA entrada na transcrição (crm_leads.conversa), sem
  // mexer em mais nada — usada pela fase de captura (nome/mensagem/e-mail/
  // telefone), que antes só ia para `obs` e por isso não aparecia na ficha do
  // lead nem na tela "Chats" (só a fase de contratação, via 'responder', virava
  // conversa). Pedido do dono (21/08/2026): "no chat do site não aparece as
  // mensagens que o cliente mandou" — agora a conversa inteira, do "oi" em
  // diante, fica em crm_leads.conversa. =====
  if (body.acao === 'msg') {
    const id = String(body.id || '')
    const de = String(body.de || '')
    const texto = String(body.texto || '').trim().slice(0, MAX_TEXTO)
    if (!id || !texto || (de !== 'user' && de !== 'bot')) return Response.json({ erro: 'dados incompletos' }, { status: 400 })
    const atual = await sb.from('crm_leads').select('conversa').eq('id', id).eq('escritorio_id', ESCRITORIO_CMP).maybeSingle()
    if (!atual.data) return Response.json({ erro: 'não encontrado' }, { status: 404 })
    const conversa = (Array.isArray(atual.data.conversa) ? atual.data.conversa : [])
      .concat([{ de, texto, quando: new Date().toISOString() }]).slice(-80)
    const upd = await sb.from('crm_leads').update({ conversa, ultima_atividade: new Date().toISOString() }).eq('id', id)
    if (upd.error) return Response.json({ erro: upd.error.message }, { status: 500 })
    return Response.json({ ok: true })
  }

  // ===== 'concluir': e-mail + WhatsApp já capturados -> abre o caso no Gestão
  // AGORA (não espera ninguém do escritório clicar em nada), manda e-mail de
  // confirmação ao cliente e devolve o número do caso pro botão de WhatsApp já
  // sair com a referência certa. Idempotente: retomar a conversa (F5, rede
  // caindo) não abre um segundo caso — se o proc_ref já aponta pra um caso
  // existente, devolve o mesmo número. =====
  if (body.acao === 'concluir') {
    const id = String(body.id || '')
    if (!id) return Response.json({ erro: 'id ausente' }, { status: 400 })
    const atual = await sb.from('crm_leads').select('id,nome,email,tel,obs,proc_ref').eq('id', id).eq('escritorio_id', ESCRITORIO_CMP).maybeSingle()
    if (!atual.data) return Response.json({ erro: 'não encontrado' }, { status: 404 })
    const lead = atual.data
    if (!lead.email || !lead.tel) return Response.json({ erro: 'faltam e-mail e/ou WhatsApp' }, { status: 400 })

    if (lead.proc_ref && /^\d{4}\.\d{2}\.\d{2}\.\d{4,6}$/.test(lead.proc_ref)) {
      const existe = await sb.from('processos').select('numero').eq('escritorio_id', ESCRITORIO_CMP).eq('numero', lead.proc_ref).maybeSingle()
      if (existe.data) return Response.json({ ok: true, numero: lead.proc_ref, ja_existia: true })
    }

    const agora = agoraBR()
    let numero = numeroCasoAuto(agora)
    const col = await sb.from('processos').select('id').eq('numero', numero).maybeSingle()
    if (col.data) numero += String(agora.getUTCSeconds()).padStart(2, '0')

    const primeiraLinha = String(lead.obs || '').split('\n').map(l => l.trim()).filter(l => l && !/^Origem:/i.test(l))[0] || ''
    const assunto = primeiraLinha.slice(0, 200) || 'Atendimento via chat do site'

    const ins = await sb.from('processos').insert({
      escritorio_id: ESCRITORIO_CMP, numero, cliente_nome: lead.nome || null, assunto,
      status: 'Administrativo', fonte: 'caso',
      contatos_livres: [lead.tel, lead.email].filter(Boolean).join(', '),
    }).select('id').single()
    if (ins.error) return Response.json({ erro: ins.error.message }, { status: 500 })

    if (lead.obs) {
      try { await sb.from('andamentos').insert({ processo_id: ins.data.id, data: agora.toISOString().slice(0, 10), fonte: 'manual', texto: '[Chat do site] ' + lead.obs }) } catch (e) {}
    }
    try {
      const rc = await sb.from('contatos').select('id').ilike('nome', lead.nome || '').eq('escritorio_id', ESCRITORIO_CMP).limit(1)
      const patchC = { email: lead.email, telefone: lead.tel }
      if (rc.data && rc.data[0]) await sb.from('contatos').update(patchC).eq('id', rc.data[0].id)
      else await sb.from('contatos').insert({ nome: lead.nome, tipo: 'cliente', escritorio_id: ESCRITORIO_CMP, ...patchC })
    } catch (e) {}

    await sb.from('crm_leads').update({ proc_ref: numero, ultima_atividade: new Date().toISOString() }).eq('id', id)

    // e-mail de confirmação ao CLIENTE — best-effort, nunca trava a resposta.
    // convidarApp:false — convites automáticos ao app estão suspensos (decisão
    // do dono; ver CLAUDE.md "Testes já descartados").
    try {
      const primeiro = String(lead.nome || '').trim().split(/\s+/)[0] || ''
      const corpo = 'Olá' + (primeiro ? (', ' + primeiro) : '') + '!\n\n' +
        'Recebemos seu contato pelo chat do nosso site (atendimento nº ' + numero + ') e já registramos aqui no escritório Crispim, Mendonça e Pinheiro.\n\n' +
        'Nossa equipe já foi avisada e vai falar com você em breve. Se quiser adiantar, é só continuar agora mesmo pelo WhatsApp.\n\n' +
        'Qualquer dúvida, estamos à disposição.'
      await enviarEmailCore({ para: lead.email, assunto: 'Recebemos seu contato — CMP Advogados', corpo, numero, convidarApp: false })
    } catch (e) {}

    return Response.json({ ok: true, numero })
  }

  // ===== 'responder': depois que e-mail e WhatsApp já foram capturados (fase
  // de contratação), o chat continua conversando de verdade via IA em vez de
  // ficar mudo — pedido do dono: "o robô com IA não pode deixar de conversar
  // até a conversa avançar para uma contratação". Guarda a transcrição em
  // crm_leads.conversa (jsonb) e usa como histórico nas próximas chamadas. =====
  if (body.acao === 'responder') {
    const id = String(body.id || '')
    const mensagem = String(body.mensagem || '').trim().slice(0, 1000)
    if (!id || !mensagem) return Response.json({ erro: 'dados incompletos' }, { status: 400 })
    const atual = await sb.from('crm_leads').select('id,nome,email,tel,obs,conversa').eq('id', id).eq('escritorio_id', ESCRITORIO_CMP).maybeSingle()
    if (!atual.data) return Response.json({ erro: 'não encontrado' }, { status: 404 })
    const lead = atual.data
    const historico = Array.isArray(lead.conversa) ? lead.conversa.slice(-60) : []

    // atendimento humano: alguém da equipe já respondeu por dentro do sistema
    // (de:'staff') há pouco tempo -> a IA fica calada NESTE lead (os outros
    // continuam normalmente); só grava a mensagem nova pro staff ver
    const staffRecente = historico.filter(h => h.de === 'staff').slice(-1)[0]
    const humanoAtivo = !!staffRecente && (Date.now() - new Date(staffRecente.quando).getTime()) < HUMANO_JANELA_MIN * 60000
    if (humanoAtivo) {
      const novaConversaH = historico.concat([{ de: 'user', texto: mensagem, quando: new Date().toISOString() }]).slice(-80)
      try {
        await sb.from('crm_leads').update({
          conversa: novaConversaH, ultima_atividade: new Date().toISOString(),
          obs: (lead.obs ? (lead.obs + '\n\n') : '') + mensagem,
        }).eq('id', id)
      } catch (e) {}
      return Response.json({ ok: true, humano: true })
    }

    // trava de custo: depois de muitas rodadas, resposta fixa sem chamar a IA —
    // a conversa já devia ter migrado pro WhatsApp a essa altura
    if (historico.filter(h => h.de === 'user').length >= MAX_TURNOS_IA) {
      return Response.json({ ok: true, resposta: 'Já estamos conversando há um bom tempo por aqui — pra não perder nada, continue direto no WhatsApp que a equipe já está avisada 👇' })
    }

    const r = await chamarClaude({
      rotina: 'chat_site_publico', sistemaFixo: SISTEMA_ATENDIMENTO_CHAT_SITE, conteudo: montarConteudoChat(lead, historico, mensagem),
      modelo: 'claude-sonnet-5', maxTokens: 400, sb, ref: id, escritorioId: ESCRITORIO_CMP,
    })
    const resposta = (r && r.texto && r.texto.trim()) || 'Recebi sua mensagem! Se quiser falar agora mesmo com alguém da equipe, é só continuar no WhatsApp 👇'

    const novaConversa = historico.concat([
      { de: 'user', texto: mensagem, quando: new Date().toISOString() },
      { de: 'bot', texto: resposta, quando: new Date().toISOString() },
    ]).slice(-80)
    try {
      await sb.from('crm_leads').update({
        conversa: novaConversa, ultima_atividade: new Date().toISOString(),
        obs: (lead.obs ? (lead.obs + '\n\n') : '') + mensagem,
      }).eq('id', id)
    } catch (e) {}

    return Response.json({ ok: true, resposta })
  }

  // ===== 'sincronizar': o chat do site faz polling nesta ação pra pegar em
  // near-real-time as respostas que a EQUIPE digitou direto na ficha do lead
  // (sistema.html grava com de:'staff' em crm_leads.conversa). `desde` é a
  // quantidade de entradas que o visitante já tem localmente. =====
  if (body.acao === 'sincronizar') {
    const id = String(body.id || '')
    const desde = Math.max(0, parseInt(body.desde, 10) || 0)
    if (!id) return Response.json({ erro: 'id ausente' }, { status: 400 })
    const atual = await sb.from('crm_leads').select('conversa').eq('id', id).eq('escritorio_id', ESCRITORIO_CMP).maybeSingle()
    if (!atual.data) return Response.json({ erro: 'não encontrado' }, { status: 404 })
    const conversa = Array.isArray(atual.data.conversa) ? atual.data.conversa : []
    return Response.json({ ok: true, conversa: conversa.slice(desde), total: conversa.length })
  }

  return Response.json({ erro: 'ação inválida' }, { status: 400 })
}
