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
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

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
  const transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user: smtpUser, pass } })
  try {
    const info = await transporter.sendMail({
      from: '"' + fromName + '" <' + smtpUser + '>',
      to: para,
      subject: assunto,
      text: corpo,
      html,
      attachments,
    })
    return Response.json({ ok: true, de: smtpUser, id: info && info.messageId })
  } catch (e) {
    return Response.json({ erro: 'falha ao enviar: ' + (e && e.message || e) }, { status: 502 })
  }
}
