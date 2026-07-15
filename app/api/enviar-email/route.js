// API do CMPGestão — envio de e-mail ao cliente pelo servidor (SMTP Hostinger).
// Garante que TODO e-mail sai de contato@cmpadvogados.com.br, independente de
// quem está logado no navegador. Monta e-mail HTML (logo embutido + Instagram)
// com fallback em texto puro.
//
//   POST /api/enviar-email  (Authorization: Bearer <jwt do Supabase>)
//   body: { para, assunto, corpo }
//
// Segurança: exige usuário autenticado. Credenciais SMTP vêm de variáveis de
// ambiente (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS) — nunca no código.

import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// âncora de thread determinística: todos os e-mails do MESMO processo+cliente
// compartilham a mesma raiz de References, então ficam agrupados como conversa no
// webmail/Gmail (e as respostas do cliente entram na mesma cadeia).
function raizThread(chave) {
  const h = crypto.createHash('sha1').update(String(chave || '')).digest('hex').slice(0, 28)
  return '<cmp-thread-' + h + '@cmpadvogados.com.br>'
}

// grava uma cópia do e-mail enviado na pasta "Enviados" (Sent) da caixa via IMAP.
// Best-effort: se falhar, o envio já ocorreu — devolvemos o motivo para o painel.
// imapflow é importado DINAMICAMENTE: se a lib faltar (npm install não rodou), o
// e-mail ainda é enviado e o painel mostra o motivo, em vez de quebrar a rota.
async function salvarEnviados(raw) {
  const host = process.env.IMAP_HOST || (process.env.SMTP_HOST || '').replace(/^smtp\./i, 'imap.') || 'imap.hostinger.com'
  const port = parseInt(process.env.IMAP_PORT || '993', 10)
  const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS
  if (!host || !user || !pass) return { ok: false, motivo: 'IMAP não configurado' }
  let ImapFlow
  try { ({ ImapFlow } = await import('imapflow')) }
  catch (e) { return { ok: false, motivo: 'imapflow ausente no servidor — rode "npm install" no VPS (' + ((e && e.message) || e) + ')' } }
  const client = new ImapFlow({ host, port, secure: port === 993, auth: { user, pass }, logger: false })
  try {
    await client.connect()
    // pastas-candidatas: INBOX.Sent PRIMEIRO (é o que o webmail Hostinger mostra como
    // "Enviado"), depois a marcada como \Sent e outros nomes comuns. Uma caixa pode ter
    // "Sent" (topo) E "INBOX.Sent"; só a segunda aparece no webmail.
    let detect = []
    try {
      const lista = await client.list()
      const esp = lista.find(m => m.specialUse === '\\Sent')
      if (esp && esp.path) detect.push(esp.path)
      for (const m of lista) { if (/(^|[./])sent( items)?$/i.test(m.path) || /enviad/i.test(m.path)) detect.push(m.path) }
    } catch (e) {}
    let candidatos = [...new Set(['INBOX.Sent'].concat(detect).concat(['Sent', 'INBOX/Sent', 'Sent Items', 'Enviados', 'INBOX.Enviados']))]
    let ultimo = ''
    for (const pasta of candidatos) {
      try { await client.append(pasta, raw, ['\\Seen']); try { await client.logout() } catch (e) {} return { ok: true, pasta } }
      catch (e) { ultimo = (e && e.message) || String(e) }
    }
    try { await client.logout() } catch (e) {}
    return { ok: false, motivo: 'nenhuma pasta de enviados aceitou a cópia (' + ultimo + ')' }
  } catch (e) {
    try { await client.logout() } catch (_) {}
    return { ok: false, motivo: 'IMAP ' + host + ':' + port + ' — ' + ((e && e.message) || String(e)) }
  }
}

