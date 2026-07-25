// Conta da API da Anthropic — quanto o sistema gastou no mês, por dois caminhos:
//
//   • NOSSO  (sempre): a soma de `ia_uso`, gravada chamada por chamada no instante
//     em que acontece. É o número que segura o teto do robô. Tempo real.
//   • OFICIAL (se houver ANTHROPIC_ADMIN_KEY): o Cost Report da própria Anthropic,
//     o mesmo número que vai para a fatura. Serve de conferência do nosso.
//
//   GET /api/ia/conta   (Authorization: Bearer <jwt>)
//
// SALDO DE CRÉDITO não existe em API — a Anthropic não expõe isso em nenhum
// endpoint. Só no Console, no link que esta rota devolve.

import { createClient } from '@supabase/supabase-js'
import { orcamento } from '../../_ia/claude.js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 30

const CONSOLE_BILLING = 'https://platform.claude.com/settings/billing'

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}
async function usuario(request) {
  const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    const u = await sb.auth.getUser(jwt)
    return (u && u.data && u.data.user) || null
  } catch (e) { return null }
}

// Custo oficial do mês corrente (UTC, que é como a Anthropic fatura).
// `amount` vem em CENTAVOS, como string decimal — dividir por 100.
async function custoOficial() {
  const key = process.env.ANTHROPIC_ADMIN_KEY
  if (!key) {
    return { disponivel: false, motivo: 'sem_chave', dica: 'Crie uma Admin API key (sk-ant-admin…) no Console e ponha em ANTHROPIC_ADMIN_KEY para conferir o gasto oficial. Exige conta de organização — conta individual não tem Admin API.' }
  }
  const agora = new Date()
  const inicio = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), 1)).toISOString()

  let total = 0, buckets = 0, pagina = null, voltas = 0
  const porDia = []
  try {
    do {
      const u = new URL('https://api.anthropic.com/v1/organizations/cost_report')
      u.searchParams.set('starting_at', inicio)
      u.searchParams.set('ending_at', agora.toISOString())
      u.searchParams.set('bucket_width', '1d')
      u.searchParams.set('limit', '31')
      if (pagina) u.searchParams.set('page', pagina)
      const r = await fetch(u, {
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'User-Agent': 'CMPGestao/1.0' },
        signal: AbortSignal.timeout(20000),
      })
      const j = await r.json()
      if (!r.ok) {
        const msg = (j && j.error && j.error.message) || ('HTTP ' + r.status)
        return { disponivel: false, motivo: 'erro', erro: msg }
      }
      for (const b of (j.data || [])) {
        const soma = (b.results || []).reduce((acc, x) => acc + (parseFloat(x.amount) || 0), 0) / 100
        total += soma; buckets++
        porDia.push({ dia: String(b.starting_at || '').slice(0, 10), usd: Math.round(soma * 1e4) / 1e4 })
      }
      pagina = j.has_more ? j.next_page : null
    } while (pagina && ++voltas < 5)
  } catch (e) {
    return { disponivel: false, motivo: 'erro', erro: String((e && e.message) || e) }
  }
  return { disponivel: true, mes_usd: Math.round(total * 1e4) / 1e4, dias: buckets, por_dia: porDia, desde: inicio }
}

export async function GET(request) {
  const user = await usuario(request)
  if (!user) return Response.json({ erro: 'não autenticado' }, { status: 401 })
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ erro: 'falta service key' }, { status: 500 })
  const sb = admin()

  const orc = await orcamento(sb)

  // nosso gasto, quebrado por rotina (triagem, minuta, petição…)
  const inicioMesBr = new Date(Date.now() - 3 * 3600000)
  inicioMesBr.setUTCDate(1); inicioMesBr.setUTCHours(0, 0, 0, 0)
  const desde = new Date(inicioMesBr.getTime() + 3 * 3600000).toISOString()
  const porRotina = {}
  try {
    const { data } = await sb.from('ia_uso').select('rotina,custo_usd').gte('criado_em', desde).limit(5000)
    ;(data || []).forEach(l => {
      const k = l.rotina || 'outros'
      if (!porRotina[k]) porRotina[k] = { rotina: k, chamadas: 0, usd: 0 }
      porRotina[k].chamadas++; porRotina[k].usd += Number(l.custo_usd) || 0
    })
  } catch (e) {}

  return Response.json({
    ok: true,
    nosso: {
      mes_usd: Math.round(orc.gastoUsd * 1e4) / 1e4,
      mes_brl: Math.round(orc.gastoBrl * 100) / 100,
      teto_brl: orc.tetoBrl, cambio: orc.cambio, estourou: orc.estourou,
      por_rotina: Object.values(porRotina).map(x => ({ ...x, usd: Math.round(x.usd * 1e4) / 1e4 })).sort((a, b) => b.usd - a.usd),
    },
    oficial: await custoOficial(),
    saldo: { disponivel: false, motivo: 'A Anthropic não expõe saldo de crédito em API — só no Console.' },
    console_url: CONSOLE_BILLING,
  })
}
