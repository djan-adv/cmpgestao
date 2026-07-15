// jus.br / PDPJ — importar a LINHA DE MOVIMENTOS do processo (todos os graus).
//   POST /api/jusbr/movimentos   (Authorization: Bearer <jwt do Supabase>)
//   body: { numero: "0812803-38.2019.8.15.2001" }
// O DJEN só traz publicações/intimações; movimentos internos como "Conclusos para
// despacho" só existem na consulta do PDPJ. Aqui puxamos os movimentos de TODAS as
// tramitações (1º/2º/3º grau) e gravamos os novos via robot_add_andamento (dedup por texto).

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const ESCRITORIO_CMP = '908f77fc-19f5-4d86-9576-f5590af09e0a'
const PDPJ = 'https://portaldeservicos.pdpj.jus.br'
const PDPJ_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'Origin': 'https://portaldeservicos.pdpj.jus.br',
  'Referer': 'https://portaldeservicos.pdpj.jus.br/consulta/autosdigitais',
}

async function usuario(request) {
  const auth = request.headers.get('authorization') || ''
  const jwt = auth.replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const u = await sb.auth.getUser(jwt)
  return (u && u.data && u.data.user) || null
}
function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}
async function tokenValido(sb) {
  const encKey = process.env.JUSBR_ENC_KEY
  if (!encKey) return { erro: 'sem_chave' }
  const { data } = await sb.rpc('jusbr_get_token', { p_esc: ESCRITORIO_CMP, p_key: encKey })
  const row = Array.isArray(data) ? data[0] : data
  if (!row || !row.token) return { erro: 'sem_token' }
  if (row.expira && new Date(row.expira).getTime() <= Date.now()) return { erro: 'expirado' }
  return { token: row.token }
}

// junta as tramitações que vierem no JSON, em qualquer um dos formatos conhecidos
function coletaTramitacoes(proc) {
  const t = []
  if (!proc) return t
  if (Array.isArray(proc.tramitacoes)) t.push(...proc.tramitacoes)
  if (proc.tramitacaoAtual) t.push(proc.tramitacaoAtual)
  // fallback: o próprio objeto pode já ser uma tramitação (com movimentos direto)
  if (proc.movimentos || proc.movimento) t.push(proc)
  return t
}
function grauLabel(tr) {
  const g = tr && (tr.grau || tr.grauProcesso || tr.instancia)
  if (g == null) return ''
  const s = String(g)
  if (/^\d+$/.test(s)) return s + 'º Grau'
  return s
}
// extrai {data, texto} de um movimento em vários formatos possíveis do PDPJ
function normMov(m, grau) {
  if (!m) return null
  const dataRaw = m.dataHora || m.data || m.dataHoraMovimento || m.dataMovimento || (m.movimento && m.movimento.dataHora) || null
  const data = dataRaw ? String(dataRaw).slice(0, 10) : null
  let desc = m.descricao || m.nome || m.complemento
    || (m.movimentoNacional && (m.movimentoNacional.descricao || m.movimentoNacional.nome))
    || (m.movimento && (m.movimento.descricao || m.movimento.nome))
    || ''
  // complementos tabelados (ex.: motivo/《tipo》) agregam contexto ao movimento
  const comp = m.complementosTabelados || m.complementos || null
  if (Array.isArray(comp) && comp.length) {
    const extra = comp.map(c => (c && (c.descricao || c.nome || c.valor))).filter(Boolean).join('; ')
    if (extra) desc = desc ? (desc + ' — ' + extra) : extra
  }
  desc = String(desc || '').replace(/\s+/g, ' ').trim()
  if (!desc) return null
  const prefixo = grau ? ('[' + grau + '] ') : ''
  return { data, texto: prefixo + desc }
}

export async function POST(request) {
  const user = await usuario(request)
  if (!user) return Response.json({ erro: 'não autenticado' }, { status: 401 })
  let body
  try { body = await request.json() } catch (e) { return Response.json({ erro: 'json inválido' }, { status: 400 }) }
  const numero = String(body.numero || '').replace(/\D/g, '')
  if (numero.length < 16) return Response.json({ erro: 'número de processo inválido' }, { status: 400 })

  const sb = admin()
  const tk = await tokenValido(sb)
  if (tk.erro === 'sem_chave') return Response.json({ erro: 'servidor sem JUSBR_ENC_KEY (chave de cifragem)' }, { status: 500 })
  if (tk.erro) return Response.json({ erro: 'jus.br: ' + (tk.erro === 'expirado' ? 'token expirado — sincronize novamente' : 'sem token — sincronize a sessão do jus.br'), motivo: tk.erro }, { status: 409 })

  let resp, data
  try {
    resp = await fetch(`${PDPJ}/api/v2/processos/${numero}`, {
      headers: { ...PDPJ_HEADERS, Authorization: 'Bearer ' + tk.token, Accept: 'application/json' },
      signal: AbortSignal.timeout(25000),
    })
    data = await resp.json().catch(() => null)
  } catch (e) {
    return Response.json({ erro: 'falha ao consultar o PDPJ: ' + (e && e.message || e) }, { status: 502 })
  }
  if (resp.status === 401) return Response.json({ erro: 'jus.br: token inválido/expirado — sincronize novamente', motivo: 'expirado' }, { status: 409 })
  if (!resp.ok) return Response.json({ erro: 'PDPJ recusou (HTTP ' + resp.status + ')' }, { status: 502 })

  const proc = Array.isArray(data && data.content) ? data.content[0] : (Array.isArray(data) ? data[0] : data)
  const tramitacoes = coletaTramitacoes(proc)

  // reúne os movimentos de todos os graus, deduplicando pelo texto+data já nesta rodada
  const movs = []
  const vistos = new Set()
  for (const tr of tramitacoes) {
    const grau = grauLabel(tr)
    const lista = (tr && (tr.movimentos || tr.movimento)) || []
    for (const m of (Array.isArray(lista) ? lista : [])) {
      const n = normMov(m, grau)
      if (!n) continue
      const k = (n.data || '') + '|' + n.texto
      if (vistos.has(k)) continue
      vistos.add(k)
      movs.push(n)
    }
  }

  let inseridos = 0, jaTinha = 0, semProcesso = 0, erros = 0
  for (const mv of movs) {
    const { data: res, error } = await sb.rpc('robot_add_andamento', { p_num: numero, p_data: mv.data, p_texto: mv.texto })
    if (error) { erros++; continue }
    if (res === 'inserido') inseridos++
    else if (res === 'existe') jaTinha++
    else semProcesso++
  }

  return Response.json({ ok: true, numero, graus: tramitacoes.length, movimentos: movs.length, novos: inseridos, jaTinha, semProcesso, erros })
}
