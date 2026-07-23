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
  let contato_id = String(body.contato_id || '').trim()
  const descricao = String(body.descricao || '').trim()
  const vencimento = String(body.vencimento || '').trim()
  const centavos = parseInt(body.valor_centavos, 10)
  // CPF/CNPJ digitado no formulário (permite emitir p/ cliente novo ou completar cadastro)
  const docDigitado = soDigitos(body.cpf_cnpj)
  const nomeDigitado = String(body.nome || '').trim()
  const emailDigitado = String(body.email || '').trim()
  const aceitaCartao = body.cartao === true || body.cartao === 'true'
  const processoNumero = String(body.processo_numero || '').trim()
  if (!descricao) return Response.json({ erro: 'Descreva a cobrança.' }, { status: 400 })
  if (!(centavos > 0)) return Response.json({ erro: 'Valor inválido.' }, { status: 400 })
  // o Cora rejeita amount < 500 (R$ 5,00) — validamos aqui com mensagem amigável
  if (centavos < 500) return Response.json({ erro: 'O Cora exige valor mínimo de R$ 5,00 por cobrança.' }, { status: 400 })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vencimento)) return Response.json({ erro: 'Vencimento inválido (use AAAA-MM-DD).' }, { status: 400 })

  const sb = sbUsuario(jwt)
  let c = null
  if (contato_id) {
    const { data, error } = await sb.from('contatos').select('id,nome,email,cpf_cnpj').eq('id', contato_id).single()
    if (error || !data) return Response.json({ erro: 'Cliente não encontrado.' }, { status: 404 })
    c = data
  }
  // documento final: o do cadastro, ou o digitado agora
  let doc = soDigitos(c && c.cpf_cnpj)
  if (doc.length !== 11 && doc.length !== 14) doc = docDigitado
  if (doc.length !== 11 && doc.length !== 14) {
    return Response.json({ erro: 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) para emitir a cobrança.' }, { status: 400 })
  }
  // cliente NOVO (sem contato_id): cria o contato na hora com o que foi digitado —
  // permite emitir boleto sem nenhum processo cadastrado
  if (!c) {
    if (!nomeDigitado) return Response.json({ erro: 'Informe o nome do cliente.' }, { status: 400 })
    let esc = null
    try { const pf = await sb.from('usuarios').select('escritorio_id').eq('id', user.id).single(); esc = pf && pf.data && pf.data.escritorio_id } catch (e) {}
    // só colunas que existem em `contatos` (id, escritorio_id, nome, cpf_cnpj, telefone, email, tipo, criado_em)
    const reg = { nome: nomeDigitado, cpf_cnpj: doc, tipo: 'cliente' }
    if (emailDigitado) reg.email = emailDigitado
    if (esc) reg.escritorio_id = esc
    const ins = await sb.from('contatos').insert(reg).select('id,nome,email,cpf_cnpj').single()
    if (ins.error) return Response.json({ erro: 'Falha ao criar o cliente: ' + ins.error.message }, { status: 500 })
    c = ins.data; contato_id = c.id
  } else if (soDigitos(c.cpf_cnpj).length !== 11 && soDigitos(c.cpf_cnpj).length !== 14 && (doc.length === 11 || doc.length === 14)) {
    // contato existia sem doc: completa o cadastro com o CPF/CNPJ digitado
    try { await sb.from('contatos').update({ cpf_cnpj: doc }).eq('id', contato_id) } catch (e) {}
  }

  // o header Idempotency-Key do Cora exige um UUID puro; o code é nossa referência interna
  const idem = crypto.randomUUID()
  const code = 'CMP-' + idem
  const invoiceBody = {
    code,
    customer: {
      name: c.nome || 'Cliente',
      email: c.email || undefined,
      document: { identity: doc, type: doc.length === 14 ? 'CNPJ' : 'CPF' }
    },
    services: [{ name: descricao.slice(0, 60), description: descricao, amount: centavos }],
    payment_terms: { due_date: vencimento },
    // boleto + PIX sempre; cartão (link) quando solicitado no formulário
    payment_forms: aceitaCartao ? ['BANK_SLIP', 'PIX', 'CREDIT_CARD'] : ['BANK_SLIP', 'PIX']
  }

  let r
  try {
    r = await coraApi('POST', '/v2/invoices', invoiceBody, { 'Idempotency-Key': idem })
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
  if (processoNumero) linha.processo_numero = processoNumero
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

// DELETE /api/cora/cobrancas  body: { id, acao: 'cancelar' | 'apagar' }
//   'cancelar' → tenta cancelar o boleto no Cora e marca status='cancelada'
//   'apagar'   → remove a linha do financeiro (não desfaz no Cora)
export async function DELETE(request) {
  const { jwt, user } = await usuarioDoToken(request)
  if (!user) return Response.json({ erro: 'Faça login.' }, { status: 401 })
  let body = {}
  try { body = await request.json() } catch (e) {}
  const id = String(body.id || '').trim()
  const acao = String(body.acao || 'cancelar')
  if (!id) return Response.json({ erro: 'id da cobrança ausente.' }, { status: 400 })
  const sb = sbUsuario(jwt)
  const { data: c, error: eC } = await sb.from('cora_cobrancas').select('id,cora_invoice_id,status').eq('id', id).single()
  if (eC || !c) return Response.json({ erro: 'Cobrança não encontrada.' }, { status: 404 })

  if (acao === 'apagar') {
    const { error } = await sb.from('cora_cobrancas').delete().eq('id', id)
    if (error) return Response.json({ erro: error.message }, { status: 500 })
    return Response.json({ ok: true, apagada: true })
  }

  // cancelar no Cora (best-effort — se a conta não estiver configurada, só marca aqui)
  let coraMsg = ''
  if (c.cora_invoice_id && coraConfigurado()) {
    try {
      const r = await coraApi('DELETE', '/v2/invoices/' + encodeURIComponent(c.cora_invoice_id))
      if (!r || r.status < 200 || r.status >= 300) coraMsg = 'O Cora não confirmou o cancelamento (' + ((r && r.status) || '?') + '); a cobrança foi marcada como cancelada no sistema.'
    } catch (e) { coraMsg = 'Não foi possível falar com o Cora (' + ((e && e.message) || e) + '); marcada como cancelada só no sistema.' }
  }
  const { error: eU } = await sb.from('cora_cobrancas').update({ status: 'cancelada', atualizado_em: new Date().toISOString() }).eq('id', id)
  if (eU) return Response.json({ erro: eU.message }, { status: 500 })
  return Response.json({ ok: true, cancelada: true, aviso: coraMsg || undefined })
}
