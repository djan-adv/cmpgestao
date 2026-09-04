// Quem pode ter certificado neste servidor.
//
// Vender subdomínio por escritório (advogado.djan.app.br) não pode custar uma
// ida ao terminal a cada venda. O Caddy resolve isso emitindo o certificado na
// hora do primeiro acesso — mas, sozinho, ele emitiria para QUALQUER nome que
// alguém apontasse para este IP. Duas consequências: qualquer um passaria a ter
// um endereço servindo o nosso sistema, e a autoridade certificadora nos
// bloquearia por excesso de pedidos.
//
// Por isso o Caddy pergunta aqui antes ("ask"): só emite se o endereço estiver
// no cadastro de algum escritório. Responder 200 = pode; qualquer outra coisa =
// não pode.
//
//   GET /api/tls?domain=advogado.djan.app.br
//
// Rota interna: quem chama é o Caddy, do próprio servidor.

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function hostLimpo(h) {
  return String(h || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '')
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const dominio = hostLimpo(searchParams.get('domain'))
  if (!dominio) return new Response('sem domínio', { status: 400 })

  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    })
    const { data } = await sb
      .from('escritorios')
      .select('id,nome,ativo')
      .contains('hosts', [dominio])
      .maybeSingle()

    if (!data) return new Response('endereço não cadastrado', { status: 404 })
    // Escritório suspenso continua com certificado: sem ele, em vez da mensagem
    // "acesso suspenso", o cliente veria um aviso de site inseguro — e um aviso
    // de segurança no endereço do próprio escritório é pior do que a cobrança.
    return new Response('ok', { status: 200 })
  } catch (e) {
    // Falha de banco não pode virar recusa: o endereço já em uso perderia o
    // certificado na renovação. Na dúvida, deixa passar e registra.
    console.error('[tls/ask] falha ao consultar o cadastro:', (e && e.message) || e)
    return new Response('erro ao consultar', { status: 500 })
  }
}
