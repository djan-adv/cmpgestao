// Notificação push do Chat da Equipe — o "alarme" no celular mesmo com o app
// fechado. Funciona no chat instalado na tela de início (Android sempre;
// iPhone a partir do iOS 16.4, desde que adicionado à tela de início).
//
// As chaves VAPID vêm do .env.local (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY) —
// gere as suas com:  npx web-push generate-vapid-keys
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
async function usuario(request) {
  const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const u = await sb.auth.getUser(jwt)
  return (u && u.data && u.data.user) || null
}

export async function GET() {
  const pub = process.env.VAPID_PUBLIC_KEY
  if (!pub) return Response.json({ erro: 'push não configurado no servidor' }, { status: 501 })
  return Response.json({ ok: true, publicKey: pub })
}

export async function POST(request) {
  const user = await usuario(request)
  if (!user) return Response.json({ erro: 'Faça login.' }, { status: 401 })
  let body = {}
  try { body = await request.json() } catch (e) {}

  if (body.acao === 'subscribe') {
    const s = body.subscription
    if (!s || !s.endpoint || !s.keys) return Response.json({ erro: 'inscrição inválida' }, { status: 400 })
    const r = await svc().from('chat_push_subs').upsert({
      user_id: user.id, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth_key: s.keys.auth,
    }, { onConflict: 'endpoint' })
    if (r.error) return Response.json({ erro: r.error.message }, { status: 500 })
    return Response.json({ ok: true })
  }

  if (body.acao === 'unsubscribe') {
    await svc().from('chat_push_subs').delete().eq('endpoint', String(body.endpoint || '')).eq('user_id', user.id)
    return Response.json({ ok: true })
  }

  if (body.acao === 'notificar') {
    if (body.autor_id !== user.id) return Response.json({ erro: 'autor não confere com a sessão' }, { status: 403 })
    const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY
    if (!pub || !priv) return Response.json({ ok: true, enviados: 0 }) // push não configurado — não trava o chat
    webpush.setVapidDetails('mailto:' + (process.env.VAPID_CONTATO || 'contato@exemplo.com'), pub, priv)

    // Quem recebe: só os OUTROS. Nada do que a pessoa escreve volta para ela —
    // filtrar por user_id (e não por aparelho) garante que quem escreve no
    // computador não recebe alarme em NENHUM aparelho seu.
    const admin = svc()
    let destinatarios = []
    if (body.para_id) {
      destinatarios = [body.para_id]
    } else {
      const { data: todos } = await admin.from('usuarios').select('id')
      destinatarios = (todos || []).map(u => u.id)
    }
    destinatarios = [...new Set(destinatarios.filter(id => id && id !== user.id))]
    if (!destinatarios.length) return Response.json({ ok: true, enviados: 0 })

    // origem_endpoint: a inscrição do aparelho que enviou — descartada por
    // segurança extra, mesmo já filtrando o autor por user_id acima.
    const origem = String(body.origem_endpoint || '')
    const { data: todasSubs } = await admin.from('chat_push_subs').select('*').in('user_id', destinatarios)
    const subs = (todasSubs || []).filter(s => s.endpoint !== origem)
    const titulo = body.para_id ? ('🔒 ' + (body.autor_nome || 'Colega')) : ('💬 ' + (body.autor_nome || 'Colega'))
    const payload = JSON.stringify({ titulo, corpo: String(body.texto || '').slice(0, 140), url: '/chat' })

    let enviados = 0, expirados = []
    await Promise.all((subs || []).map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } }, payload)
        enviados++
      } catch (e) {
        // 404/410 = inscrição morta (app desinstalado, permissão revogada) — limpa
        if (e && (e.statusCode === 404 || e.statusCode === 410)) expirados.push(s.endpoint)
      }
    }))
    if (expirados.length) { try { await admin.from('chat_push_subs').delete().in('endpoint', expirados) } catch (e) {} }
    return Response.json({ ok: true, enviados })
  }

  return Response.json({ erro: 'ação desconhecida' }, { status: 400 })
}
