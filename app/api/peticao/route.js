// Petição automática (MINUTA) — o Claude redige na hora a peça pedida, com base no
// histórico do processo (andamentos) e nos documentos do processo (/opt/cmpdocs).
// Salva a minuta como Word (.doc) anexado ao histórico (bucket 'capturas' + tabela
// anexos), registra o lançamento na data do pedido e cria uma tarefa para D+1
// ("protocolar/corrigir"). É SEMPRE um rascunho para revisão — nunca protocola.
//
//   POST /api/peticao  (Authorization: Bearer <jwt>)  { numero, instrucao }
//
// A redação em si vive em ./core.js, compartilhada com o robô (/api/robo/minutas).

import { createClient } from '@supabase/supabase-js'
import { gerarMinuta } from './core.js'
import { escritorioDoUsuario } from '../_lib/inquilino.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 600

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

export async function POST(request) {
  const user = await usuario(request)
  if (!user) return Response.json({ erro: 'não autenticado' }, { status: 401 })
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ erro: 'IA não configurada no servidor (falta ANTHROPIC_API_KEY).' }, { status: 501 })
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ erro: 'falta SUPABASE_SERVICE_ROLE_KEY no servidor.' }, { status: 500 })

  let body
  try { body = await request.json() } catch (e) { return Response.json({ erro: 'json inválido' }, { status: 400 }) }

  // a minuta é do escritório de quem pediu: é no acervo dele que os documentos
  // do processo estão, e é na pasta dele que o rascunho tem de cair
  const esc = await escritorioDoUsuario(user.id)
  if (!esc) return Response.json({ erro: 'usuário sem escritório vinculado' }, { status: 403 })

  const r = await gerarMinuta(admin(), {
    numero: body.numero,
    instrucao: body.instrucao,
    autor: String(user.email || 'user'),
    rotina: 'peticao',
    esc,
  })
  if (r.erro) return Response.json({ erro: r.erro }, { status: r.status || 502 })

  return Response.json({
    ok: true, andamento_id: r.andamento_id, anexo_id: r.anexo_id, arquivo: r.arquivo,
    docs_usados: r.docs_usados, tarefa_para: r.tarefa_para, preview: r.preview,
  })
}
