// Robô da ASSINATURA de monitoramento (crontab). Autossuficiente (não importa de
// outra rota). Duas tarefas:
//   GET /api/monitoramento/robo?tarefa=cobrar   -> (diário) baixa pagamentos das
//        assinaturas, emite o boleto do próximo ciclo e SUSPENDE quem passou de
//        30 dias sem pagar.
//   GET /api/monitoramento/robo?tarefa=varrer   -> (segunda e sexta) varre novos
//        processos no nome de cada assinante ATIVO e avisa por e-mail só os NOVOS.

import crypto from 'crypto'
import nodemailer from 'nodemailer'
import { createClient } from '@supabase/supabase-js'
import { coraConfigurado, coraApi } from '../../cora/lib.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ESCRITORIO_CMP = '908f77fc-19f5-4d86-9576-f5590af09e0a'
const DJEN = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao'
const UA = 'Mozilla/5.0 (compatible; CMPGestao/1.0)'
const iso = (d) => d.toISOString().slice(0, 10)
const soDig = (s) => String(s || '').replace(/\D/g, '')
function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }) }
function escH(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }
function maskCNJ(d) { d = soDig(d); if (d.length !== 20) return d; return d.slice(0, 7) + '-' + d.slice(7, 9) + '.' + d.slice(9, 13) + '.' + d.slice(13, 14) + '.' + d.slice(14, 16) + '.' + d.slice(16) }
function smtp() {
  const host = process.env.SMTP_HOST, port = parseInt(process.env.SMTP_PORT || '465', 10), user = process.env.SMTP_USER, pass = process.env.SMTP_PASS
  if (!host || !user || !pass) return null
  return { t: nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } }), user }
}
async function enviar(to, assunto, html) {
  const s = smtp(); if (!s || !to) return false
  try { await s.t.sendMail({ from: '"Crispim, Mendonça e Pinheiro Advogados" <' + s.user + '>', to, subject: assunto, html }); return true } catch (e) { return false }
}
function extrairCora(json) {
  const po = (json && (json.payment_options || json.payment_option)) || {}
  const bs = po.bank_slip || (json && json.bank_slip) || {}
  const pix = po.pix || (json && json.pix) || {}
  return { invoice_id: (json && (json.id || json.invoice_id)) || null, boleto_url: bs.url || (json && (json.url || json.pdf)) || null, linha_digitavel: bs.digitable || bs.barcode || null, pix_emv: pix.emv || pix.qr_code || pix.code || null }
}
async function emitirBoleto(sb, { nome, doc, email, valor, descricao }) {
  const idem = crypto.randomUUID(); const code = 'MASS-' + idem
  const venc = iso(new Date(Date.now() + 3 * 86400000))
  const invoiceBody = { code, customer: { name: nome, email: email || undefined, document: { identity: doc, type: doc.length === 14 ? 'CNPJ' : 'CPF' } }, services: [{ name: 'Assinatura de monitoramento', description: descricao, amount: valor }], payment_terms: { due_date: venc }, payment_forms: ['BANK_SLIP', 'PIX'] }
  let r
  try { r = await coraApi('POST', '/v2/invoices', invoiceBody, { 'Idempotency-Key': idem }) } catch (e) { return null }
  if (!r || r.status < 200 || r.status >= 300) return null
  const info = extrairCora(r.json || {})
  const cob = await sb.from('cora_cobrancas').insert({ escritorio_id: ESCRITORIO_CMP, descricao, valor_centavos: valor, vencimento: venc, status: 'aberta', cora_invoice_id: info.invoice_id, cora_code: code, boleto_url: info.boleto_url, linha_digitavel: info.linha_digitavel, pix_emv: info.pix_emv }).select('id').single()
  return { cobrancaId: cob && cob.data && cob.data.id, info }
}
async function buscaDjenPorNome(nome, dias) {
  const fim = new Date(), ini = new Date(Date.now() - dias * 86400000)
  const base = `${DJEN}?nomeParte=${encodeURIComponent(nome)}&dataDisponibilizacaoInicio=${iso(ini)}&dataDisponibilizacaoFim=${iso(fim)}&meio=D`
  let itens = [], pagina = 1
  while (pagina <= 10) {
    let r
    try { r = await fetch(`${base}&pagina=${pagina}&itensPorPagina=100`, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(25000) }) } catch (e) { break }
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
    if (!por[dig] || data > por[dig].data) por[dig] = { numero: dig, tribunal: trib, data, resumo: texto.slice(0, 200) }
  }
  return Object.values(por)
}

