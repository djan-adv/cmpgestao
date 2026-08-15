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
  // parcelas do parcelamento automático: emite no Cora e envia por e-mail (~7 dias antes do venc.)
  { nome: 'boletos_programados', rotulo: 'Cora — parcelas programadas', url: '/api/cora/programados?rodar=1', diario_hora: 8 },
  // procuração/contrato assinado no assinador volta para a ficha (histórico + PDF na pasta)
  { nome: 'assinatura_sync', rotulo: 'Assinaturas — levar às fichas', url: '/api/assinatura/sync?rodar=1', cada_min: 30 },
  { nome: 'notificar_jader', rotulo: 'Notificações do Jader', url: '/api/notificar-jader', cada_min: 15 },
  // De 1x/dia às 5h para de 2 em 2 horas: o DJEN não fica completo de madrugada
  // e uma única passada perdia o dia inteiro. A gravação é idempotente (dedup por
  // texto+data), então repassar de hora em hora não duplica nada.
  { nome: 'djen', rotulo: 'DJEN — publicações do dia', url: '/api/cron/djen', cada_min: 120 },
  { nome: 'jusbr_docs', rotulo: 'jus.br — puxar documentos', url: '/api/jusbr/puxar-docs', diario_hora: 6 },
  // MOVIMENTOS (conclusão, juntada) não saem no DJEN — só na consulta do PDPJ.
  // Antes isso dependia de alguém clicar em "↻ atualizar" na ficha, e processo
  // que ninguém abria ficava meses desatualizado. Roda em rodízio, lote pequeno.
  { nome: 'jusbr_movimentos', rotulo: 'jus.br — movimentos (todos os graus)', url: '/api/jusbr/movimentos/robo', cada_min: 15, timeout_ms: 280000 },
  { nome: 'protocolo_conferir', rotulo: 'Petições — conferir protocolo', url: '/api/jusbr/conferir-protocolo', cada_min: 120 },
  // Avisos de audiência no app do cliente. Saíam de varreduras no NAVEGADOR
  // (varreAudienciasAuto / varreAvisosVespera, na carga do sistema): quem não
  // abrisse a tela no dia certo não avisava ninguém. O planejador olha a agenda e
  // enfileira; a entrega roda curto, que é o que permite avisar 30 e 10 minutos
  // antes sem o planejador rodar a cada minuto.
  { nome: 'audiencias_planejar', rotulo: 'Audiências — planejar avisos do app', url: '/api/cron/audiencias', cada_min: 60 },
  { nome: 'avisos_app', rotulo: 'Audiências — enviar avisos no app', url: '/api/cron/avisos-app', cada_min: 5 },
  { nome: 'monit_cobrar', rotulo: 'Monitoramento — cobrança', url: '/api/monitoramento/robo?tarefa=cobrar', diario_hora: 6 },
  { nome: 'monit_varrer', rotulo: 'Monitoramento — varredura', url: '/api/monitoramento/robo?tarefa=varrer', semanal_dias: [1, 5], hora: 8 },
  { nome: 'inpi_varrer', rotulo: 'INPI — RPI de marcas', url: '/api/inpi/robo?tarefa=varrer', semanal_dias: [2], hora: 9 },
  // agenda: tarefa não concluída até sexta vira segunda seguinte, marcada como atrasada
  { nome: 'agenda_adiar', rotulo: 'Agenda — adiar tarefas atrasadas pra segunda', url: '/api/agenda/adiar-atrasadas', semanal_dias: [6], hora: 6 },
  // tira os PDFs do jus.br de dentro do banco (vão pro disco) e apaga o cache
  // vencido. Sem isso a tabela jusbr_arquivos cresce sem parar e estoura o
  // Supabase — foi o que aconteceu em agosto/2026 (1,3 GB num plano de 500 MB).
  { nome: 'jusbr_arquivar', rotulo: 'jus.br — tirar arquivos do banco e faxinar cache', url: '/api/jusbr/arquivar', cada_min: 10, timeout_ms: 280000 },
  // fila de e-mails com hora marcada (horário da vara: 08h comum/trabalhista, 10h federal).
  // De 5 em 5 min para o e-mail sair perto do minuto marcado, não meia hora depois.
  { nome: 'email_fila', rotulo: 'E-mails — fila com hora marcada', url: '/api/cron/email-fila', cada_min: 5 },
  // caixa de entrada: traz as respostas das varas e dos clientes para o histórico
  { nome: 'email_receber', rotulo: 'E-mails — ler respostas (IMAP)', url: '/api/email/receber', cada_min: 10, timeout_ms: 115000 },
  { nome: 'minuta_triagem', rotulo: 'Minutas — triar intimações', url: '/api/robo/minutas?fase=triagem', cada_min: 30 },
  // dossiê (.zip) DESLIGADO em 15/08/2026 a pedido do dono: ninguém baixava os zips.
  // A triagem continua lendo a intimação, sugerindo a peça e lançando o prazo, e a
  // íntegra continua indo pra pasta. Pra reativar, é só descomentar a linha.
  // { nome: 'minuta_dossie', rotulo: 'Minutas — dossiê do Estagiário Virtual', url: '/api/robo/minutas?fase=dossie', cada_min: 15, timeout_ms: 240000 },
  // íntegra dos autos: download pesado do jus.br, um processo por vez
  { nome: 'minuta_integra', rotulo: 'Minutas — íntegra dos autos na pasta', url: '/api/robo/minutas?fase=integra', cada_min: 20, timeout_ms: 280000 },
  // sentença/acórdão saiu → avisa o cliente pelo chat do app, sozinho. Mesmo teto
  // mensal do Estagiário Virtual (ia_config): se estourar o mês, este também para.
  { nome: 'aviso_decisao_cliente', rotulo: 'Cliente — avisar sentença/acórdão pelo chat', url: '/api/robo/avisos-cliente', cada_min: 30, timeout_ms: 55000 },
  // cliente que ainda não entrou no app: lembrete a cada 2 dias ÚTEIS (o próprio
  // robô cuida do intervalo e da janela de horário; aqui é só a batida de hora).
  { nome: 'app_convite', rotulo: 'Cliente — cobrar entrada no aplicativo', url: '/api/cron/app-convite', cada_min: 60 },
  // audiências/reuniões → Google Calendar (com Meet automático nas reuniões).
  // Sem custo quando não há autorização ainda (só confirma e sai).
  { nome: 'google_sync', rotulo: 'Agenda — sincronizar com o Google Calendar', url: '/api/cron/google-sync', cada_min: 10 },
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
    const r = await fetch(BASE_LOCAL + job.url, { cache: 'no-store', signal: AbortSignal.timeout(job.timeout_ms || 55000) })
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
