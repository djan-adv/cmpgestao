// Portal público de Monitoramento — o CLIENTE solicita (não há captação ativa).
// Fluxo: cliente informa CPF/CNPJ + e-mail → busca processos por NOME no DJEN →
// escolhe quais acompanhar → gera boleto Cora → ao pagar, recebe extrato por e-mail.
//
//   POST /api/monitoramento  { acao: 'buscar',   doc, nome? }        -> { nome, processos:[...] }
//   POST /api/monitoramento  { acao: 'contratar', doc, nome, email, numeros:[...] } -> { boleto_url, pix, linha, total }
//
// Público (sem login): usa a service key só no servidor. MVP por NOME (grátis) —
// pega processos com publicação recente; homônimos possíveis. Preço por processo
// vem de produtividade_config (monit_preco_centavos).

import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { coraConfigurado, coraApi } from '../cora/lib.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ESCRITORIO_CMP = '908f77fc-19f5-4d86-9576-f5590af09e0a'
const DJEN = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao'
const UA = 'Mozilla/5.0 (compatible; CMPGestao/1.0)'
const iso = (d) => d.toISOString().slice(0, 10)
const soDig = (s) => String(s || '').replace(/\D/g, '')

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}
async function cfg(sb, chave, def) {
  try { const r = await sb.from('produtividade_config').select('valor').eq('escritorio_id', ESCRITORIO_CMP).eq('chave', chave).single(); return (r && r.data && r.data.valor) || def }
  catch (e) { return def }
}
// razão social pelo CNPJ (BrasilAPI, grátis). CPF não tem fonte legal → cliente digita.
async function nomeDoCnpj(cnpj) {
  const d = soDig(cnpj); if (d.length !== 14) return ''
  try {
    const r = await fetch('https://brasilapi.com.br/api/cnpj/v1/' + d, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(12000) })
    if (!r.ok) return ''
    const j = await r.json()
    return String(j.razao_social || j.nome_fantasia || '').trim()
  } catch (e) { return '' }
}
async function buscaDjenPorNome(nome, dias) {
  const fim = new Date(), ini = new Date(Date.now() - dias * 86400000)
  const base = `${DJEN}?nomeParte=${encodeURIComponent(nome)}&dataDisponibilizacaoInicio=${iso(ini)}&dataDisponibilizacaoFim=${iso(fim)}&meio=D`
  let itens = [], pagina = 1
  while (pagina <= 10) {
    let r
    try { r = await fetch(`${base}&pagina=${pagina}&itensPorPagina=100`, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(25000) }) }
    catch (e) { break }
    if (!r.ok) break
    const d = await r.json().catch(() => ({}))
    const lote = d.items || d.content || d.comunicacoes || []
    if (!lote.length) break
    itens = itens.concat(lote); if (lote.length < 100) break; pagina++
  }
  const por = {}
  for (const p of itens) {
    const dig = soDig(p.numeroProcesso || p.numero_processo || p.numero)
    if (dig.length < 16) continue
    const data = String(p.dataDisponibilizacao || p.data_disponibilizacao || '').slice(0, 10)
    const trib = p.siglaTribunal || p.sigla_tribunal || ''
    const texto = String(p.texto || p.teor || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    if (!por[dig] || data > por[dig].data) por[dig] = { numero: dig, tribunal: trib, data, resumo: texto.slice(0, 160) }
  }
  return Object.values(por).sort((a, b) => String(b.data).localeCompare(String(a.data)))
}
function extrairCora(json) {
  const po = (json && (json.payment_options || json.payment_option)) || {}
  const bs = po.bank_slip || (json && json.bank_slip) || {}
  const pix = po.pix || (json && json.pix) || {}
  return {
    invoice_id: (json && (json.id || json.invoice_id)) || null,
    boleto_url: bs.url || (json && (json.url || json.pdf)) || null,
    linha_digitavel: bs.digitable || bs.barcode || (json && json.digitable) || null,
    pix_emv: pix.emv || pix.qr_code || pix.code || null
  }
}

