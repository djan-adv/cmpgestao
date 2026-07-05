// API do CMPGestão — partes do processo via DJEN (Comunica/CNJ).
// Consulta as comunicações do processo e agrega os DESTINATÁRIOS por polo:
// polo A (ativo/autor) × polo P (passivo/réu). Fonte oficial, roda no servidor
// (VPS com IP brasileiro — o CNJ bloqueia datacenters estrangeiros).
//
// Uso:  GET /api/partes?numero=0802628-08.2021.8.15.2003

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const DJEN = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao'
const UA = 'Mozilla/5.0 (compatible; CMPGestao/1.0)'

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const numero = searchParams.get('numero')
  if (!numero) return Response.json({ erro: 'informe ?numero=' }, { status: 400 })
  const dig = String(numero).replace(/\D/g, '')

  const ativo = {}, passivo = {}
  let total = 0
  for (let pagina = 1; pagina <= 5; pagina++) {
    const url = `${DJEN}?numeroProcesso=${dig}&pagina=${pagina}&itensPorPagina=100`
    let r
    try {
      r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(25000) })
    } catch (e) { break }
    if (!r.ok) break
    const d = await r.json().catch(() => null)
    if (!d) break
    const lote = d.items || d.content || []
    total += lote.length
    for (const it of lote) {
      for (const dst of (it.destinatarios || [])) {
        const nm = String(dst.nome || '').trim()
        if (!nm) continue
        if (dst.polo === 'A') ativo[nm] = (ativo[nm] || 0) + 1
        else if (dst.polo === 'P') passivo[nm] = (passivo[nm] || 0) + 1
      }
    }
    if (lote.length < 100) break
  }

  const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(e => e[0])
  return Response.json({ numero, comunicacoes: total, poloAtivo: top(ativo), poloPassivo: top(passivo) })
}
