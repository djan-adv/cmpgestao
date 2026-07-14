// Captura rápida — grava pedido do cliente no histórico do processo, vira tarefa
// ou vira lead, com anexos. Usada por 2 caminhos:
//   (a) página pública captura.html (link com chave secreta CAPTURA_SECRET) — sem login;
//   (b) sistema logado (JWT do Supabase) — botões "Gravar no histórico"/"Criar tarefa".
//
//   GET  /api/captura?k=<chave>&q=<busca>        -> lista processos (id, numero, cliente)
//   POST /api/captura   { k?, acao, ... , arquivos:[{nome,tipo,b64}] }
//        acao: 'historico' | 'tarefa' | 'lead'
//
// Segurança: escrita/busca exigem a chave OU um JWT válido. Nada exposto sem isso.
// IA (opcional): se ANTHROPIC_API_KEY estiver setada, imagens/PDF anexados são
// transcritos (OCR) e o texto entra no histórico/lead, com ênfase no telefone.

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ESCRITORIO_CMP = '908f77fc-19f5-4d86-9576-f5590af09e0a'
const MAX_FILES = 12
const MAX_BYTES = 15 * 1024 * 1024

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}
async function jwtUser(request) {
  const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '') || ''
  if (!jwt) return null
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    const u = await sb.auth.getUser(jwt)
    return (u && u.data && u.data.user) || null
  } catch (e) { return null }
}
function chaveOk(k) {
  const secret = process.env.CAPTURA_SECRET || ''
  return !!(secret && k && k === secret)
}

// ---- OCR/transcrição via IA (Anthropic vision) — mesmo padrão de ler-lead ----
async function transcreveAnexos(decoded, contextoTexto) {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return null
  const content = []
  for (const f of decoded) {
    if (/^image\//.test(f.tipo)) content.push({ type: 'image', source: { type: 'base64', media_type: f.tipo, data: f.b64 } })
    else if (f.tipo === 'application/pdf' || /\.pdf$/i.test(f.nome)) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: f.b64 } })
  }
  if (!content.length) return null
  const instr =
    'Você recebe print(s) de conversa / documento(s) que um advogado capturou de um cliente.\n' +
    'Contexto digitado pelo advogado: ' + (contextoTexto || '(vazio)') + '\n\n' +
    'Responda SOMENTE com um JSON válido, sem nenhum texto fora dele, exatamente assim:\n' +
    '{"telefones":[""],"transcricao":""}\n\n' +
    'REGRAS OBRIGATÓRIAS:\n' +
    '- transcricao: transcreva FIELMENTE todo o texto legível do(s) anexo(s), de forma organizada e sem inventar nada. Se for print de conversa, indique quem falou quando der para saber.\n' +
    '- telefones: liste os números de telefone/WhatsApp que REALMENTE aparecem no anexo (apenas dígitos com DDD). Se não houver nenhum, use [].\n' +
    '- Nunca invente nome, telefone, valores ou datas.'
  content.push({ type: 'text', text: instr })
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 1500, messages: [{ role: 'user', content }] }),
    })
    const data = await r.json()
    if (!r.ok) return null
    let txt = ''
    try { txt = (data.content || []).map((c) => c.text || '').join('\n') } catch (e) {}
    const m = txt.match(/\{[\s\S]*\}/)
    if (!m) return null
    const out = JSON.parse(m[0])
    const tels = Array.isArray(out.telefones) ? out.telefones.map((x) => String(x || '').trim()).filter(Boolean) : []
    return { transcricao: String(out.transcricao || '').trim(), telefones: tels }
  } catch (e) { return null }
}

