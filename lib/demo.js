// Conta de APRESENTAÇÃO — "um login onde todos os nomes das partes e processos
// sejam borrados, pra que eu faça apresentação completa real" (03/09/2026).
//
// A tela mascara nomes e números (ver _demoMask no sistema.html). Aqui é a outra
// metade, a que a tela não garante: uma conta de apresentação NÃO manda nada
// para fora — e-mail, WhatsApp, protocolo, convite de portal, assinatura, push.
// Numa demonstração ao vivo, um clique errado num botão real seria um e-mail
// real para um cliente real.
//
// Reconhecida de dois jeitos, para funcionar no minuto em que a conta é criada:
// pela lista fixa abaixo e pela coluna usuarios.demo.
import { createClient } from '@supabase/supabase-js'

export const DEMO_EMAILS = ['djanhenrique@gmail.com']

export async function contaDemo(user) {
  if (!user) return false
  const email = String(user.email || '').trim().toLowerCase()
  if (email && DEMO_EMAILS.includes(email)) return true
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    const { data } = await sb.from('usuarios').select('demo').eq('id', user.id).maybeSingle()
    return !!(data && data.demo === true)
  } catch (e) { return false }
}

/* a resposta padrão para o que a conta de apresentação tentar mandar para fora */
export function respostaDemo(oQue) {
  return Response.json({
    erro: 'Conta de apresentação: ' + (oQue || 'esta ação') + ' não sai daqui. Os dados na tela são reais e mascarados; nada é enviado a cliente, tribunal ou portal.',
    demo: true,
  }, { status: 403 })
}
