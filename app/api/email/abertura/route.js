// Pixel de abertura — a imagem de 1×1 que vai dentro de cada e-mail enviado.
// Quando o destinatário abre a mensagem e as imagens carregam, este endpoint
// registra a abertura no rastreio. Sempre devolve o GIF, token válido ou não.
//
// Limites conhecidos (vale para qualquer sistema, Autentique incluso):
//   • cliente de e-mail com imagens bloqueadas não dispara o pixel;
//   • a cópia oculta (EMAIL_COPIA) usa o MESMO e-mail — abrir a cópia também
//     conta como abertura. "Aberto" é indício, não prova; prova é o botão
//     de confirmação (/api/email/confirmar).

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0

const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const token = String(searchParams.get('t') || '').replace(/[^a-f0-9]/gi, '')
  if (token && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
      const agora = new Date().toISOString()
      const r = await sb.from('email_rastreio').select('id,aberto_em,aberturas').eq('token', token).single()
      if (r.data) {
        await sb.from('email_rastreio').update({
          aberto_em: r.data.aberto_em || agora,
          ultima_abertura: agora,
          aberturas: (r.data.aberturas || 0) + 1,
        }).eq('id', r.data.id)
      }
    } catch (e) {}
  }
  return new Response(GIF, {
    headers: {
      'Content-Type': 'image/gif',
      'Content-Length': String(GIF.length),
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      'Pragma': 'no-cache',
    },
  })
}
