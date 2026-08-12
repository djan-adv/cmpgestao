// Reunião no GOOGLE MEET, criada na hora.
//
// Diferente da sala própria (/api/sala + /sala/[token]): aqui o link é do
// Google, e a reunião entra no calendário do escritório. Serve para o caso em
// que o cliente já usa Meet, para reunião com mais de duas pessoas (a sala
// própria é 1 a 1) e para quando a rede não deixa a chamada direta fechar.
// Em troca, o áudio e o vídeo passam pelo Google, e a transcrição fica com as
// ferramentas dele — a sala própria é a opção que não guarda gravação nenhuma.
//
//   POST /api/google/meet { titulo?, quando?, duracao_min?, processo? }
//   → { ok, link, htmlLink }

import { createClient } from '@supabase/supabase-js'
import { getFreshGoogleToken, sincronizarEvento } from '../lib.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

async function usuario(request) {
  const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const u = await anon.auth.getUser(jwt)
  return (u && u.data && u.data.user) || null
}

export async function POST(request) {
  const user = await usuario(request)
  if (!user) return Response.json({ erro: 'Faça login no sistema.' }, { status: 401 })
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ erro: 'servidor sem chave de serviço' }, { status: 500 })

  let body = {}
  try { body = await request.json() } catch (e) {}

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const tok = await getFreshGoogleToken(sb)
  if (tok.erro) return Response.json({ erro: 'Google Calendar não está conectado: ' + tok.erro }, { status: 502 })

  // sem data informada, é "agora": arredonda para o minuto e reserva 1 hora
  const agora = new Date(Date.now() - 3 * 3600 * 1000)   // horário de Brasília
  const data = String(body.data || '').slice(0, 10) || agora.toISOString().slice(0, 10)
  const hora = String(body.hora || '').slice(0, 5) || agora.toISOString().slice(11, 16)

  const r = await sincronizarEvento(tok.token, {
    titulo: String(body.titulo || '').trim() || 'Reunião — CMP Advogados',
    data, hora,
    duracaoMin: Number(body.duracao_min) || 60,
    descricao: (body.processo ? ('Processo: ' + body.processo + '\n') : '') + 'Criada pelo CMPGestão.',
    comMeet: true,
  })
  if (r.erro) return Response.json({ erro: r.erro }, { status: 502 })
  if (!r.meetLink) return Response.json({ erro: 'o Google criou o evento mas não devolveu o link do Meet — confira se a conta tem Meet habilitado' }, { status: 502 })
  return Response.json({ ok: true, link: r.meetLink, htmlLink: r.htmlLink, data, hora })
}
