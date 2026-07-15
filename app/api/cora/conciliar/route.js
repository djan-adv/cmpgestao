// Conciliação manual: confere no Cora as cobranças em aberto e baixa as pagas.
//
//   POST /api/cora/conciliar   (Authorization: Bearer <jwt do Supabase>)
//     -> para cada cobrança 'aberta' com invoice no Cora, consulta o status real
//        (GET /v2/invoices/{id}) e marca como paga se o Cora confirmar.
//
// Serve de rede de segurança: pega pagamentos feitos antes do webhook estar ativo
// ou avisos que se perderem. A baixa normal do dia a dia é o webhook.

import { coraConfigurado, coraApi, sbUsuario, usuarioDoToken, estaPago } from '../lib.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request) {
  const { jwt, user } = await usuarioDoToken(request)
  if (!user) return Response.json({ erro: 'Faça login.' }, { status: 401 })
  if (!coraConfigurado()) return Response.json({ erro: 'Integração Cora não configurada no servidor.' }, { status: 503 })

  const sb = sbUsuario(jwt)
  const { data: abertas, error } = await sb.from('cora_cobrancas')
    .select('id,cora_invoice_id').eq('status', 'aberta').not('cora_invoice_id', 'is', null).limit(100)
  if (error) return Response.json({ erro: error.message }, { status: 500 })

  let conferidas = 0, baixadas = 0, falhas = 0
  for (const c of (abertas || [])) {
    try {
      const r = await coraApi('GET', '/v2/invoices/' + encodeURIComponent(c.cora_invoice_id), null)
      conferidas++
      if (r.status >= 200 && r.status < 300 && r.json && estaPago(r.json.status)) {
        const patch = { status: 'paga', pago_em: new Date().toISOString(), atualizado_em: new Date().toISOString() }
        const vp = parseInt(r.json.total_paid || r.json.paid_amount || r.json.total_amount, 10)
        if (!isNaN(vp) && vp > 0) patch.valor_pago_centavos = vp
        const u = await sb.from('cora_cobrancas').update(patch).eq('id', c.id).select('id')
        if (u && !u.error && u.data && u.data.length) baixadas++
      }
    } catch (e) { falhas++ }
  }
  return Response.json({ ok: true, conferidas, baixadas, falhas })
}

export async function GET() {
  return Response.json({ info: 'Use POST autenticado para conferir os pagamentos no Cora.' })
}
