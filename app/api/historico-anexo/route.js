// Anexa arquivo(s) (prints/fotos) a um andamento já existente do histórico —
// usado pelo "+ histórico manual" da ficha do processo, para o print ficar
// visível dentro do próprio quadro do histórico (via GET /api/anexo).
//   POST /api/historico-anexo   { andamento_id, processo_id?, numero?, arquivos:[{nome,tipo,b64}] }
// Sempre logado (JWT do Supabase) — sem chave pública, diferente de /api/captura.

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const ESCRITORIO_CMP = '908f77fc-19f5-4d86-9576-f5590af09e0a'
const MAX_FILES = 6
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

export async function POST(request) {
  const user = await jwtUser(request)
  if (!user) return Response.json({ erro: 'não autorizado' }, { status: 401 })

  let body
  try { body = await request.json() } catch (e) { return Response.json({ erro: 'json inválido' }, { status: 400 }) }

  const andamentoId = body.andamento_id
  if (!andamentoId) return Response.json({ erro: 'andamento_id ausente' }, { status: 400 })
  const numero = String(body.numero || '').trim()
  const arquivosIn = Array.isArray(body.arquivos) ? body.arquivos.slice(0, MAX_FILES) : []
  if (!arquivosIn.length) return Response.json({ erro: 'anexe ao menos um arquivo' }, { status: 400 })

  const sb = admin()

  // confere que o andamento existe e pega o número do processo (para o path e a coluna processo_numero)
  const { data: and } = await sb.from('andamentos').select('id,processo_id').eq('id', andamentoId).maybeSingle()
  if (!and) return Response.json({ erro: 'andamento não encontrado' }, { status: 404 })
  let numeroProc = numero
  if (!numeroProc && and.processo_id) {
    const { data: proc } = await sb.from('processos').select('numero').eq('id', and.processo_id).maybeSingle()
    numeroProc = (proc && proc.numero) || ''
  }

  let salvos = 0, falhas = 0
  for (const f of arquivosIn) {
    try {
      const nome = String(f.nome || 'arquivo').slice(0, 200)
      const b64 = String(f.b64 || '').replace(/^data:[^;]+;base64,/, '')
      if (!b64) { falhas++; continue }
      const buf = Buffer.from(b64, 'base64')
      if (!buf.length || buf.length > MAX_BYTES) { falhas++; continue }
      const tipo = String(f.tipo || 'application/octet-stream')
      const path = ESCRITORIO_CMP + '/' + numeroProc.replace(/\D/g, '') + '/' + crypto.randomUUID() + '_' + nome.replace(/[^\w.\-]+/g, '_')
      const up = await sb.storage.from('capturas').upload(path, buf, { contentType: tipo, upsert: false })
      if (up.error) { falhas++; continue }
      const insA = await sb.from('anexos').insert({
        escritorio_id: ESCRITORIO_CMP, processo_numero: numeroProc || null,
        andamento_id: andamentoId, origem: 'manual', nome, tipo, tamanho: buf.length,
        path, criado_por: String(user.email || 'user'),
      })
      if (insA.error) { falhas++; continue }
      salvos++
    } catch (e) { falhas++ }
  }

  return Response.json({ ok: true, salvos, falhas })
}
