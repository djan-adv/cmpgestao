// Webhook do WhatsApp (Meta Cloud API) — CMPGestão.
// - GET: verificação do webhook pela Meta (hub.challenge).
// - POST: recebe mensagens e status. Grava no banco (wa_conversas / wa_mensagens)
//   usando a chave de SERVIÇO do Supabase (server-side; ignora RLS).
//
// Segredos (todos em variáveis de ambiente no VPS, nunca no código):
//   WHATSAPP_VERIFY_TOKEN     token que VOCÊ inventa e cola nos dois lados (Meta + aqui)
//   WHATSAPP_APP_SECRET       (opcional) segredo do app p/ validar assinatura X-Hub-Signature-256
//   SUPABASE_SERVICE_ROLE_KEY chave de serviço do Supabase (já usada pelo cron do DJEN)
//   NEXT_PUBLIC_SUPABASE_URL

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const ESCRITORIO_CMP = '908f77fc-19f5-4d86-9576-f5590af09e0a'

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false } })
}

// 1) Verificação do webhook (a Meta chama uma vez ao configurar).
export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')
  const expected = process.env.WHATSAPP_VERIFY_TOKEN
  if (mode === 'subscribe' && expected && token === expected) {
    return new Response(challenge || '', { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }
  return new Response('forbidden', { status: 403 })
}

function assinaturaOk(secret, raw, header) {
  if (!secret) return true // sem app secret configurado, não valida (ambiente de teste)
  if (!header) return false
  try {
    const esperado = 'sha256=' + crypto.createHmac('sha256', secret).update(raw, 'utf8').digest('hex')
    const a = Buffer.from(header), b = Buffer.from(esperado)
    return a.length === b.length && crypto.timingSafeEqual(a, b)
  } catch (e) { return false }
}

function textoDaMensagem(m) {
  if (!m) return { tipo: 'text', texto: '' }
  const t = m.type
  if (t === 'text') return { tipo: 'text', texto: (m.text && m.text.body) || '' }
  if (t === 'button') return { tipo: 'text', texto: (m.button && m.button.text) || '' }
  if (t === 'interactive') {
    const i = m.interactive || {}
    const v = (i.button_reply && i.button_reply.title) || (i.list_reply && i.list_reply.title) || ''
    return { tipo: 'interactive', texto: v }
  }
  if (['image', 'audio', 'video', 'document', 'sticker'].includes(t)) {
    const o = m[t] || {}
    return { tipo: t, texto: o.caption || ('[' + t + ']'), media_id: o.id || null, media_mime: o.mime_type || null }
  }
  return { tipo: t || 'text', texto: '[' + (t || 'mensagem') + ']' }
}

// 2) Recebimento de eventos (mensagens novas + status de entrega).
export async function POST(request) {
  const raw = await request.text()
  if (!assinaturaOk(process.env.WHATSAPP_APP_SECRET, raw, request.headers.get('x-hub-signature-256'))) {
    return new Response('invalid signature', { status: 401 })
  }
  let body
  try { body = JSON.parse(raw) } catch (e) { return Response.json({ ok: true }) } // sempre 200 p/ Meta não reenfileirar
  const sb = admin()
  if (!sb) return Response.json({ ok: true, warn: 'sem service role' })

  try {
    const entries = body.entry || []
    for (const entry of entries) {
      for (const ch of (entry.changes || [])) {
        const v = ch.value || {}
        const contatos = v.contacts || []
        const nomePerfil = (contatos[0] && contatos[0].profile && contatos[0].profile.name) || null

        // 2a) mensagens recebidas
        for (const m of (v.messages || [])) {
          const waId = String(m.from || '').replace(/\D/g, '')
          if (!waId) continue
          const info = textoDaMensagem(m)
          const ts = m.timestamp ? new Date(parseInt(m.timestamp, 10) * 1000).toISOString() : new Date().toISOString()

          // upsert conversa: abre/renova a janela de 24h (mensagem do cliente)
          const janela = new Date(Date.now() + 24 * 3600 * 1000).toISOString()
          const { data: conv } = await sb.from('wa_conversas').upsert({
            escritorio_id: ESCRITORIO_CMP, wa_id: waId, nome: nomePerfil || undefined,
            ultimo_texto: info.texto, ultima_direcao: 'in', ultima_em: ts, janela_ate: janela,
          }, { onConflict: 'escritorio_id,wa_id' }).select('id,nao_lidas').single()

          const convId = conv && conv.id
          if (convId) {
            await sb.rpc('wa_incr_nao_lidas', { p_conv: convId }).then(() => {}, () => {})
          }
          await sb.from('wa_mensagens').insert({
            escritorio_id: ESCRITORIO_CMP, conversa_id: convId || null, wa_id: waId,
            direcao: 'in', tipo: info.tipo, texto: info.texto,
            media_id: info.media_id || null, media_mime: info.media_mime || null,
            wam_id: m.id || null, status: 'received', ts,
          })
        }

        // 2b) status de entrega/leitura de mensagens que ENVIAMOS
        for (const st of (v.statuses || [])) {
          if (!st.id) continue
          const patch = { status: st.status || null }
          if (st.errors && st.errors[0]) patch.erro = String(st.errors[0].title || st.errors[0].message || '')
          await sb.from('wa_mensagens').update(patch).eq('wam_id', st.id)
        }
      }
    }
  } catch (e) {
    // nunca devolve erro à Meta (evita reenvio em loop); loga no corpo p/ debug manual
    return Response.json({ ok: true, erro: String((e && e.message) || e) })
  }
  return Response.json({ ok: true })
}
