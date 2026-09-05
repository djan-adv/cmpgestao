// O manifesto do aplicativo do cliente — POR ESCRITÓRIO.
//
// O manifesto é o que dá nome e ícone ao app instalado na tela de início. Era
// um arquivo fixo (public/manifest.json) com "CMP Advogados — Portal do
// Cliente" e o ícone da CMP: o cliente de um escritório que comprou o sistema
// instalava no celular um aplicativo com o nome e a marca de outra banca.
//
//   GET /api/portal/manifest   -> manifesto do escritório dono do endereço
//
// Endereço sem escritório cadastrado (porta comum, domínio novo) cai no
// manifesto neutro — nome do produto, nunca a marca de alguém.

import { createClient } from '@supabase/supabase-js'
import { hostLimpo, manifestoDe } from '../marca-app.js'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const host = hostLimpo(request.headers.get('host') || '')
  let esc = null
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    const { data } = await sb.from('escritorios').select('id,nome,marca,raiz').contains('hosts', [host]).maybeSingle()
    esc = data || null
  } catch (e) {}

  return new Response(JSON.stringify(manifestoDe(esc, host)), {
    headers: { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'no-store, max-age=0' },
  })
}
