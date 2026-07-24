// Maestro dos robôs — um único ponto que dispara cada rotina na hora certa,
// sem crontab. Chamado periodicamente pelo agendador interno (instrumentation.js)
// e também pelos botões "▶ rodar agora" do painel Robôs.
//
//   GET /api/cron/tick            -> roda o que estiver na hora (idempotente)
//   GET /api/cron/tick?status=1   -> devolve o último resultado de cada robô
//   GET /api/cron/tick?rodar=nome -> força rodar 1 robô agora (botão do painel)
//
// Idempotência: cada robô guarda a última execução em cron_exec; jobs por
// intervalo só rodam se já passou o intervalo; diários/semanais rodam 1x no dia.

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }) }

// horário de Brasília (UTC-3) a partir de agora
function brasilia() {
  const d = new Date(Date.now() - 3 * 3600000)
  return { dia: d.toISOString().slice(0, 10), hora: d.getUTCHours(), dow: d.getUTCDay() } // dow: 0=dom
}

// catálogo dos robôs. cada_min = por intervalo; diario_hora = 1x/dia a partir da
// hora; semanal_dias + hora = 1x nos dias (1=seg … 5=sex, 2=ter).
const JOBS = [
  { nome: 'jusbr_refresh', rotulo: 'jus.br — renovar token', url: '/api/jusbr/refresh', cada_min: 20 },
  { nome: 'conciliar', rotulo: 'Cora — baixa automática', url: '/api/cora/conciliar-auto', cada_min: 10 },
  { nome: 'notificar_jader', rotulo: 'Notificações do Jader', url: '/api/notificar-jader', cada_min: 15 },
  { nome: 'djen', rotulo: 'DJEN — publicações do dia', url: '/api/cron/djen', diario_hora: 5 },
  { nome: 'jusbr_docs', rotulo: 'jus.br — puxar documentos', url: '/api/jusbr/puxar-docs', diario_hora: 6 },
  { nome: 'monit_cobrar', rotulo: 'Monitoramento — cobrança', url: '/api/monitoramento/robo?tarefa=cobrar', diario_hora: 6 },
  { nome: 'monit_varrer', rotulo: 'Monitoramento — varredura', url: '/api/monitoramento/robo?tarefa=varrer', semanal_dias: [1, 5], hora: 8 },
  { nome: 'inpi_varrer', rotulo: 'INPI — RPI de marcas', url: '/api/inpi/robo?tarefa=varrer', semanal_dias: [2], hora: 9 },
]

function jobDevido(job, execRow, bt) {
  const ultima = execRow && execRow.ultima_exec ? new Date(execRow.ultima_exec) : null
  if (job.cada_min) {
    if (!ultima) return true
    return (Date.now() - ultima.getTime()) >= job.cada_min * 60000 - 5000
  }
  const ultimaDia = ultima ? new Date(ultima.getTime() - 3 * 3600000).toISOString().slice(0, 10) : null
  if (ultimaDia === bt.dia) return false // já rodou hoje
  if (job.diario_hora != null) return bt.hora >= job.diario_hora
  if (job.semanal_dias) return job.semanal_dias.includes(bt.dow) && bt.hora >= (job.hora || 0)
  return false
}

const BASE_LOCAL = 'http://127.0.0.1:' + (process.env.PORT || 3000)

async function rodar(job, sb) {
  let ok = false, resumo = ''
  try {
    const r = await fetch(BASE_LOCAL + job.url, { cache: 'no-store', signal: AbortSignal.timeout(55000) })
    ok = r.ok
    const t = await r.text()
    resumo = ('HTTP ' + r.status + ' ' + t).slice(0, 400)
  } catch (e) { resumo = 'erro: ' + String((e && e.message) || e) }
  await sb.from('cron_exec').upsert({ nome: job.nome, ultima_exec: new Date().toISOString(), ultimo_resultado: resumo, ultimo_ok: ok, atualizado_em: new Date().toISOString() }, { onConflict: 'nome' })
  return { nome: job.nome, ok, resumo: resumo.slice(0, 120) }
}

export async function GET(request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ erro: 'falta service key' }, { status: 500 })
  const { searchParams } = new URL(request.url)
  const sb = admin()

  // status para o painel
  if (searchParams.get('status') != null) {
    const { data } = await sb.from('cron_exec').select('*')
    const mapa = {}; (data || []).forEach(r => { mapa[r.nome] = r })
    const bt = brasilia()
    const lista = JOBS.map(j => {
      const e = mapa[j.nome] || {}
      return {
        nome: j.nome, rotulo: j.rotulo,
        agenda: j.cada_min ? ('a cada ' + j.cada_min + ' min') : (j.diario_hora != null ? ('diário ' + j.diario_hora + 'h') : ('dias ' + (j.semanal_dias || []).join(',') + ' às ' + (j.hora || 0) + 'h')),
        ultima_exec: e.ultima_exec || null, ultimo_ok: e.ultimo_ok, ultimo_resultado: e.ultimo_resultado || null,
        devido_agora: jobDevido(j, e, bt),
      }
    })
    return Response.json({ ok: true, agora_brasilia: bt, jobs: lista })
  }

  // força 1 robô (botão do painel)
  const forcar = searchParams.get('rodar')
  if (forcar) {
    const job = JOBS.find(j => j.nome === forcar)
    if (!job) return Response.json({ erro: 'robô desconhecido' }, { status: 404 })
    const res = await rodar(job, sb)
    return Response.json({ ok: true, forcado: true, resultado: res })
  }

  // tick normal: roda o que estiver na hora
  const bt = brasilia()
  const { data } = await sb.from('cron_exec').select('*')
  const mapa = {}; (data || []).forEach(r => { mapa[r.nome] = r })
  const rodados = []
  for (const job of JOBS) {
    if (jobDevido(job, mapa[job.nome], bt)) {
      rodados.push(await rodar(job, sb))
    }
  }
  return Response.json({ ok: true, agora_brasilia: bt, rodados })
}
