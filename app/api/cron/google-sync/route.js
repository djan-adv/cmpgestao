// Sincroniza a agenda (audiências, reuniões, prazos, tarefas com data) para o
// Google Calendar do escritório. Roda em lote pequeno, de tempos em tempos —
// chamado pelo maestro (/api/cron/tick). Reuniões ganham link do Meet sozinhas.
//
//   GET /api/cron/google-sync            -> sincroniza o que estiver pendente
//   GET /api/cron/google-sync?debug=1    -> só reporta, não grava nada
//
// Idempotente e só de IDA (cria/atualiza): um evento já sincronizado
// (google_event_id preenchido) nunca é reenviado por este robô. Se você editar
// o evento aqui no sistema DEPOIS de sincronizado, a mudança não se propaga
// sozinha ainda — é a próxima peça, não esta.
//
// Pré-requisito: alguém já autorizou o Google (abriu /api/google/auth logado e
// concluiu o consentimento). Sem isso, este robô só confirma que não há nada a
// fazer — não é erro, é o estado normal antes da primeira autorização.

import { createClient } from '@supabase/supabase-js'
import { ESCRITORIO_CMP, apagarEventoGoogle, ehCompromissoAgenda, estaAutorizado, getFreshGoogleToken, sincronizarEvento } from '../../google/lib.js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 60

const LOTE = 15

function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }) }
function hojeISO() { return new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10) } // Brasília, sem horário de verão

export async function GET(request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ erro: 'falta service key' }, { status: 500 })
  const { searchParams } = new URL(request.url)
  const debug = searchParams.get('debug') != null
  const sb = admin()

  if (!(await estaAutorizado(sb))) {
    return Response.json({ ok: true, sincronizados: 0, resumo: 'Google Calendar ainda não foi autorizado — abra /api/google/auth logado no sistema para ligar a sincronização.' })
  }

  // Busca uma janela maior que o lote porque o filtro de compromisso (título) não
  // dá para fazer no SQL — a maioria das linhas é tarefa e seria descartada aqui.
  const { data: candidatos, error } = await sb.from('agenda_eventos')
    .select('id,data,hora,tipo,titulo,resp,origem,processo_numero,descricao,local_evento')
    .eq('escritorio_id', ESCRITORIO_CMP)
    .is('google_event_id', null)
    .gte('data', hojeISO())
    .order('data', { ascending: true })
    .limit(LOTE * 20)
  if (error) return Response.json({ erro: error.message }, { status: 500 })
  const pendentes = (candidatos || []).filter(ehCompromissoAgenda).slice(0, LOTE)

  // Faxina: eventos que já subiram mas NÃO são compromisso (tarefas mandadas pela
  // primeira versão deste robô, que não filtrava) saem do Google Calendar.
  const { data: jaSubiram } = await sb.from('agenda_eventos')
    .select('id,titulo,origem,google_event_id')
    .eq('escritorio_id', ESCRITORIO_CMP)
    .not('google_event_id', 'is', null)
    .limit(500)
  const paraApagar = (jaSubiram || []).filter(ev => !ehCompromissoAgenda(ev)).slice(0, LOTE * 4)

  const { count: naFila } = await sb.from('agenda_google_lixeira')
    .select('id', { count: 'exact', head: true })
    .eq('escritorio_id', ESCRITORIO_CMP).is('apagado_em', null)
  if (!pendentes.length && !paraApagar.length && !naFila) return Response.json({ ok: true, sincronizados: 0, resumo: 'nada pendente' })

  const tok = await getFreshGoogleToken(sb)
  if (tok.erro) return Response.json({ erro: 'Google indisponível: ' + tok.erro }, { status: 502 })

  const detalhesApagar = []
  // Fila de exclusões vinda da tela: quem apaga o evento é o navegador, que não
  // tem o token do Google. Ele deixa o google_event_id aqui e nós executamos.
  const { data: naLixeira } = await sb.from('agenda_google_lixeira')
    .select('id,google_event_id,rotulo')
    .eq('escritorio_id', ESCRITORIO_CMP)
    .is('apagado_em', null)
    .limit(LOTE * 4)
  let lixeiraOk = 0
  for (const lx of (naLixeira || [])) {
    if (debug) { detalhesApagar.push({ lixeira: lx.id, rotulo: lx.rotulo }); continue }
    const d = await apagarEventoGoogle(tok.token, lx.google_event_id)
    if (d.erro) continue
    lixeiraOk++
    try { await sb.from('agenda_google_lixeira').update({ apagado_em: new Date().toISOString() }).eq('id', lx.id) } catch (e) {}
  }

  let apagados = 0
  for (const ev of paraApagar) {
    if (debug) { detalhesApagar.push({ id: ev.id, titulo: ev.titulo, origem: ev.origem }); continue }
    const d = await apagarEventoGoogle(tok.token, ev.google_event_id)
    if (d.erro) continue
    apagados++
    // limpa a marca para o evento voltar a ser "não sincronizado" — se um dia
    // virar compromisso de verdade (renomeado), sobe de novo pelo caminho normal
    try { await sb.from('agenda_eventos').update({ google_event_id: null, google_meet_link: null, google_sync_em: null, google_sync_erro: null }).eq('id', ev.id) } catch (e) {}
  }

  let sincronizados = 0, falhas = 0
  const detalhes = []
  for (const ev of pendentes) {
    const comMeet = /reuni[ãa]o/i.test(ev.titulo || '')
    if (debug) { detalhes.push({ id: ev.id, titulo: ev.titulo, data: ev.data, hora: ev.hora, meet: comMeet }); continue }
    const desc = [ev.descricao, ev.processo_numero ? ('Processo: ' + ev.processo_numero) : '', ev.resp ? ('Responsável: ' + ev.resp) : ''].filter(Boolean).join('\n')
    const r = await sincronizarEvento(tok.token, {
      titulo: ev.titulo || 'Compromisso', data: ev.data, hora: ev.hora,
      descricao: desc, local: ev.local_evento || '', comMeet,
    })
    if (r.erro) {
      falhas++
      try { await sb.from('agenda_eventos').update({ google_sync_erro: String(r.erro).slice(0, 500) }).eq('id', ev.id) } catch (e) {}
      detalhes.push({ id: ev.id, titulo: ev.titulo, erro: r.erro })
      continue
    }
    sincronizados++
    try {
      await sb.from('agenda_eventos').update({
        google_event_id: r.id, google_meet_link: r.meetLink || null,
        google_sync_em: new Date().toISOString(), google_sync_erro: null,
      }).eq('id', ev.id)
    } catch (e) {}
    detalhes.push({ id: ev.id, titulo: ev.titulo, google_event_id: r.id, meet: !!r.meetLink })
  }

  return Response.json({
    ok: true, sincronizados, falhas, apagados, lixeira: lixeiraOk,
    resumo: sincronizados + ' compromisso(s) sincronizado(s) com o Google Calendar'
      + (apagados ? (' · ' + apagados + ' tarefa(s) removida(s) do Google') : '')
      + (lixeiraOk ? (' · ' + lixeiraOk + ' evento(s) apagado(s) no Google') : '')
      + (falhas ? (' · ' + falhas + ' falha(s)') : '')
      + (pendentes.length === LOTE ? ' · pode haver mais pendentes (lote cheio)' : ''),
    detalhes: debug ? detalhes : undefined,
    a_remover: debug ? detalhesApagar : undefined,
  })
}
