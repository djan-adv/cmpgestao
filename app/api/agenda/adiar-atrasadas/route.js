// Robô semanal (roda no sábado, disparado pelo maestro em /api/cron/tick):
// toda tarefa da agenda (kanban_tarefas) que não foi concluída até sexta-feira
// vira segunda-feira seguinte, marcada como atrasada — pra virar o chip rosa
// claro na tela em vez de continuar largada na semana que já passou.
//
// NÃO mexe em tarefa com `prazo` preenchido (prazo fatal/processual): esse é
// um prazo real do processo, não pode ser empurrado por automação — continua
// aparecendo vencido no lugar de sempre até alguém tratar manualmente.
//
//   GET /api/agenda/adiar-atrasadas

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }) }

function isoDe(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }

// horário de Brasília (UTC-3), só a data
function hojeBrasilia() {
  const d = new Date(Date.now() - 3 * 3600000)
  return isoDe(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

// sexta-feira mais recente na data (ou a própria, se já for sexta)
function ultimaSextaAte(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  const dow = dt.getDay() // 0=dom .. 6=sáb
  const diff = (dow - 5 + 7) % 7
  dt.setDate(dt.getDate() - diff)
  return isoDe(dt)
}

// segunda-feira seguinte a uma sexta
function segundaApos(isoSexta) {
  const [y, m, d] = isoSexta.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + 3)
  return isoDe(dt)
}

export async function GET() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ erro: 'falta service key' }, { status: 500 })
  const sb = admin()
  const hoje = hojeBrasilia()
  const sexta = ultimaSextaAte(hoje)
  const segunda = segundaApos(sexta)

  const { data: rows, error } = await sb.from('kanban_tarefas')
    .select('id')
    .neq('coluna', 'finalizado')
    .not('data', 'is', null)
    .lte('data', sexta)
    .is('prazo', null)
  if (error) return Response.json({ erro: error.message }, { status: 500 })

  if (!rows || !rows.length) return Response.json({ ok: true, adiadas: 0, sexta, segunda })

  const ids = rows.map(r => r.id)
  const { error: upErr } = await sb.from('kanban_tarefas').update({ data: segunda, atrasada: true }).in('id', ids)
  if (upErr) return Response.json({ erro: upErr.message }, { status: 500 })

  return Response.json({ ok: true, adiadas: ids.length, sexta, segunda })
}
