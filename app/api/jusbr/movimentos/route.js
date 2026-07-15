// jus.br / PDPJ — importar a LINHA DE MOVIMENTOS do processo (todos os graus) e
// preencher os dados da ficha (classe, assunto, vara, distribuição).
//   POST /api/jusbr/movimentos   (Authorization: Bearer <jwt do Supabase>)
//   body: { numero: "0812803-38.2019.8.15.2001", debug?: true }
// O DJEN só traz publicações; movimentos internos ("Conclusos para despacho",
// "Juntada de Petição") só existem na consulta do PDPJ. Aqui varremos o JSON de forma
// robusta (sem depender do nome exato do campo) e gravamos os novos via
// robot_add_andamento (dedup por texto). Também atualizamos os dados do processo.

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

// ——— varredura robusta: acha arrays de "movimentos" sem saber o nome do campo ———
function pareceMov(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false
  const keys = Object.keys(o).map(k => k.toLowerCase())
  const temData = keys.some(k => /data|datahora|dtmov|dt_mov|date|dtdispon/.test(k))
  const temTexto = keys.some(k => /descri|nome|movimento|complement|titulo|texto|tipo/.test(k))
  return temData && temTexto
}
function coletaArraysMov(node, out, prof) {
  if (prof > 7 || !node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    const bons = node.filter(pareceMov).length
    if (node.length && bons >= Math.max(1, Math.floor(node.length * 0.5))) out.push(node)
    for (const x of node) coletaArraysMov(x, out, prof + 1)
    return
  }
  for (const k of Object.keys(node)) coletaArraysMov(node[k], out, prof + 1)
}
function pega(o, res) {
  for (const cam of res) {
    const partes = cam.split('.')
    let v = o
    for (const p of partes) { v = v && v[p] }
    if (v != null && v !== '') return v
  }
  return null
}
function normMov(m) {
  if (!m || typeof m !== 'object') return null
  const dataRaw = pega(m, ['dataHora', 'data', 'dataHoraMovimento', 'dataMovimento', 'dtMovimento', 'dataDistribuicao', 'movimento.dataHora'])
  const data = dataRaw ? String(dataRaw).slice(0, 10) : null
  let desc = pega(m, ['descricao', 'nome', 'complemento', 'titulo', 'texto',
    'movimentoNacional.descricao', 'movimentoNacional.nome', 'movimento.descricao', 'movimento.nome', 'tipoMovimento.descricao'])
  desc = String(desc || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  // complementos tabelados agregam contexto (ex.: motivo)
  const comp = m.complementosTabelados || m.complementos
  if (Array.isArray(comp) && comp.length) {
    const extra = comp.map(c => c && (c.descricao || c.nome || c.valor)).filter(Boolean).join('; ')
    if (extra) desc = desc ? (desc + ' — ' + extra) : extra
  }
  if (!desc) return null
  return { data, texto: desc }
}
// dados da ficha a partir do JSON do PDPJ
function extraiMeta(proc) {
  const t = (proc && (proc.tramitacaoAtual || (Array.isArray(proc.tramitacoes) && proc.tramitacoes[0]))) || {}
  return {
    classe: pega(proc, ['classe.descricao', 'classeProcessual.descricao', 'classeJudicial.descricao']) || pega(t, ['classe.descricao', 'classeProcessual.descricao']) || null,
    assunto: pega(proc, ['assunto.descricao', 'assuntoPrincipal.descricao']) || (Array.isArray(proc && proc.assuntos) && proc.assuntos[0] && (proc.assuntos[0].descricao || proc.assuntos[0].nome)) || pega(t, ['assunto.descricao']) || (Array.isArray(t.assuntos) && t.assuntos[0] && (t.assuntos[0].descricao || t.assuntos[0].nome)) || null,
    orgao: pega(proc, ['orgaoJulgador.nome', 'orgaoJulgador.descricao']) || pega(t, ['orgaoJulgador.nome', 'orgaoJulgador.descricao']) || null,
    distribuido: pega(proc, ['dataAjuizamento', 'dataDistribuicao', 'distribuicao.data']) || pega(t, ['dataDistribuicao', 'dataAjuizamento']) || null,
  }
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

  // acha o maior array que pareça ser a lista de movimentos
  const arrays = []
  coletaArraysMov(proc, arrays, 0)
  arrays.sort((a, b) => b.length - a.length)
  const lista = arrays[0] || []
  const movs = []
  const vistos = new Set()
  for (const m of lista) {
    const n = normMov(m)
    if (!n) continue
    const k = (n.data || '') + '|' + n.texto.toLowerCase()
    if (vistos.has(k)) continue
    vistos.add(k)
    movs.push(n)
  }

  // atualiza os dados da ficha (classe/assunto/vara/distribuição) — faz o selo virar "vinculado"
  const meta = extraiMeta(proc)
  let fichaAtualizada = false
  try {
    const patch = {}
    if (meta.classe) patch.classe = String(meta.classe).slice(0, 200)
    if (meta.assunto) patch.assunto = String(meta.assunto).slice(0, 200)
    if (meta.orgao) { patch.orgao = String(meta.orgao).slice(0, 200); patch.foro = String(meta.orgao).slice(0, 200) }
    if (meta.distribuido) { const d = String(meta.distribuido).slice(0, 10); if (/^\d{4}-\d{2}-\d{2}$/.test(d)) patch.distribuido_em = d }
    if (Object.keys(patch).length) {
      const upd = await sb.from('processos').update(patch).eq('numero_digitos', numero).select('id')
      if (!upd.error && upd.data && upd.data.length) fichaAtualizada = true
    }
  } catch (e) { /* não bloqueia a importação de movimentos */ }

  let inseridos = 0, jaTinha = 0, semProcesso = 0, erros = 0
  for (const mv of movs) {
    const { data: res, error } = await sb.rpc('robot_add_andamento', { p_num: numero, p_data: mv.data, p_texto: mv.texto })
    if (error) { erros++; continue }
    if (res === 'inserido') inseridos++
    else if (res === 'existe') jaTinha++
    else semProcesso++
  }

  const out = { ok: true, numero, movimentos: movs.length, novos: inseridos, jaTinha, semProcesso, erros, ficha_atualizada: fichaAtualizada, meta }
  if (body.debug) {
    out.diag = {
      topKeys: proc && typeof proc === 'object' ? Object.keys(proc).slice(0, 40) : [],
      tramitacaoAtualKeys: proc && proc.tramitacaoAtual ? Object.keys(proc.tramitacaoAtual).slice(0, 40) : [],
      arraysEncontrados: arrays.map(a => a.length),
      amostraMov: lista.slice(0, 2),
    }
  }
  return Response.json(out)
}
