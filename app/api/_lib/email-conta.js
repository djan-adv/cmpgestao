// E-mail de CONTA (senha provisória, boas-vindas). Deliberadamente separado do
// /api/enviar-email, que é o envio jurídico: aquele tem trava anti-repetição
// por processo, cópia oculta para o coordenador, gravação na pasta "Enviados" e
// pixel de rastreio. Nada disso cabe aqui — a senha de um cliente novo não pode
// ser bloqueada por "repetição", nem sair em cópia oculta para outra pessoa,
// nem ficar registrada no acervo de e-mails do escritório.

import nodemailer from 'nodemailer'

export function transporte() {
  const host = process.env.SMTP_HOST
  const port = parseInt(process.env.SMTP_PORT || '465', 10)
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  if (!host || !user || !pass) return null
  return nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } })
}

function escapar(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Devolve { ok:true } ou { erro }. Nunca derruba a criação da conta: quem chama
// decide o que fazer quando o e-mail não sai (mostrar a senha na tela, por ex.).
export async function enviarEmailConta({ para, assunto, titulo, linhas, botao }) {
  const t = transporte()
  if (!t) return { erro: 'SMTP não configurado no servidor.' }
  const corpo = `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#22303f;line-height:1.55">
  <h2 style="margin:0 0 14px;font-size:19px">${escapar(titulo)}</h2>
  ${(linhas || []).map(l => `<p style="margin:0 0 10px">${l}</p>`).join('')}
  ${botao ? `<p style="margin:18px 0"><a href="${escapar(botao.url)}" style="background:#2E3A4B;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;display:inline-block">${escapar(botao.texto)}</a></p>` : ''}
</div>`
  try {
    await t.sendMail({
      from: '"' + (process.env.SMTP_FROM_NAME || 'Gestão') + '" <' + process.env.SMTP_USER + '>',
      to: para,
      subject: assunto,
      html: corpo,
    })
    return { ok: true }
  } catch (e) {
    return { erro: String((e && e.message) || e) }
  }
}
