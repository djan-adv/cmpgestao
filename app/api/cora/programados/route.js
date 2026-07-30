// Boletos PROGRAMADOS (parcelamento automático) — emitidos pelo robô diário.
//
//   GET /api/cora/programados?rodar=1
//     -> emite no Cora as parcelas cuja data de emissão chegou (emitir_em <= hoje),
//        salva em cora_cobrancas e envia o boleto por e-mail ao cliente.
//        Idempotente: cada linha sai de 'agendado' para 'emitido' (ou acumula
//        tentativas e vira 'erro' após 3 falhas). Chamado pelo /api/cron/tick.
//
// A programação em si é criada pela tela "Nova cobrança (Cora)" do sistema
// (opção de parcelar): a 1ª parcela sai na hora, as demais caem aqui.

import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { coraConfigurado, coraApi } from '../lib.js'
import { enviarEmailCore } from '../../enviar-email/enviar.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}
function hojeBrasilia() { return new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10) }
function soDigitos(s) { return String(s || '').replace(/\D/g, '') }

function extrair(json) {
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

function corpoEmail(nomeCli, prog, info) {
  const primeiro = String(nomeCli || '').trim().split(/\s+/)[0] || ''
  const venc = String(prog.vencimento || '').split('-').reverse().join('/')
  const valor = 'R$ ' + ((prog.valor_centavos || 0) / 100).toFixed(2).replace('.', ',')
  return 'Olá' + (primeiro ? (', ' + primeiro) : '') + '!\n\nSegue o boleto dos seus honorários' +
    (prog.processo_numero ? (' (processo ' + prog.processo_numero + ')') : '') + '.\n\n' +
    (prog.descricao ? ('Descrição: ' + prog.descricao + '\n') : '') +
    'Valor: ' + valor + (venc ? ('\nVencimento: ' + venc) : '') + '\n\n' +
    (info.boleto_url ? ('Boleto (link): ' + info.boleto_url + '\n') : '') +
    (info.linha_digitavel ? ('Linha digitável: ' + info.linha_digitavel + '\n') : '') +
    (info.pix_emv ? ('PIX copia-e-cola:\n' + info.pix_emv + '\n') : '') +
    '\nQualquer dúvida, estamos à disposição.\n\nCrispim, Mendonça e Pinheiro — Advogados\n0800 591 7259 · contato@cmpadvogados.com.br'
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  if (searchParams.get('rodar') === null) {
    return Response.json({ info: 'Robô das parcelas programadas. Use ?rodar=1 (chamado pelo cron).' })
  }
  if (!coraConfigurado()) return Response.json({ ok: false, erro: 'Cora não configurado no servidor.' }, { status: 503 })
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ ok: false, erro: 'falta service key' }, { status: 500 })

  const sb = admin()
  const hoje = hojeBrasilia()
  const { data: devidos, error } = await sb.from('boletos_programados')
    .select('*').eq('status', 'agendado').lte('emitir_em', hoje)
    .order('vencimento', { ascending: true }).limit(10)
  if (error) return Response.json({ ok: false, erro: error.message }, { status: 500 })

  const resultados = []
  for (const prog of (devidos || [])) {
    try {
      // dados do cliente (nome, e-mail, CPF/CNPJ) — o doc é obrigatório para o boleto
      let c = null
      if (prog.contato_id) {
        const rc = await sb.from('contatos').select('id,nome,email,cpf_cnpj').eq('id', prog.contato_id).single()
        c = rc.data || null
      }
      const doc = soDigitos(c && c.cpf_cnpj)
      if (doc.length !== 11 && doc.length !== 14) {
        await sb.from('boletos_programados').update({ status: 'erro', erro: 'cliente sem CPF/CNPJ no cadastro', atualizado_em: new Date().toISOString() }).eq('id', prog.id)
        resultados.push({ id: prog.id, ok: false, erro: 'sem CPF/CNPJ' })
        continue
      }

      const idem = crypto.randomUUID()
      const code = 'CMP-' + idem
      const invoiceBody = {
        code,
        customer: {
          name: (c && c.nome) || 'Cliente',
          email: (c && c.email) || undefined,
          document: { identity: doc, type: doc.length === 14 ? 'CNPJ' : 'CPF' }
        },
        services: [{ name: String(prog.descricao).slice(0, 60), description: prog.descricao, amount: prog.valor_centavos }],
        payment_terms: { due_date: prog.vencimento },
        payment_forms: prog.cartao ? ['BANK_SLIP', 'PIX', 'CREDIT_CARD'] : ['BANK_SLIP', 'PIX']
      }
      const r = await coraApi('POST', '/v2/invoices', invoiceBody, { 'Idempotency-Key': idem })
      if (!r || r.status < 200 || r.status >= 300) {
        const tent = (prog.tentativas || 0) + 1
        await sb.from('boletos_programados').update({
          tentativas: tent,
          status: tent >= 3 ? 'erro' : 'agendado',
          erro: 'Cora recusou (' + ((r && r.status) || '?') + '): ' + String((r && r.raw) || '').slice(0, 300),
          atualizado_em: new Date().toISOString()
        }).eq('id', prog.id)
        resultados.push({ id: prog.id, ok: false, erro: 'cora ' + ((r && r.status) || '?') })
        continue
      }
      const info = extrair(r.json || {})

      const linha = {
        escritorio_id: prog.escritorio_id,
        contato_id: prog.contato_id,
        descricao: prog.descricao,
        valor_centavos: prog.valor_centavos,
        vencimento: prog.vencimento,
        status: 'aberta',
        cora_invoice_id: info.invoice_id,
        cora_code: code,
        boleto_url: info.boleto_url,
        linha_digitavel: info.linha_digitavel,
        pix_emv: info.pix_emv,
        processo_numero: prog.processo_numero || null
      }
      const ins = await sb.from('cora_cobrancas').insert(linha).select('id').single()

      await sb.from('boletos_programados').update({
        status: 'emitido',
        cora_cobranca_id: (ins.data && ins.data.id) || null,
        erro: null,
        atualizado_em: new Date().toISOString()
      }).eq('id', prog.id)

      // envia por e-mail (best-effort; a cobrança já está emitida e listada no Financeiro)
      let enviado = false
      if (c && c.email) {
        try {
          const env = await enviarEmailCore({
            para: c.email,
            assunto: 'Boleto para pagamento — vencimento ' + String(prog.vencimento).split('-').reverse().join('/'),
            corpo: corpoEmail(c.nome, prog, info),
            numero: prog.processo_numero || '',
            dedup: true
          })
          enviado = !!(env && env.ok)
        } catch (e) {}
      }
      resultados.push({ id: prog.id, ok: true, email: enviado })
    } catch (e) {
      const tent = (prog.tentativas || 0) + 1
      try {
        await sb.from('boletos_programados').update({
          tentativas: tent,
          status: tent >= 3 ? 'erro' : 'agendado',
          erro: String((e && e.message) || e).slice(0, 300),
          atualizado_em: new Date().toISOString()
        }).eq('id', prog.id)
      } catch (_) {}
      resultados.push({ id: prog.id, ok: false, erro: String((e && e.message) || e) })
    }
  }
  return Response.json({ ok: true, processados: resultados.length, resultados })
}
