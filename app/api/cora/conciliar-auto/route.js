// Conciliação AUTOMÁTICA (robô) — baixa os pagamentos sem depender de clique/login.
// Roda pelo crontab do VPS a cada ~10 min. Para cada cobrança 'aberta' com invoice
// no Cora, consulta o status real e, se paga, marca 'paga' + pago_em. Em seguida
// dispara a entrega dos extratos de Monitoramento já pagos. Sem interação humana,
// funciona 24/7 (contratações fora do horário comercial também são reconhecidas).
//
//   GET /api/cora/conciliar-auto   (aberto, idempotente)

import { coraConfigurado, coraApi, sbAdmin, estaPago } from '../lib.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request) {
  if (!coraConfigurado()) return Response.json({ erro: 'Integração Cora não configurada.' }, { status: 503 })
  const sb = sbAdmin()
  const { data: abertas, error } = await sb.from('cora_cobrancas')
    .select('id,cora_invoice_id').eq('status', 'aberta').not('cora_invoice_id', 'is', null).limit(200)
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

  // entrega os extratos dos monitoramentos que agora estão pagos (fire-and-forget)
  let entregas = 0
  try {
    const resp = await fetch(new URL('/api/monitoramento', request.url).toString(), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'entregar' }),
      signal: AbortSignal.timeout(45000),
    })
    const j = await resp.json().catch(() => ({}))
    entregas = (j && j.enviados) || 0
  } catch (e) {}

  return Response.json({ ok: true, conferidas, baixadas, entregas, falhas })
}
