// Ícone do aplicativo para escritório SEM logo cadastrado: um quadrado na cor
// da marca com as iniciais do nome. Existe para o app instalado nunca sair com
// o ícone de outro escritório — e para o manifesto ter sempre um ícone válido,
// que é o que o Android exige para oferecer "Instalar o aplicativo".
//
//   GET /api/portal/icone.svg[?host=exemplo.com.br]

import { createClient } from '@supabase/supabase-js'
import { hostLimpo, nomeDaCasa, corDaCasa, svgIcone } from '../marca-app.js'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  let host = ''
  try { host = hostLimpo(new URL(request.url).searchParams.get('host') || '') } catch (e) {}
  if (!host) host = hostLimpo(request.headers.get('host') || '')

  let esc = null
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    const { data } = await sb.from('escritorios').select('nome,marca').contains('hosts', [host]).maybeSingle()
    esc = data || null
  } catch (e) {}

  return new Response(svgIcone(nomeDaCasa(esc), corDaCasa(esc)), {
    headers: { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'no-store, max-age=0' },
  })
}
