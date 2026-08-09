// Início da autorização do Google Calendar — GET direto no navegador (não é uma
// chamada de API do painel): o advogado abre este link logado no sistema, o
// Google pede a autorização e devolve pro /api/google/callback.
//
//   GET /api/google/auth  (precisa de sessão do Supabase no navegador — cookie)
//
// Como o clique parte do navegador (não de fetch com Authorization: Bearer),
// a autenticação aqui é frouxa de propósito: qualquer um com a URL consegue
// abrir a tela de consentimento do GOOGLE (que exige login do djan.adv@gmail.com
// separadamente) — o risco real é baixo, e exigir Bearer aqui obrigaria a
// passar o token na querystring, pior ainda. Quem decide o que autoriza é
// sempre a tela do próprio Google, com a conta que estiver logada nela.

import { urlAutorizacao } from '../lib.js'

export const dynamic = 'force-dynamic'

export async function GET() {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return new Response('Servidor sem GOOGLE_CLIENT_ID configurado — defina no .env e reinicie a aplicação.', { status: 500 })
  }
  return Response.redirect(urlAutorizacao(), 302)
}
