// Envio de WhatsApp pela Meta Cloud API — CMPGestão.
//   POST /api/whatsapp/enviar   (Authorization: Bearer <jwt do Supabase>)
//   body p/ texto livre:   { para: "5583987365501", texto: "..." }
//   body p/ template:      { para, template: "nome", idioma: "pt_BR", componentes: [...] }
//
// Regra da Meta: TEXTO LIVRE só dentro da janela de 24h (após o cliente escrever).
// Fora da janela, use TEMPLATE aprovado. Esta rota valida a janela pelo banco.
//
// Variáveis de ambiente (VPS):
//   WHATSAPP_TOKEN            token de acesso (System User, permanente)
//   WHATSAPP_PHONE_NUMBER_ID  id do número (Cloud API)
//   WHATSAPP_API_VERSION      (opcional) ex.: v21.0
//   NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const ESCRITORIO_CMP = '908f77fc-19f5-4d86-9576-f5590af09e0a'

async function usuario(request) {
  const auth = request.headers.get('authorization') || ''
  const jwt = auth.replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const u = await sb.auth.getUser(jwt)
  return (u && u.data && u.data.user) || null
}

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}

export async function POST(request) {
  const user = await usuario(request)
  if (!user) return Response.json({ erro: 'não autenticado' }, { status: 401 })

  const token = process.env.WHATSAPP_TOKEN
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID
  const ver = process.env.WHATSAPP_API_VERSION || 'v21.0'
  if (!token || !phoneId) {
    return Response.json({ erro: 'WhatsApp não configurado (defina WHATSAPP_TOKEN e WHATSAPP_PHONE_NUMBER_ID).' }, { status: 500 })
  }

  let body
  try { body = await request.json() } catch (e) { return Response.json({ erro: 'json inválido' }, { status: 400 }) }
  const para = String(body.para || '').replace(/\D/g, '')
  if (para.length < 12) return Response.json({ erro: 'número inválido (use E.164, ex.: 5583987365501)' }, { status: 400 })

  const sb = admin()
  // janela de 24h da conversa
  let dentroJanela = false
  try {
    const { data: conv } = await sb.from('wa_conversas').select('id,janela_ate').eq('escritorio_id', ESCRITORIO_CMP).eq('wa_id', para).maybeSingle()
    dentroJanela = !!(conv && conv.janela_ate && new Date(conv.janela_ate).getTime() > Date.now())
  } catch (e) {}

  // monta o payload
  let payload, tipoReg, textoReg
  if (body.template) {
    payload = {
      messaging_product: 'whatsapp', to: para, type: 'template',
      template: {
        name: String(body.template),
        language: { code: String(body.idioma || 'pt_BR') },
        ...(Array.isArray(body.componentes) && body.componentes.length ? { components: body.componentes } : {}),
      },
    }
    tipoReg = 'template'; textoReg = '[template: ' + body.template + ']'
  } else {
    const texto = String(body.texto || '').trim()
    if (!texto) return Response.json({ erro: 'texto vazio' }, { status: 400 })
    if (!dentroJanela) {
      return Response.json({ erro: 'fora da janela de 24h — só é possível enviar TEXTO livre após o cliente escrever. Use um template aprovado.', fora_janela: true }, { status: 409 })
    }
    payload = { messaging_product: 'whatsapp', to: para, type: 'text', text: { preview_url: true, body: texto } }
    tipoReg = 'text'; textoReg = texto
  }

  // chama a Cloud API
  const url = `https://graph.facebook.com/${ver}/${phoneId}/messages`
  let resp, data
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(25000),
    })
    data = await resp.json().catch(() => ({}))
  } catch (e) {
    return Response.json({ erro: 'falha de rede ao chamar a Meta: ' + (e && e.message || e) }, { status: 502 })
  }

  if (!resp.ok) {
    const msg = (data && data.error && (data.error.message || data.error.error_data && data.error.error_data.details)) || ('HTTP ' + resp.status)
    return Response.json({ erro: 'Meta recusou: ' + msg, meta: data && data.error }, { status: 502 })
  }

  const wamId = (data.messages && data.messages[0] && data.messages[0].id) || null
  const agora = new Date().toISOString()

  // grava a mensagem enviada + atualiza a conversa
  try {
    const { data: conv } = await sb.from('wa_conversas').upsert({
      escritorio_id: ESCRITORIO_CMP, wa_id: para,
      ultimo_texto: textoReg, ultima_direcao: 'out', ultima_em: agora, nao_lidas: 0,
    }, { onConflict: 'escritorio_id,wa_id' }).select('id').single()
    await sb.from('wa_mensagens').insert({
      escritorio_id: ESCRITORIO_CMP, conversa_id: (conv && conv.id) || null, wa_id: para,
      direcao: 'out', tipo: tipoReg, texto: textoReg, wam_id: wamId, status: 'sent', ts: agora,
    })
  } catch (e) {}

  return Response.json({ ok: true, wam_id: wamId })
}
