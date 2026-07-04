// Robô diário CMPGestão — captura publicações novas no DJEN (Comunica/CNJ) por OAB
// e grava os andamentos novos no banco. Roda na NUVEM (Vercel Cron), PC desligado.
// Fonte oficial que deflagra prazo (Res. CNJ 569/24). Nada vira prazo sem conferência humana.
export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { createClient } from '@supabase/supabase-js'

// Fase de teste: apenas as OABs do Djan (todas as inscrições dele).
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
  const secret = searchParams.get('key') || (request.headers.get('authorization') || '').replace('Bearer ', '')
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) return Response.json({ erro: 'nao autorizado' }, { status: 401 })
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!svc) return Response.json({ erro: 'Falta SUPABASE_SERVICE_ROLE_KEY nas variáveis do Vercel.' }, { status: 500 })
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, svc, { auth: { persistSession: false } })
  const dias = parseInt(searchParams.get('dias') || '2', 10) || 2

  const { data: allProcs, error: e1 } = await sb.from('processos').select('id, numero_digitos, ultima_movimentacao')
  if (e1) return Response.json({ erro: e1.message }, { status: 500 })
  const mapa = {}
  ;(allProcs || []).forEach((p) => { if (p.numero_digitos) mapa[p.numero_digitos] = p })

  let pubs = []
  for (const o of OABS) { const it = await consultaDjen(o.numero, o.uf, dias); pubs = pubs.concat(it) }

  let inseridos = 0, jaTinha = 0, semProcesso = 0
  for (const p of pubs) {
    const dig = String(p.numeroProcesso || p.numero_processo || '').replace(/\D/g, '')
    const proc = mapa[dig]
    if (!proc) { semProcesso++; continue }
    const texto = String(p.texto || p.teor || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/[ \t]+\n/g, '\n').trim()
    const data = String(p.dataDisponibilizacao || p.data_disponibilizacao || '').slice(0, 10) || null
    const { data: ex } = await sb.from('andamentos').select('id').eq('processo_id', proc.id).eq('texto', texto).limit(1)
    if (ex && ex.length) { jaTinha++; continue }
    const ins = await sb.from('andamentos').insert({ processo_id: proc.id, data, texto, tipo: 'publicacao', fonte: 'djen' })
    if (!ins.error) {
      inseridos++
      if (data && (!proc.ultima_movimentacao || data > proc.ultima_movimentacao)) { await sb.from('processos').update({ ultima_movimentacao: data }).eq('id', proc.id); proc.ultima_movimentacao = data }
    }
  }
  return Response.json({ ok: true, oabs: OABS.length, publicacoes: pubs.length, inseridos, jaTinha, semProcesso, dias })
}
