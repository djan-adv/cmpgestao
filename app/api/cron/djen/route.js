// Robô diário CMPGestão — captura publicações novas no DJEN (Comunica/CNJ) por OAB
// e grava os andamentos novos no banco. Roda na NUVEM (Vercel Cron), PC desligado.
// Escreve via função robot_add_andamento (SECURITY DEFINER) usando a chave PÚBLICA.
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
const UA = 'Mozilla/5.0 (compatible; CMPGestao/1.0)'

// Toda falha de rede/HTTP é REGISTRADA, nunca engolida: sem isso, "a API do CNJ
// está fora" e "hoje não houve publicação" produziam exatamente o mesmo relatório
// (publicacoes: 0), e o robô parecia saudável enquanto não capturava nada.
async function consultaDjen(numero, uf, dias, falhas) {
  const fim = new Date(), ini = new Date(Date.now() - dias * 86400000)
  let itens = [], pagina = 1
  while (pagina <= 10) {
    const url = `${DJEN}?numeroOab=${numero.replace(/\D/g, '')}&ufOab=${uf}&dataDisponibilizacaoInicio=${iso(ini)}&dataDisponibilizacaoFim=${iso(fim)}&meio=D&pagina=${pagina}&itensPorPagina=100`
    let r
    try { r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(25000) }) }
    catch (e) { falhas.push({ alvo: `OAB ${numero}/${uf}`, pagina, erro: String((e && e.message) || e) }); break }
    if (!r.ok) { falhas.push({ alvo: `OAB ${numero}/${uf}`, pagina, status: r.status }); break }
    let d
    try { d = await r.json() }
    catch (e) { falhas.push({ alvo: `OAB ${numero}/${uf}`, pagina, erro: 'resposta não era JSON' }); break }
    const lote = d.items || d.content || d.comunicacoes || []
    if (!lote.length) break
    itens = itens.concat(lote)
    if (lote.length < 100) break
    pagina++
  }
  return itens
}

// Consulta o DJEN por NÚMERO do processo (usado nos processos da Inove, onde cada
// processo tem um advogado diferente — não dá para buscar por OAB).
async function consultaDjenNumero(numeroDigits, dias, falhas) {
  const fim = new Date(), ini = new Date(Date.now() - dias * 86400000)
  const url = `${DJEN}?numeroProcesso=${numeroDigits}&dataDisponibilizacaoInicio=${iso(ini)}&dataDisponibilizacaoFim=${iso(fim)}&meio=D&pagina=1&itensPorPagina=100`
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(20000) })
    if (!r.ok) { falhas.push({ alvo: numeroDigits, status: r.status }); return [] }
    const d = await r.json()
    return d.items || d.content || d.comunicacoes || []
  } catch (e) { falhas.push({ alvo: numeroDigits, erro: String((e && e.message) || e) }); return [] }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  // Janela de 4 dias (era 2): cobre o fim de semana e feriado, e faz uma rodada
  // que falhou se curar sozinha na seguinte em vez de deixar buraco permanente.
  const dias = parseInt(searchParams.get('dias') || '4', 10) || 4

  if (searchParams.get('debug')) {
    const o = OABS[1]
    const fim = new Date(), ini = new Date(Date.now() - dias * 86400000)
    const u = `${DJEN}?numeroOab=${o.numero}&ufOab=${o.uf}&dataDisponibilizacaoInicio=${iso(ini)}&dataDisponibilizacaoFim=${iso(fim)}&meio=D&pagina=1&itensPorPagina=5`
    let status = null, body = '', err = null
    try { const r = await fetch(u, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(25000) }); status = r.status; body = (await r.text()).slice(0, 800) } catch (e) { err = String(e && e.message || e) }
    return Response.json({ debug: true, url: u, status, err, body })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return Response.json({ erro: 'faltam variáveis do Supabase' }, { status: 500 })
  const sb = createClient(url, anon, { auth: { persistSession: false } })

  const falhas = []
  let pubs = []
  const porOab = {}
  for (const o of OABS) {
    const it = await consultaDjen(o.numero, o.uf, dias, falhas)
    porOab[`${o.numero}/${o.uf}`] = it.length
    pubs = pubs.concat(it)
  }

  // Processos da Inove: consulta por NÚMERO (cada um tem advogado diferente).
  // Lê a lista dos números com a chave de serviço (se disponível) e junta às publicações.
  let inoveNums = 0
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (svc) {
    try {
      const sbAdmin = createClient(url, svc, { auth: { persistSession: false } })
      const { data: rows } = await sbAdmin.from('processos').select('numero').eq('inove', true).is('fora_inove', false)
      const nums = [...new Set((rows || []).map(r => String(r.numero || '').replace(/\D/g, '')).filter(n => n.length >= 16))]
      inoveNums = nums.length
      for (const dig of nums) {
        const it = await consultaDjenNumero(dig, dias, falhas)
        pubs = pubs.concat(it)
      }
    } catch (e) { falhas.push({ alvo: 'lista Inove', erro: String((e && e.message) || e) }) }
  }

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
  // Se NENHUMA consulta trouxe nada e houve falha, isso não é "dia sem publicação":
  // é o robô cego. Sai com ok:false para aparecer vermelho no painel de Robôs.
  const cego = pubs.length === 0 && falhas.length > 0
  return Response.json({
    ok: !cego, ...(cego ? { alerta: 'nenhuma publicação lida E houve falha de consulta — verificar a API do CNJ' } : {}),
    oabs: OABS.length, porOab, inoveNums, publicacoes: pubs.length,
    inseridos, jaTinha, semProcesso, erros, dias,
    falhas: falhas.slice(0, 12), n_falhas: falhas.length,
  })
}
