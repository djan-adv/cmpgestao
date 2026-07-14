// Captura rápida — grava pedido do cliente no histórico do processo (ou vira tarefa),
// com anexos. Usada por 2 caminhos:
//   (a) página pública captura.html (link com chave secreta CAPTURA_SECRET) — sem login;
//   (b) sistema logado (JWT do Supabase) — botões "Gravar no histórico"/"Criar tarefa".
//
//   GET  /api/captura?k=<chave>&q=<busca>        -> lista processos (id, numero, cliente)
//   POST /api/captura   { k?, acao, ... , arquivos:[{nome,tipo,b64}] }
//
// Segurança: escrita/busca exigem a chave OU um JWT válido. Nada exposto sem isso.

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
async function jwtUser(request, kOverride) {
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

// ---- POST: grava no histórico e/ou cria tarefa, com anexos ----
export async function POST(request) {
  let body
  try { body = await request.json() } catch (e) { return Response.json({ erro: 'json inválido' }, { status: 400 }) }
  let quem = null
  if (chaveOk(body.k)) quem = 'link'
  else { const u = await jwtUser(request); if (u) quem = String(u.email || 'user') }
  if (!quem) return Response.json({ erro: 'não autorizado' }, { status: 401 })

  const acao = (body.acao === 'tarefa') ? 'tarefa' : 'historico'
  const texto = String(body.texto || '').trim()
  const numero = String(body.numero || '').trim()
  const cliente = String(body.cliente || '').trim()
  const arquivos = Array.isArray(body.arquivos) ? body.arquivos.slice(0, MAX_FILES) : []
  if (!texto && !arquivos.length) return Response.json({ erro: 'escreva um texto ou anexe um arquivo' }, { status: 400 })

  const sb = admin()

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
    const corpo = marca + (texto || '(anexos)')
    const { data: a } = await sb.from('andamentos').insert({
      processo_id: proc.id, data: (body.data || hoje), texto: corpo, fonte: 'captura',
    }).select('id').single()
    andamentoId = a && a.id
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

  // 3) anexos -> Storage + tabela anexos
  let salvos = 0
  for (const f of arquivos) {
    try {
      const nome = String(f.nome || 'arquivo').slice(0, 200)
      const b64 = String(f.b64 || '').replace(/^data:[^;]+;base64,/, '')
      if (!b64) continue
      const buf = Buffer.from(b64, 'base64')
      if (!buf.length || buf.length > MAX_BYTES) continue
      const tipo = String(f.tipo || 'application/octet-stream').split(';')[0]
      const path = ESCRITORIO_CMP + '/' + ((proc && proc.numero) || numero || 'sem-processo').replace(/\D/g, '') + '/' + crypto.randomUUID() + '_' + nome.replace(/[^\w.\-]+/g, '_')
      const up = await sb.storage.from('capturas').upload(path, buf, { contentType: tipo, upsert: false })
      if (up.error) continue
      await sb.from('anexos').insert({
        escritorio_id: ESCRITORIO_CMP, processo_numero: (proc && proc.numero) || numero || null,
        andamento_id: andamentoId, kanban_id: kanbanId, origem: acao, nome, tipo, tamanho: buf.length,
        path, criado_por: quem,
      })
      salvos++
    } catch (e) { /* pula o arquivo com erro */ }
  }

  return Response.json({ ok: true, acao, andamento_id: andamentoId, kanban_id: kanbanId, anexos: salvos, processo: proc && proc.numero })
}
