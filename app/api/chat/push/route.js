// Notificação push do Chat da equipe — o "alarme" no celular mesmo com o app
// fechado. Funciona no /chat instalado na tela de início (Android sempre;
// iPhone a partir do iOS 16.4, desde que adicionado à tela de início).
//
//   GET  /api/chat/push                -> devolve a chave pública VAPID (para subscribe)
//   POST /api/chat/push {acao:'subscribe',   subscription}      -> grava a inscrição deste aparelho
//   POST /api/chat/push {acao:'unsubscribe', endpoint}          -> remove a inscrição
//   POST /api/chat/push {acao:'notificar', autor_id, autor_nome, texto, para_id}
//        -> dispara o alarme para quem deve receber (chamado pelo cliente logo após enviar)

import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function svc() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}
function sbUser(request) {
  const auth = request.headers.get('authorization') || ''
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false }, global: { headers: { Authorization: auth } },
  })
}
async function usuario(request) {
  const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const u = await sb.auth.getUser(jwt)
  return (u && u.data && u.data.user) || null
}
async function vapid() {
  const { data } = await svc().from('app_secrets').select('valor').eq('chave', 'vapid_chat').maybeSingle()
  return data && data.valor
}

export async function GET() {
  const v = await vapid()
  if (!v) return Response.json({ erro: 'push não configurado no servidor' }, { status: 501 })
  return Response.json({ ok: true, publicKey: v.public })
}

export async function POST(request) {
  const user = await usuario(request)
  if (!user) return Response.json({ erro: 'Faça login.' }, { status: 401 })
  let body = {}
  try { body = await request.json() } catch (e) {}

  if (body.acao === 'subscribe') {
    const s = body.subscription
    if (!s || !s.endpoint || !s.keys) return Response.json({ erro: 'inscrição inválida' }, { status: 400 })
    const db = sbUser(request)
    const r = await db.from('chat_push_subs').upsert({
      user_id: user.id, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth_key: s.keys.auth,
    }, { onConflict: 'endpoint' })
    if (r.error) return Response.json({ erro: r.error.message }, { status: 500 })
    return Response.json({ ok: true })
  }

  if (body.acao === 'unsubscribe') {
    const db = sbUser(request)
    await db.from('chat_push_subs').delete().eq('endpoint', String(body.endpoint || ''))
    return Response.json({ ok: true })
  }

  if (body.acao === 'notificar') {
    if (body.autor_id !== user.id) return Response.json({ erro: 'autor não confere com a sessão' }, { status: 403 })
    const v = await vapid()
    if (!v) return Response.json({ ok: true, enviados: 0 }) // push não configurado — não trava o chat
    webpush.setVapidDetails('mailto:contato@cmpadvogados.com.br', v.public, v.private)

    const admin = svc()
    let destinatarios = []
    if (body.para_id) {
      destinatarios = [body.para_id]
    } else {
      const { data: eu } = await admin.from('usuarios').select('escritorio_id').eq('id', user.id).single()
      const { data: todos } = await admin.from('usuarios').select('id').eq('escritorio_id', eu && eu.escritorio_id)
      destinatarios = (todos || []).map(u => u.id).filter(id => id !== user.id)
    }
    if (!destinatarios.length) return Response.json({ ok: true, enviados: 0 })

    const { data: subs } = await admin.from('chat_push_subs').select('*').in('user_id', destinatarios)
    const titulo = body.para_id ? ('🔒 ' + (body.autor_nome || 'Colega')) : ('💬 ' + (body.autor_nome || 'Colega'))
    const payload = JSON.stringify({ titulo, corpo: String(body.texto || '').slice(0, 140), url: '/chat' })

    let enviados = 0, expirados = []
    await Promise.all((subs || []).map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } }, payload)
        enviados++
      } catch (e) {
        if (e && (e.statusCode === 404 || e.statusCode === 410)) expirados.push(s.endpoint)
      }
    }))
    if (expirados.length) { try { await admin.from('chat_push_subs').delete().in('endpoint', expirados) } catch (e) {} }
    return Response.json({ ok: true, enviados })
  }

  return Response.json({ erro: 'ação desconhecida' }, { status: 400 })
}
