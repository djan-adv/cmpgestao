// Robô diário CMPGestão — captura publicações novas no DJEN (Comunica/CNJ) por OAB
// e grava os andamentos novos no banco. Roda na NUVEM (Vercel Cron), PC desligado.
// Escreve via função robot_add_andamento (SECURITY DEFINER) usando a chave PÚBLICA —
// não precisa de service_role key. Fonte oficial (Res. CNJ 569/24); nada vira prazo sem conferência.
export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { createClient } from '@supabase/supabase-js'

const OABS = [
  { numero: '5219', uf: 'SE' },
  { numero: '5219', uf: 'PB' },
  { numero: '46268', uf: 'CE' },
  { numero: '73003', uf: 'BA' },
  { numero: '59426', uf: 'PE' },
]
const DJEN = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao'
const iso = (d) => d.toISOString().slice(0, 10)

async function consultaDjen(numero, uf, dias) {
  const fim = new Date(), ini = new Date(Date.now() - dias * 86400000)
  let itens = [], pagina = 1
  while (pagina <= 10) {
    const url = `${DJEN}?numeroOab=${numero.replace(/\D/g, '')}&ufOab=${uf}&dataDisponibilizacaoInicio=${iso(ini)}&dataDisponibilizacaoFim=${iso(fim)}&meio=D&pagina=${pagina}&itensPorPagina=100`
    let r
    try { r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(25000) }) } catch (e) { break }
    if (!r.ok) break
    const d = await r.json()
    const lote = d.items || d.content || []
    if (!lote.length) break
    itens = itens.concat(lote)
    if (lote.length < 100) break
    pagina++
  }
  return itens
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return Response.json({ erro: 'faltam variáveis do Supabase' }, { status: 500 })
  const sb = createClient(url, anon, { auth: { persistSession: false } })
  const dias = parseInt(searchParams.get('dias') || '2', 10) || 2

  let pubs = []
  for (const o of OABS) { const it = await consultaDjen(o.numero, o.uf, dias); pubs = pubs.concat(it) }

  let inseridos = 0, jaTinha = 0, semProcesso = 0, erros = 0
  for (const p of pubs) {
    const dig = String(p.numeroProcesso || p.numero_processo || '').replace(/\D/g, '')
    if (dig.length < 16) { semProcesso++; continue }
    const texto = String(p.texto || p.teor || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/[ \t]+\n/g, '\n').trim()
    const data = String(p.dataDisponibilizacao || p.data_disponibilizacao || '').slice(0, 10) || null
    const { data: res, error } = await sb.rpc('robot_add_andamento', { p_num: dig, p_data: data, p_texto: texto })
    if (error) { erros++; continue }
    if (res === 'inserido') inseridos++
    else if (res === 'existe') jaTinha++
    else semProcesso++
  }
  return Response.json({ ok: true, oabs: OABS.length, publicacoes: pubs.length, inseridos, jaTinha, semProcesso, erros, dias })
}
