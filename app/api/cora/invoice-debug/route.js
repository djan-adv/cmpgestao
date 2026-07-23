// Diagnóstico de uma fatura no Cora — mostra o status e a ESTRUTURA das opções de
// pagamento (bank_slip / pix) para descobrir o campo do PIX dinâmico (com valor).
// Só leitura. Exige login. Não expõe segredos do servidor.
//
//   GET /api/cora/invoice-debug?cobranca=<id da cora_cobrancas>
//   GET /api/cora/invoice-debug?invoice=<cora_invoice_id>

import { coraConfigurado, coraApi, sbUsuario, usuarioDoToken } from '../lib.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(request) {
  const { jwt, user } = await usuarioDoToken(request)
  if (!user) return Response.json({ erro: 'Faça login.' }, { status: 401 })
  if (!coraConfigurado()) return Response.json({ erro: 'Cora não configurado.' }, { status: 503 })
  const { searchParams } = new URL(request.url)
  let invoiceId = String(searchParams.get('invoice') || '').trim()
  const cobrancaId = String(searchParams.get('cobranca') || '').trim()

  if (!invoiceId && cobrancaId) {
    const sb = sbUsuario(jwt)
    const { data } = await sb.from('cora_cobrancas').select('cora_invoice_id,pix_emv,linha_digitavel,boleto_url,status').eq('id', cobrancaId).single()
    if (!data) return Response.json({ erro: 'cobrança não encontrada' }, { status: 404 })
    invoiceId = data.cora_invoice_id
    var salvo = { pix_emv_salvo: data.pix_emv, linha_salva: data.linha_digitavel, boleto_salvo: data.boleto_url, status_local: data.status }
  }
  if (!invoiceId) return Response.json({ erro: 'informe ?cobranca= ou ?invoice=' }, { status: 400 })

  const r = await coraApi('GET', '/v2/invoices/' + encodeURIComponent(invoiceId), null)
  const j = (r && r.json) || {}
  // resume a estrutura sem despejar dados sensíveis do servidor
  const po = j.payment_options || j.payment_option || {}
  const pix = po.pix || j.pix || {}
  const bs = po.bank_slip || j.bank_slip || {}
  return Response.json({
    ok: true,
    status_cora: j.status || null,
    salvo: (typeof salvo !== 'undefined') ? salvo : undefined,
    tem_payment_options: !!(j.payment_options || j.payment_option),
    pix_campos: Object.keys(pix),
    pix_emv_amostra: (pix.emv || pix.qr_code || pix.code || '').slice(0, 90),
    pix_tem_valor_no_emv: /54\d{2}/.test(String(pix.emv || pix.qr_code || pix.code || '')),
    bank_slip_campos: Object.keys(bs),
    invoice_top_keys: Object.keys(j).slice(0, 40),
  })
}
