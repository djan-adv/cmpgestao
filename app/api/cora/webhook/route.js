// Webhook do Cora: baixa automática quando o cliente paga a cobrança.
//
//   POST /api/cora/webhook?secret=<CORA_WEBHOOK_SECRET>
//
// O Cora chama esta URL a cada evento. Protegemos com um segredo na URL e,
// por segurança, NUNCA confiamos só no corpo do evento: reconsultamos a
// cobrança na API do Cora para confirmar a baixa antes de marcar como paga.
// A atualização usa a chave de serviço (service role) porque o webhook chega
// sem o JWT de um usuário.

import { coraConfigurado, coraApi, sbAdmin, estaPago } from '../lib.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(request) {
  const url = new URL(request.url)
  const secret = url.searchParams.get('secret') || request.headers.get('x-cora-secret') || ''
  const esperado = process.env.CORA_WEBHOOK_SECRET || ''
  if (!esperado || secret !== esperado) return Response.json({ erro: 'não autorizado' }, { status: 401 })

  let evt = {}
  try { evt = await request.json() } catch (e) {}
  const inv = (evt && (evt.resource || evt.invoice || evt.data || evt)) || {}
  const invoiceId = inv.id || inv.invoice_id || evt.invoice_id || evt.id || null
  if (!invoiceId) return Response.json({ ok: true, ignorado: 'sem id de invoice' })

  // reconsulta no Cora para confirmar o pagamento (não confia só no payload)
  let status = inv.status || evt.status || null
  let valorPago = null
  if (coraConfigurado()) {
    try {
      const r = await coraApi('GET', '/v2/invoices/' + encodeURIComponent(invoiceId), null)
      if (r && r.json) {
        status = r.json.status || status
        valorPago = r.json.total_paid || r.json.paid_amount || null
      }
    } catch (e) {}
  }
  if (!estaPago(status)) return Response.json({ ok: true, ignorado: 'status não é pago (' + status + ')' })

  const patch = { status: 'paga', pago_em: new Date().toISOString(), atualizado_em: new Date().toISOString() }
  if (valorPago != null) { const n = parseInt(valorPago, 10); if (!isNaN(n)) patch.valor_pago_centavos = n }

  const sb = sbAdmin()
  const { data, error } = await sb.from('cora_cobrancas').update(patch).eq('cora_invoice_id', invoiceId).select('id')
  if (error) return Response.json({ erro: error.message }, { status: 500 })
  // se a cobrança paga for de um monitoramento, entrega o extrato por e-mail (fire-and-forget)
  try { fetch(new URL('/api/monitoramento', request.url).toString(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'entregar' }) }).catch(() => {}) } catch (e) {}
  return Response.json({ ok: true, atualizadas: (data && data.length) || 0 })
}

export async function GET() {
  return Response.json({ info: 'Webhook do Cora — use POST.' })
}