async function usuario(request) {
  const auth = request.headers.get('authorization') || ''
  const jwt = auth.replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const u = await sb.auth.getUser(jwt)
  return (u && u.data && u.data.user) || null
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export async function POST(request) {
  const user = await usuario(request)
  if (!user) return Response.json({ erro: 'não autenticado' }, { status: 401 })

  const host = process.env.SMTP_HOST
  const port = parseInt(process.env.SMTP_PORT || '465', 10)
  const smtpUser = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  if (!host || !smtpUser || !pass) {
    return Response.json({ erro: 'SMTP não configurado no servidor (defina SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS).' }, { status: 500 })
  }

  let body
  try { body = await request.json() } catch (e) { return Response.json({ erro: 'json inválido' }, { status: 400 }) }
  const para = String(body.para || '').trim()
  const assunto = String(body.assunto || '').trim() || 'Atualização do seu processo'
  const corpo = String(body.corpo || '')
  const numero = String(body.numero || '').replace(/\D/g, '')
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(para)) return Response.json({ erro: 'e-mail do destinatário inválido' }, { status: 400 })
  if (!corpo.trim()) return Response.json({ erro: 'corpo vazio' }, { status: 400 })

  // logo embutido via CID (não depende de link externo)
  const attachments = []
  let logoTag = ''
  try {
    const lp = path.join(process.cwd(), 'public', 'logo_cmp_full.png')
    if (fs.existsSync(lp)) {
      attachments.push({ filename: 'logo.png', path: lp, cid: 'logocmp' })
      logoTag = '<img src="cid:logocmp" alt="Crispim Mendonça e Pinheiro Advogados" style="height:56px;margin-bottom:6px">'
    }
  } catch (e) {}

  const corpoHtml = esc(corpo).replace(/\n/g, '<br>')
  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1e2733;max-width:600px;margin:0 auto;padding:8px">' +
      '<div style="text-align:center;padding:6px 0 2px">' + logoTag + '</div>' +
      '<div style="border-top:3px solid #b8912e;padding:16px 6px;line-height:1.55">' + corpoHtml + '</div>' +
      '<div style="text-align:center;padding:14px 0;border-top:1px solid #eaeaea;margin-top:6px">' +
        '<div style="font-size:12px;color:#8a8f98;margin-bottom:8px">Acompanhe o escritório:</div>' +
        '<a href="https://instagram.com/cmpadvs" style="display:inline-block;background:#2E3A4B;color:#fff;text-decoration:none;padding:8px 16px;border-radius:20px;font-size:13px;margin:2px 4px">Instagram @cmpadvs</a>' +
        '<a href="https://instagram.com/djan.adv" style="display:inline-block;background:#2E3A4B;color:#fff;text-decoration:none;padding:8px 16px;border-radius:20px;font-size:13px;margin:2px 4px">Instagram @djan.adv</a>' +
      '</div>' +
    '</div>'

  const fromName = process.env.SMTP_FROM_NAME || 'Crispim Mendonça e Pinheiro Advogados'
  // cabeçalhos de conversa: raiz por (processo|cliente) — agrupa envios e respostas
  const raiz = raizThread((numero || 'sem-proc') + '|' + para.toLowerCase())
  const messageId = '<' + crypto.randomUUID() + '@cmpadvogados.com.br>'
  const dados = {
    from: '"' + fromName + '" <' + smtpUser + '>',
    to: para,
    subject: assunto,
    text: corpo,
    html,
    attachments,
    messageId,
    references: raiz,
    inReplyTo: raiz,
  }

  // monta a mensagem UMA vez (raw MIME) para enviar E salvar em Enviados de forma idêntica
  let raw
  try {
    const builder = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' })
    const built = await builder.sendMail(dados)
    raw = built && built.message
    if (!raw) throw new Error('mensagem vazia')
  } catch (e) {
    return Response.json({ erro: 'falha ao montar a mensagem: ' + (e && e.message || e) }, { status: 500 })
  }

  const transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user: smtpUser, pass } })
  try {
    // cópia oculta (BCC) de TODO envio para o e-mail pessoal do coordenador —
    // configurável por EMAIL_COPIA no .env.local; vazio ('') desliga.
    const copiaPara = process.env.EMAIL_COPIA !== undefined ? String(process.env.EMAIL_COPIA).trim() : 'djan.adv@gmail.com'
    const destinos = [para]
    if (copiaPara && /@/.test(copiaPara) && copiaPara.toLowerCase() !== para.toLowerCase()) destinos.push(copiaPara)
    const info = await transporter.sendMail({ envelope: { from: smtpUser, to: destinos }, raw })
    const copia = await salvarEnviados(raw)   // grava em "Enviados" (best-effort)
    return Response.json({ ok: true, de: smtpUser, id: (info && info.messageId) || messageId, copiado_enviados: copia.ok, copia_pasta: copia.pasta, copia_motivo: copia.ok ? undefined : copia.motivo })
  } catch (e) {
    return Response.json({ erro: 'falha ao enviar: ' + (e && e.message || e) }, { status: 502 })
  }
}
