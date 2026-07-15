// Cobranças do Cora (boleto + PIX) para o módulo Financeiro do CMPGestão.
//
//   POST /api/cora/cobrancas   (Authorization: Bearer <jwt do Supabase>)
//     body: { contato_id, descricao, valor_centavos, vencimento (AAAA-MM-DD) }
//     -> cria a cobrança no Cora e salva em cora_cobrancas (RLS por escritório).
//   GET  /api/cora/cobrancas?status=&contato_id=
//     -> lista as cobranças do escritório (para o financeiro do cliente e o extrato).
//
// Os segredos do Cora ficam no servidor (ver lib.js). O parsing da resposta é
// defensivo: o formato exato dos campos (boleto/linha/PIX) deve ser conferido
// contra a doc da sua conta Cora no primeiro teste com credenciais reais.

import crypto from 'crypto'
import { coraConfigurado, coraApi, sbUsuario, usuarioDoToken } from '../lib.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function soDigitos(s) { return String(s || '').replace(/\D/g, '') }

// tolera variações de nomes de campos na resposta do Cora
function extrair(json) {
  const po = (json && (json.payment_options || json.payment_option)) || {}
  const bs = po.bank_slip || (json && json.bank_slip) || {}
  const pix = po.pix || (json && json.pix) || {}
  return {
    invoice_id: (json && (json.id || json.invoice_id)) || null,
    status: (json && json.status) || null,
    boleto_url: bs.url || (json && (json.url || json.pdf)) || null,
    linha_digitavel: bs.digitable || bs.barcode || (json && json.digitable) || null,
    pix_emv: pix.emv || pix.qr_code || pix.code || null
  }
}

export async function POST(request) {
  const { jwt, user } = await usuarioDoToken(request)
  if (!user) return Response.json({ erro: 'Faça login para emitir cobranças.' }, { status: 401 })
  if (!coraConfigurado()) {
    return Response.json({
      erro: 'A integração com o Cora ainda não está configurada no servidor (CORA_CLIENT_ID + certificado). ' +
            'Adicione as variáveis no .env.local do VPS e publique novamente.'
    }, { status: 503 })
  }

  let body = {}
  try { body = await request.json() } catch (e) {}
  const contato_id = String(body.contato_id || '').trim()
  const descricao = String(body.descricao || '').trim()
  const vencimento = String(body.vencimento || '').trim()
  const centavos = parseInt(body.valor_centavos, 10)
  if (!contato_id) return Response.json({ erro: 'Selecione o cliente.' }, { status: 400 })
  if (!descricao) return Response.json({ erro: 'Descreva a cobrança.' }, { status: 400 })
  if (!(centavos > 0)) return Response.json({ erro: 'Valor inválido.' }, { status: 400 })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento)) return Response.json({ erro: 'Vencimento inválido (use AAAA-MM-DD).' }, { status: 400 })

  const sb = sbUsuario(jwt)
  const { data: c, error: eC } = await sb.from('contatos').select('id,nome,email,cpf_cnpj').eq('id', contato_id).single()
  if (eC || !c) return Response.json({ erro: 'Cliente não encontrado.' }, { status: 404 })
  const doc = soDigitos(c.cpf_cnpj)
  if (doc.length !== 11 && doc.length !== 14) {
    return Response.json({ erro: 'O cliente precisa de CPF (11 dígitos) ou CNPJ (14 dígitos) cadastrado para emitir a cobrança.' }, { status: 400 })
  }

  const code = 'CMP-' + crypto.randomUUID()
  const invoiceBody = {
    code,
    customer: {
      name: c.nome || 'Cliente',
      email: c.email || undefined,
      document: { identity: doc, type: doc.length === 14 ? 'CNPJ' : 'CPF' }
    },
    services: [{ name: descricao.slice(0, 60), description: descricao, amount: centavos }],
    payment_terms: { due_date: vencimento },
    payment_forms: ['BANK_SLIP', 'PIX']
  }

  let r
  try {
    r = await coraApi('POST', '/v2/invoices', invoiceBody, { 'Idempotency-Key': code })
  } catch (e) {
    return Response.json({ erro: 'Erro ao falar com o Cora: ' + ((e && e.message) || e) }, { status: 502 })
  }
  if (!r || r.status < 200 || r.status >= 300) {
    return Response.json({
      erro: 'O Cora recusou a cobrança (' + ((r && r.status) || '?') + '). Detalhe: ' + String((r && r.raw) || '').slice(0, 400)
    }, { status: 502 })
  }
  const info = extrair(r.json || {})

  const linha = {
    contato_id,
    descricao,
    valor_centavos: centavos,
    vencimento,
    status: 'aberta',
    cora_invoice_id: info.invoice_id,
    cora_code: code,
    boleto_url: info.boleto_url,
    linha_digitavel: info.linha_digitavel,
    pix_emv: info.pix_emv
  }
  const { data: nova, error: eI } = await sb.from('cora_cobrancas').insert(linha).select().single()
  if (eI) return Response.json({ erro: 'Cobrança emitida no Cora, mas falhou ao salvar: ' + eI.message, cora: info }, { status: 500 })
  return Response.json({ ok: true, cobranca: nova })
}

export async function GET(request) {
  const { jwt, user } = await usuarioDoToken(request)
  if (!user) return Response.json({ erro: 'Faça login.' }, { status: 401 })
  const url = new URL(request.url)
  const status = url.searchParams.get('status')
  const contato = url.searchParams.get('contato_id')
  const sb = sbUsuario(jwt)
  let q = sb.from('cora_cobrancas').select('*').order('criado_em', { ascending: false }).limit(500)
  if (status) q = q.eq('status', status)
  if (contato) q = q.eq('contato_id', contato)
  const { data, error } = await q
  if (error) return Response.json({ erro: error.message }, { status: 500 })
  return Response.json({ ok: true, cobrancas: data || [] })
}