export async function GET(request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ erro: 'falta service key' }, { status: 500 })
  const { searchParams } = new URL(request.url)
  const tarefa = searchParams.get('tarefa') || ''
  const sb = admin()

  if (tarefa === 'cobrar') {
    if (!coraConfigurado()) return Response.json({ erro: 'Cora não configurado.' }, { status: 503 })
    const hoje = new Date()
    const { data: asss } = await sb.from('monit_assinaturas').select('*').eq('status', 'ativa').limit(500)
    let pagos = 0, emitidos = 0, suspensos = 0
    for (const a of (asss || [])) {
      if (a.cobranca_atual_id) {
        const { data: c } = await sb.from('cora_cobrancas').select('status,pago_em,criado_em').eq('id', a.cobranca_atual_id).single()
        if (c && c.status === 'paga') {
          const prox = new Date((c.pago_em ? new Date(c.pago_em) : hoje).getTime() + 30 * 86400000)
          await sb.from('monit_assinaturas').update({ ultimo_pago_em: c.pago_em || hoje.toISOString(), cobranca_atual_id: null, proximo_boleto: iso(prox) }).eq('id', a.id)
          pagos++; a.cobranca_atual_id = null; a.proximo_boleto = iso(prox)
        } else if (c && c.criado_em && (hoje - new Date(c.criado_em)) > 30 * 86400000) {
          await sb.from('monit_assinaturas').update({ status: 'suspensa' }).eq('id', a.id)
          suspensos++; continue
        }
      }
      if (!a.cobranca_atual_id && a.proximo_boleto && a.proximo_boleto <= iso(hoje)) {
        const emis = await emitirBoleto(sb, { nome: a.nome, doc: a.doc, email: a.email, valor: a.preco_centavos, descricao: 'Assinatura mensal de monitoramento — ' + a.nome })
        if (emis) {
          await sb.from('monit_assinaturas').update({ cobranca_atual_id: emis.cobrancaId }).eq('id', a.id)
          emitidos++
          await enviar(a.email, 'Boleto da sua assinatura de monitoramento', '<div style="font-family:Arial;font-size:14px;color:#1e2733;max-width:600px;margin:0 auto;padding:8px"><div style="border-top:3px solid #b8912e;padding:14px 6px"><p>Olá, ' + escH((a.nome || '').split(' ')[0]) + '! Segue o boleto da sua assinatura mensal de monitoramento (R$ ' + (a.preco_centavos / 100).toFixed(2).replace('.', ',') + ').</p>' + (emis.info.boleto_url ? '<p><a href="' + emis.info.boleto_url + '" style="display:inline-block;background:#0F6E56;color:#fff;text-decoration:none;padding:11px 20px;border-radius:9px;font-weight:700">Pagar o boleto</a></p>' : '') + '<p style="font-size:12px;color:#697180">Após 30 dias sem pagamento, a emissão é suspensa até nova contratação.</p></div></div>')
        }
      }
    }
    return Response.json({ ok: true, tarefa, pagos, emitidos, suspensos })
  }

  if (tarefa === 'varrer') {
    const { data: asss } = await sb.from('monit_assinaturas').select('*').eq('status', 'ativa').limit(500)
    let varridos = 0, avisos = 0
    for (const a of (asss || [])) {
      const emDia = a.ultimo_pago_em && (Date.now() - new Date(a.ultimo_pago_em)) < 35 * 86400000
      if (!emDia) continue
      let achados = []
      try { achados = await buscaDjenPorNome(a.nome, 10) } catch (e) { continue }
      const vistos = new Set((Array.isArray(a.processos_vistos) ? a.processos_vistos : []).map(String))
      const novos = achados.filter(p => !vistos.has(String(p.numero)))
      varridos++
      if (novos.length) {
        const linhas = novos.map(p => '<div style="padding:6px 0;border-top:1px dashed #e4e8ef"><b>' + escH(maskCNJ(p.numero)) + '</b> <span style="color:#697180;font-size:12px">' + escH(p.tribunal || '') + (p.data ? ' · ' + p.data.split('-').reverse().join('/') : '') + '</span><div style="font-size:12.5px;color:#445;margin-top:2px">' + escH((p.resumo || '').slice(0, 200)) + '…</div></div>').join('')
        const ok = await enviar(a.email, 'Novo(s) processo(s) identificado(s) no seu nome', '<div style="font-family:Arial;font-size:14px;color:#1e2733;max-width:640px;margin:0 auto;padding:8px"><div style="border-top:3px solid #b8912e;padding:14px 6px"><h2 style="color:#2E3A4B;font-size:17px;margin:0 0 6px">Monitoramento: ' + novos.length + ' novo(s) processo(s)</h2><p style="font-size:13px;color:#697180;margin:0 0 10px">Olá, ' + escH((a.nome || '').split(' ')[0]) + '! Na varredura de hoje identificamos publicações em processos que ainda não constavam no seu acompanhamento:</p>' + linhas + '<div style="background:#f3f7fb;border:1px solid #d9e6f2;border-radius:10px;padding:11px 13px;font-size:12px;color:#345;margin-top:10px">🔒 Uso pessoal (LGPD). Quer que cuidemos de algum deles? Responda este e-mail ou fale com o escritório.</div><p style="font-size:12px;color:#8a8f98;text-align:center;margin-top:12px">Crispim, Mendonça e Pinheiro Advogados</p></div></div>')
        if (ok) avisos++
      }
      const todos = Array.from(new Set(Array.from(vistos).concat(achados.map(p => String(p.numero)))))
      await sb.from('monit_assinaturas').update({ processos_vistos: todos, ultima_varredura: new Date().toISOString() }).eq('id', a.id)
    }
    return Response.json({ ok: true, tarefa, varridos, avisos })
  }

  return Response.json({ erro: 'use ?tarefa=cobrar ou ?tarefa=varrer' }, { status: 400 })
}
