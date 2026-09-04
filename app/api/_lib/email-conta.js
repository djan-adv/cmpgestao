// E-mail de CONTA (senha provisória, boas-vindas, avisos do teste). Sai sempre
// pela conta DO PRODUTO (ver email-produto.js): quem recebe estas mensagens é
// cliente do sistema, não do escritório que opera a instalação — e recebê-las
// com o endereço de uma banca de advocacia é, na melhor hipótese, confuso.
//
// Deliberadamente separado do
// /api/enviar-email, que é o envio jurídico: aquele tem trava anti-repetição
// por processo, cópia oculta para o coordenador, gravação na pasta "Enviados" e
// pixel de rastreio. Nada disso cabe aqui — a senha de um cliente novo não pode
// ser bloqueada por "repetição", nem sair em cópia oculta para outra pessoa,
// nem ficar registrada no acervo de e-mails do escritório.

import { contaProduto } from './email-produto.js'

// Mantida porque outras rotas importam daqui; agora devolve o transporte da
// conta do produto.
export function transporte() {
  const c = contaProduto()
  return c ? c.t : null
}

function escapar(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// Devolve { ok:true } ou { erro }. Nunca derruba a criação da conta: quem chama
// decide o que fazer quando o e-mail não sai (mostrar a senha na tela, por ex.).
export async function enviarEmailConta({ para, assunto, titulo, linhas, botao }) {
  const c = contaProduto()
  if (!c) return { erro: 'SMTP não configurado no servidor.' }
  const corpo = `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;color:#22303f;line-height:1.55">
  <h2 style="margin:0 0 14px;font-size:19px">${escapar(titulo)}</h2>
  ${(linhas || []).map(l => `<p style="margin:0 0 10px">${l}</p>`).join('')}
  ${botao ? `<p style="margin:18px 0"><a href="${escapar(botao.url)}" style="background:#2E3A4B;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;display:inline-block">${escapar(botao.texto)}</a></p>` : ''}
</div>`
  try {
    await c.t.sendMail({
      from: '"' + c.nome + '" <' + c.user + '>',
      to: para,
      subject: assunto,
      html: corpo,
    })
    return { ok: true, conta: c.user, propria: c.propria }
  } catch (e) {
    return { erro: String((e && e.message) || e) }
  }
}
