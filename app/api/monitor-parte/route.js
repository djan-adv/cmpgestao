// Monitoramento de AÇÕES NOVAS contra um cliente de assessoria — por NOME da parte.
// Fonte: DJEN/Comunica do CNJ (mesma do robô diário). A API pública do CNJ permite
// filtrar por nome da parte (nomeParte), mas NÃO por CPF/CNPJ — então usamos o nome.
// É um TESTE de viabilidade: uma ação nova (inclusive trabalhista) gera intimação que
// cita o nome do cliente; aqui listamos as publicações do período e devolvemos os
// processos encontrados, marcando quais são NOVOS (não estão na base do escritório).
//
//   GET /api/monitor-parte?nome=<nome do cliente>&dias=7[&debug=1]
//     (Authorization: Bearer <jwt do Supabase>)
//
// Limitações honestas: nome comum gera falso-positivo; só pega processos com
// publicação no período; variações do nome/razão social podem escapar.

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const DJEN = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao'
const UA = 'Mozilla/5.0 (compatible; CMPGestao/1.0)'
const iso = (d) => d.toISOString().slice(0, 10)

async function usuario(request) {
  const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    const u = await sb.auth.getUser(jwt)
    return (u && u.data && u.data.user) || null
  } catch (e) { return null }
}

function digitos(s) { return String(s || '').replace(/\D/g, '') }

export async function GET(request) {
  const user = await usuario(request)
  if (!user) return Response.json({ erro: 'não autenticado' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const nome = String(searchParams.get('nome') || '').trim()
  const dias = Math.min(parseInt(searchParams.get('dias') || '90', 10) || 90, 95)
  const debug = searchParams.get('debug') != null
  if (nome.length < 4) return Response.json({ erro: 'informe o nome do cliente (mín. 4 letras)' }, { status: 400 })

  const fim = new Date(), ini = new Date(Date.now() - dias * 86400000)
  const base = `${DJEN}?nomeParte=${encodeURIComponent(nome)}&dataDisponibilizacaoInicio=${iso(ini)}&dataDisponibilizacaoFim=${iso(fim)}&meio=D`

  // coleta as publicações (paginado)
  let itens = [], pagina = 1, ultimoStatus = null, erro = null
  while (pagina <= 10) {
    const url = `${base}&pagina=${pagina}&itensPorPagina=100`
    let r
    try { r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(25000) }) }
    catch (e) { erro = String((e && e.message) || e); break }
    ultimoStatus = r.status
    if (!r.ok) break
    const d = await r.json().catch(() => ({}))
    const lote = d.items || d.content || d.comunicacoes || []
    if (!lote.length) break
    itens = itens.concat(lote)
    if (lote.length < 100) break
    pagina++
  }

  if (debug) {
    return Response.json({ debug: true, url: base + '&pagina=1&itensPorPagina=3', status: ultimoStatus, erro, total_bruto: itens.length, amostra: itens.slice(0, 2) })
  }

  // agrupa por processo (um processo pode ter várias publicações no período)
  const porProc = {}
  for (const p of itens) {
    const dig = digitos(p.numeroProcesso || p.numero_processo || p.numero)
    if (dig.length < 16) continue
    const texto = String(p.texto || p.teor || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    const data = String(p.dataDisponibilizacao || p.data_disponibilizacao || '').slice(0, 10)
    const trib = p.siglaTribunal || p.sigla_tribunal || ''
    const orgao = p.nomeOrgao || p.nome_orgao || ''
    if (!porProc[dig] || data > porProc[dig].data) {
      porProc[dig] = { numero: dig, tribunal: trib, orgao, data, texto: texto.slice(0, 400) }
    }
  }
  const achados = Object.values(porProc)

  // marca quais NÃO estão na base do escritório (candidatos a "ação nova")
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY
  let jaConhecidos = {}
  if (svc && achados.length) {
    try {
      const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, svc, { auth: { persistSession: false } })
      const nums = achados.map(a => a.numero)
      const { data } = await sb.from('processos').select('numero_digitos').in('numero_digitos', nums)
      for (const row of (data || [])) jaConhecidos[digitos(row.numero_digitos)] = true
    } catch (e) {}
  }
  for (const a of achados) a.novo = !jaConhecidos[a.numero]

  achados.sort((x, y) => String(y.data).localeCompare(String(x.data)))
  return Response.json({
    ok: true,
    nome,
    dias,
    total: achados.length,
    novos: achados.filter(a => a.novo).length,
    trabalhistas: achados.filter(a => /TRT|trabalh/i.test((a.tribunal || '') + ' ' + (a.orgao || '') + ' ' + (a.texto || ''))).length,
    achados,
    aviso: achados.length ? undefined : 'Nenhuma publicação com este nome no período. Isso NÃO garante ausência de ações — só que não houve publicação nova no DJEN nesta janela.',
  })
}