// ---- GET: busca de processos por nome / número ----
export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const k = searchParams.get('k') || ''
  const q = String(searchParams.get('q') || '').trim()
  let quem = null
  if (chaveOk(k)) quem = 'link'
  else { const u = await jwtUser(request); if (u) quem = String(u.email || 'user') }
  if (!quem) return Response.json({ erro: 'não autorizado' }, { status: 401 })
  if (q.length < 2) return Response.json({ ok: true, processos: [] })

  const sb = admin()
  const dig = q.replace(/\D/g, '')
  let query = sb.from('processos').select('id,numero,cliente_nome,oponente,foro').eq('escritorio_id', ESCRITORIO_CMP).limit(20)
  if (dig.length >= 4) query = query.ilike('numero', '%' + dig + '%')
  else query = query.or('cliente_nome.ilike.%' + q + '%,oponente.ilike.%' + q + '%')
  const { data } = await query
  return Response.json({ ok: true, processos: (data || []).map(p => ({ id: p.id, numero: p.numero, cliente: p.cliente_nome, oponente: p.oponente, foro: p.foro })) })
}

// ---- POST: grava no histórico, cria tarefa ou cria lead, com anexos ----
export async function POST(request) {
  let body
  try { body = await request.json() } catch (e) { return Response.json({ erro: 'json inválido' }, { status: 400 }) }
  let quem = null
  if (chaveOk(body.k)) quem = 'link'
  else { const u = await jwtUser(request); if (u) quem = String(u.email || 'user') }
  if (!quem) return Response.json({ erro: 'não autorizado' }, { status: 401 })

  const acao = (body.acao === 'tarefa' || body.acao === 'lead') ? body.acao : 'historico'
  const texto = String(body.texto || '').trim()
  const numero = String(body.numero || '').trim()
  const cliente = String(body.cliente || '').trim()
  const tel = String(body.tel || '').trim()
  const arquivosIn = Array.isArray(body.arquivos) ? body.arquivos.slice(0, MAX_FILES) : []
  if (!texto && !arquivosIn.length) return Response.json({ erro: 'escreva um texto ou anexe um arquivo' }, { status: 400 })

  // decodifica os anexos uma única vez
  const decoded = []
  for (const f of arquivosIn) {
    try {
      const nome = String(f.nome || 'arquivo').slice(0, 200)
      const b64 = String(f.b64 || '').replace(/^data:[^;]+;base64,/, '')
      if (!b64) continue
      const buf = Buffer.from(b64, 'base64')
      if (!buf.length || buf.length > MAX_BYTES) continue
      const tipo = String(f.tipo || 'application/octet-stream').split(';')[0]
      decoded.push({ nome, tipo, buf, b64 })
    } catch (e) { /* pula arquivo problemático */ }
  }

  const sb = admin()

  // OCR/transcrição (uma vez) — quando houver imagem/PDF
  let ocr = null
  const temMidia = decoded.some(f => /^image\//.test(f.tipo) || f.tipo === 'application/pdf' || /\.pdf$/i.test(f.nome))
  if (temMidia) ocr = await transcreveAnexos(decoded, texto)
  const telOcr = (ocr && ocr.telefones && ocr.telefones[0]) || ''
  const blocoOcr = (ocr && ocr.transcricao)
    ? ('\n\n— Transcrição do anexo (IA):\n' + ((ocr.telefones && ocr.telefones.length) ? ('📞 Telefone(s): ' + ocr.telefones.join(', ') + '\n') : '') + ocr.transcricao)
    : ''

  // ===== LEAD (novo cliente / sem processo) =====
  if (acao === 'lead') {
    const pasta = 'pub_' + crypto.randomUUID()
    const arquivos = []
    for (const f of decoded) {
      try {
        const path = pasta + '/' + crypto.randomUUID() + '_' + f.nome.replace(/[^\w.\-]+/g, '_')
        const up = await sb.storage.from('leads-publicos').upload(path, f.buf, { contentType: f.tipo, upsert: false })
        if (up.error) continue
        arquivos.push({ nome: f.nome, path, tipo: f.tipo, tamanho: f.buf.length, quando: new Date().toISOString() })
      } catch (e) { /* pula */ }
    }
    const nomeLead = cliente || (texto ? texto.slice(0, 60) : 'Novo lead')
    const obs = (texto || '') + blocoOcr
    const hojeL = new Date().toISOString().slice(0, 10)
    const ins = await sb.from('crm_leads').insert({
      escritorio_id: ESCRITORIO_CMP, nome: nomeLead, canal: (body.canal || 'Captura'), estagio: 'novo',
      tel: (tel || telOcr || null), obs: (obs || null), arquivos, prioridade: 'media',
      data: hojeL, capturado_em: new Date().toISOString(), ultima_atividade: new Date().toISOString(),
      memoria: (ocr ? { transcricao: ocr.transcricao, telefones: ocr.telefones } : null),
      ordem: Date.now(),
    }).select('id').single()
    if (ins.error) return Response.json({ erro: 'não foi possível criar o lead: ' + ins.error.message }, { status: 500 })
    return Response.json({ ok: true, acao: 'lead', lead_id: ins.data && ins.data.id, telefone: (tel || telOcr || ''), anexos: arquivos.length })
  }

  // ===== HISTÓRICO / TAREFA =====
  // acha o processo (por id ou número) — necessário p/ histórico
  let proc = null
  if (body.processo_id) {
    const r = await sb.from('processos').select('id,numero,cliente_nome').eq('id', body.processo_id).maybeSingle()
    proc = r.data || null
  } else if (numero.replace(/\D/g, '').length >= 16) {
    const r = await sb.from('processos').select('id,numero,cliente_nome').eq('escritorio_id', ESCRITORIO_CMP).ilike('numero', '%' + numero.replace(/\D/g, '') + '%').maybeSingle()
    proc = r.data || null
  }
  if (acao === 'historico' && !proc) return Response.json({ erro: 'processo não encontrado — use "criar tarefa"', semProcesso: true }, { status: 404 })

  let andamentoId = null, kanbanId = null
  const hoje = new Date().toISOString().slice(0, 10)

  // 1) histórico (andamento) — sempre que acao=historico, ou tarefa com registrarHistorico
  const registraHist = acao === 'historico' || body.registrarHistorico
  if (registraHist && proc) {
    const marca = body.marca || (acao === 'tarefa' ? '[Tarefa] ' : '[Captura] ')
    const corpo = marca + (texto || '(anexos)') + blocoOcr
    const { data: a, error: ea } = await sb.from('andamentos').insert({
      processo_id: proc.id, data: (body.data || hoje), texto: corpo, fonte: 'captura',
    }).select('id').single()
    if (!ea) andamentoId = a && a.id
  }

  // 2) tarefa (kanban)
  if (acao === 'tarefa') {
    const { data: k } = await sb.from('kanban_tarefas').insert({
      escritorio_id: ESCRITORIO_CMP,
      titulo: texto || 'Pedido do cliente', cliente: (cliente || (proc && proc.cliente_nome) || '—'),
      numero: (proc && proc.numero) || numero || '—', coluna: 'distribuir',
      resp: (body.responsavel || null), data: (body.data || null), prazo: (body.prazo || null),
      tipo: (body.tipo || null), origem: 'captura',
    }).select('id').single()
    kanbanId = k && k.id
  }

  // 3) anexos -> Storage 'capturas' + tabela anexos (com checagem de erro)
  let salvos = 0, falhas = 0
  for (const f of decoded) {
    try {
      const path = ESCRITORIO_CMP + '/' + ((proc && proc.numero) || numero || 'sem-processo').replace(/\D/g, '') + '/' + crypto.randomUUID() + '_' + f.nome.replace(/[^\w.\-]+/g, '_')
      const up = await sb.storage.from('capturas').upload(path, f.buf, { contentType: f.tipo, upsert: false })
      if (up.error) { falhas++; continue }
      const insA = await sb.from('anexos').insert({
        escritorio_id: ESCRITORIO_CMP, processo_numero: (proc && proc.numero) || numero || null,
        andamento_id: andamentoId, kanban_id: kanbanId, origem: acao, nome: f.nome, tipo: f.tipo, tamanho: f.buf.length,
        path, criado_por: quem,
      })
      if (insA.error) { falhas++; continue }
      salvos++
    } catch (e) { falhas++ }
  }

  return Response.json({ ok: true, acao, andamento_id: andamentoId, kanban_id: kanbanId, anexos: salvos, falhas, processo: proc && proc.numero, telefone: telOcr || '', transcricao: !!(ocr && ocr.transcricao) })
}