export async function POST(request) {
  let body = {}
  try { body = await request.json() } catch (e) {}
  const acao = String(body.acao || '')
  const sb = admin()

  if (acao === 'preco') {
    const preco = parseInt(await cfg(sb, 'monit_preco_centavos', '1000'), 10) || 1000
    return Response.json({ ok: true, preco })
  }

  if (acao === 'buscar') {
    const doc = soDig(body.doc)
    if (doc.length !== 11 && doc.length !== 14) return Response.json({ erro: 'Informe um CPF (11) ou CNPJ (14 dígitos).' }, { status: 400 })
    let nome = String(body.nome || '').trim()
    if (!nome && doc.length === 14) nome = await nomeDoCnpj(doc)
    if (!nome) return Response.json({ ok: true, precisaNome: true, nome: '', processos: [] })
    const processos = await buscaDjenPorNome(nome, 365)
    return Response.json({ ok: true, nome, processos, aviso: processos.length ? undefined : 'Não encontramos processos com publicação recente para este nome. Isso não garante ausência de ações — só que não houve publicação no período.' })
  }

  if (acao === 'contratar') {
    if (!coraConfigurado()) return Response.json({ erro: 'Pagamento indisponível no momento. Tente mais tarde.' }, { status: 503 })
    const doc = soDig(body.doc)
    const nome = String(body.nome || '').trim()
    const email = String(body.email || '').trim()
    const numeros = Array.isArray(body.numeros) ? body.numeros.map(soDig).filter(n => n.length >= 16) : []
    if (doc.length !== 11 && doc.length !== 14) return Response.json({ erro: 'CPF/CNPJ inválido.' }, { status: 400 })
    if (!nome) return Response.json({ erro: 'Informe o nome.' }, { status: 400 })
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return Response.json({ erro: 'E-mail inválido.' }, { status: 400 })
    if (!numeros.length) return Response.json({ erro: 'Selecione ao menos um processo.' }, { status: 400 })

    const preco = parseInt(await cfg(sb, 'monit_preco_centavos', '1000'), 10) || 1000
    const total = preco * numeros.length
    const descricao = 'Monitoramento de ' + numeros.length + ' processo(s) — solicitado por ' + nome

    // cobrança Cora (boleto + PIX)
    const idem = crypto.randomUUID(); const code = 'MON-' + idem
    const venc = iso(new Date(Date.now() + 3 * 86400000))
    const invoiceBody = {
      code,
      customer: { name: nome, email: email || undefined, document: { identity: doc, type: doc.length === 14 ? 'CNPJ' : 'CPF' } },
      services: [{ name: 'Monitoramento processual', description: descricao, amount: total }],
      payment_terms: { due_date: venc },
      payment_forms: ['BANK_SLIP', 'PIX']
    }
    let r
    try { r = await coraApi('POST', '/v2/invoices', invoiceBody, { 'Idempotency-Key': idem }) }
    catch (e) { return Response.json({ erro: 'Falha ao gerar o boleto. Tente novamente.' }, { status: 502 }) }
    if (!r || r.status < 200 || r.status >= 300) return Response.json({ erro: 'O banco recusou a cobrança. Confira os dados e tente de novo.' }, { status: 502 })
    const info = extrairCora(r.json || {})

    // salva a cobrança e o pedido de monitoramento
    const cob = await sb.from('cora_cobrancas').insert({
      escritorio_id: ESCRITORIO_CMP, descricao, valor_centavos: total, vencimento: venc, status: 'aberta',
      cora_invoice_id: info.invoice_id, cora_code: code, boleto_url: info.boleto_url, linha_digitavel: info.linha_digitavel, pix_emv: info.pix_emv
    }).select('id').single()
    const cobrancaId = cob && cob.data && cob.data.id
    await sb.from('monitoramentos').insert({
      escritorio_id: ESCRITORIO_CMP, doc, nome, email, numeros, valor_centavos: total, cobranca_id: cobrancaId, status: 'pendente'
    })

    return Response.json({ ok: true, total, quantidade: numeros.length, boleto_url: info.boleto_url, pix: info.pix_emv, linha: info.linha_digitavel, vencimento: venc })
  }

  return Response.json({ erro: 'ação inválida' }, { status: 400 })
}
