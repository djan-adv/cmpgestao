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
import { ESCRITORIO_CMP, estaAutorizado, getFreshGoogleToken, sincronizarEvento } from '../../google/lib.js'

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

  const { data: pendentes, error } = await sb.from('agenda_eventos')
    .select('id,data,hora,tipo,titulo,resp,processo_numero,descricao,local_evento')
    .eq('escritorio_id', ESCRITORIO_CMP)
    .is('google_event_id', null)
    .gte('data', hojeISO())
    .order('data', { ascending: true })
    .limit(LOTE)
  if (error) return Response.json({ erro: error.message }, { status: 500 })
  if (!pendentes || !pendentes.length) return Response.json({ ok: true, sincronizados: 0, resumo: 'nada pendente' })

  const tok = await getFreshGoogleToken(sb)
  if (tok.erro) return Response.json({ erro: 'Google indisponível: ' + tok.erro }, { status: 502 })

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
    ok: true, sincronizados, falhas,
    resumo: sincronizados + ' evento(s) sincronizado(s) com o Google Calendar' + (falhas ? (' · ' + falhas + ' falha(s)') : '') + (pendentes.length === LOTE ? ' · pode haver mais pendentes (lote cheio)' : ''),
    detalhes: debug ? detalhes : undefined,
  })
}
