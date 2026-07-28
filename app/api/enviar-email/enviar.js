// Motor de envio de e-mail do CMPGestão (SMTP Hostinger) — um lugar só, usado por:
//   • /api/enviar-email        → envio na hora, pedido pelo painel
//   • /api/cron/email-fila     → envio da fila com hora marcada (horário da vara)
// Garante que TODO e-mail sai de contato@cmpadvogados.com.br, com logo embutido,
// cópia oculta ao coordenador, cópia na pasta "Enviados" e trava anti-repetição.

import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

// âncora de thread determinística: todos os e-mails do MESMO processo+destinatário
// compartilham a mesma raiz de References, então ficam agrupados como conversa no
// webmail/Gmail (e as respostas entram na mesma cadeia).
function raizThread(chave) {
  const h = crypto.createHash('sha1').update(String(chave || '')).digest('hex').slice(0, 28)
  return '<cmp-thread-' + h + '@cmpadvogados.com.br>'
}

export { raizThread }

// Guarda a raiz da conversa → processo. É o que permite reconhecer a RESPOSTA:
// ela volta com essa raiz em References, e o robô da caixa acha o processo sem
// depender de o remetente citar o número. Best-effort — não derruba o envio.
async function anotarThread(raiz, numero, destinatario) {
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!svcKey) return
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, svcKey, { auth: { persistSession: false } })
    await sb.from('email_threads').upsert({ raiz, numero: numero || null, destinatario }, { onConflict: 'raiz' })
  } catch (e) {}
}

// endereço público do sistema — os links do e-mail (pixel, botão de confirmar)
// precisam funcionar no celular do cliente, então nunca podem ser 127.0.0.1
export const URL_PUBLICA = (process.env.PUBLIC_URL || 'https://gestao.cmpadvogados.com.br').replace(/\/+$/, '')

let _escCache = null
async function escritorioPadrao(sb) {
  if (_escCache) return _escCache
  try { const r = await sb.from('escritorios').select('id').order('criado_em', { ascending: true }).limit(1).single(); _escCache = (r.data && r.data.id) || null } catch (e) {}
  return _escCache
}

// Cria o token de rastreio deste envio (pixel de abertura e, se for aviso de
// audiência, o botão "confirmo presença"). Best-effort: sem service key ou com
// erro no banco, o e-mail sai sem rastreio — nunca deixa de sair por causa disso.
async function criarRastreio({ para, numero, assunto, eventoId }) {
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!svcKey) return null
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, svcKey, { auth: { persistSession: false } })
    const token = crypto.randomUUID().replace(/-/g, '')
    const ins = await sb.from('email_rastreio').insert({
      token, escritorio_id: await escritorioPadrao(sb),
      para: String(para || '').toLowerCase(), numero: numero || '', assunto: (assunto || '').slice(0, 300),
      evento_id: eventoId || null,
    }).select('id').single()
    if (ins.error) return null
    return token
  } catch (e) { return null }
}

export function emailValido(e) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || '').trim()) }
export function hashEmail(assunto, corpo) { return crypto.createHash('sha1').update(String(assunto) + '\n' + String(corpo)).digest('hex') }

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

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// Envia de fato. Devolve { ok, de, id, copiado_enviados, copia_pasta, copia_motivo }
// ou { erro, status, repetido }. Nunca lança.
// confirmarEventoId: id do evento da agenda — liga o botão "✅ Confirmo presença"
// dentro do e-mail; o clique do cliente confirma o evento sozinho.
export async function enviarEmailCore({ para, cc, assunto, corpo, numero, dedup = true, inReplyTo = '', confirmarEventoId = null }) {
  const host = process.env.SMTP_HOST
  const port = parseInt(process.env.SMTP_PORT || '465', 10)
  const smtpUser = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  if (!host || !smtpUser || !pass) {
    return { erro: 'SMTP não configurado no servidor (defina SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS).', status: 500 }
  }

  para = String(para || '').trim()
  cc = String(cc || '').trim()
  assunto = String(assunto || '').trim() || 'Atualização do seu processo'
  corpo = String(corpo || '')
  numero = String(numero || '').replace(/\D/g, '')
  if (!emailValido(para)) return { erro: 'e-mail do destinatário inválido', status: 400 }
  if (cc && !emailValido(cc)) return { erro: 'e-mail da cópia (cc) inválido', status: 400 }
  if (!corpo.trim()) return { erro: 'corpo vazio', status: 400 }

  // Trava anti-repetição: mesmo destinatário + mesmo processo + mesmo conteúdo
  // NO MESMO DIA não reenvia (amanhã libera). Varas com vários processos recebem
  // normalmente — o bloqueio é por processo (campo `numero`). Grava o marcador
  // ANTES de enviar (unique no banco); se o envio falhar, remove para permitir
  // nova tentativa. Se a infra do dedup falhar, o envio segue sem bloquear.
  let dedupAdmin = null, dedupId = null
  const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (dedup && svcKey) {
    try {
      dedupAdmin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, svcKey, { auth: { persistSession: false } })
      const ins = await dedupAdmin.from('emails_enviados_dedup').insert({ para: para.toLowerCase(), numero: numero || '', hash: hashEmail(assunto, corpo) }).select('id').single()
      if (ins.error) {
        if (String(ins.error.code) === '23505') {
          return {
            erro: 'BLOQUEADO — repetição: um e-mail com este mesmo conteúdo, para este destinatário e este processo, já foi enviado HOJE. Para não repetir, o reenvio libera amanhã; se for um aviso realmente novo, altere o texto.',
            repetido: true,
            status: 409,
          }
        }
        // falha diferente no dedup (tabela ausente etc.): não bloqueia o envio
      } else { dedupId = ins.data && ins.data.id }
    } catch (e) { /* dedup indisponível: segue sem bloquear */ }
  }

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

  // rastreio: pixel de abertura + (se for aviso de audiência) botão de confirmar
  const tokenRastreio = await criarRastreio({ para, numero, assunto, eventoId: confirmarEventoId })
  let blocoConfirmar = ''
  if (tokenRastreio && confirmarEventoId) {
    const urlConf = URL_PUBLICA + '/api/email/confirmar?t=' + tokenRastreio
    blocoConfirmar =
      '<div style="text-align:center;padding:6px 0 14px">' +
        '<a href="' + urlConf + '" style="display:inline-block;background:#0F6E56;color:#fff;text-decoration:none;padding:12px 26px;border-radius:24px;font-size:15px;font-weight:700">&#9989; Confirmo que recebi este aviso</a>' +
        '<div style="font-size:11.5px;color:#8a8f98;margin-top:6px">Um clique basta — n&atilde;o precisa responder este e-mail.</div>' +
      '</div>'
  }
  const pixel = tokenRastreio
    ? '<img src="' + URL_PUBLICA + '/api/email/abertura?t=' + tokenRastreio + '" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0">'
    : ''

  const corpoHtml = esc(corpo).replace(/\n/g, '<br>')
  const html =
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1e2733;max-width:600px;margin:0 auto;padding:8px">' +
      '<div style="text-align:center;padding:6px 0 2px">' + logoTag + '</div>' +
      '<div style="border-top:3px solid #b8912e;padding:16px 6px;line-height:1.55">' + corpoHtml + '</div>' +
      blocoConfirmar +
      '<div style="text-align:center;padding:14px 0;border-top:1px solid #eaeaea;margin-top:6px">' +
        '<div style="font-size:12px;color:#8a8f98;margin-bottom:8px">Acompanhe o escritório:</div>' +
        '<a href="https://instagram.com/cmpadvs" style="display:inline-block;background:#2E3A4B;color:#fff;text-decoration:none;padding:8px 16px;border-radius:20px;font-size:13px;margin:2px 4px">Instagram @cmpadvs</a>' +
        '<a href="https://instagram.com/djan.adv" style="display:inline-block;background:#2E3A4B;color:#fff;text-decoration:none;padding:8px 16px;border-radius:20px;font-size:13px;margin:2px 4px">Instagram @djan.adv</a>' +
        '<a href="https://gestao.cmpadvogados.com.br/areas-atuacao.html" style="display:inline-block;background:#C9A227;color:#fff;text-decoration:none;padding:8px 16px;border-radius:20px;font-size:13px;margin:2px 4px">Nosso site — áreas de atuação</a>' +
      '</div>' +
    '</div>'

  const fromName = process.env.SMTP_FROM_NAME || 'Crispim Mendonça e Pinheiro Advogados'
  // cabeçalhos de conversa: raiz por (processo|destinatário) — agrupa envios e respostas
  const raiz = raizThread((numero || 'sem-proc') + '|' + para.toLowerCase())
  await anotarThread(raiz, numero, para.toLowerCase())
  const messageId = '<' + crypto.randomUUID() + '@cmpadvogados.com.br>'
  const dados = {
    from: '"' + fromName + '" <' + smtpUser + '>',
    to: para,
    subject: assunto,
    // texto puro: o link de confirmação vai por extenso (clientes sem HTML)
    text: corpo + ((tokenRastreio && confirmarEventoId) ? ('\n\nPara confirmar que recebeu este aviso, basta abrir o link (um clique, sem precisar responder):\n' + URL_PUBLICA + '/api/email/confirmar?t=' + tokenRastreio) : ''),
    html,
    attachments,
    messageId,
    // respondendo: a cadeia carrega a raiz E a mensagem respondida, para o
    // cliente/vara ver a resposta encaixada na conversa dele
    references: inReplyTo ? (raiz + ' ' + inReplyTo) : raiz,
    inReplyTo: inReplyTo || raiz,
  }
  if (cc) dados.cc = cc

  // monta a mensagem UMA vez (raw MIME) para enviar E salvar em Enviados de forma idêntica
  let raw
  try {
    const builder = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' })
    const built = await builder.sendMail(dados)
    raw = built && built.message
    if (!raw) throw new Error('mensagem vazia')
  } catch (e) {
    if (dedupAdmin && dedupId) { try { await dedupAdmin.from('emails_enviados_dedup').delete().eq('id', dedupId) } catch (_) {} }
    return { erro: 'falha ao montar a mensagem: ' + ((e && e.message) || e), status: 500 }
  }

  const transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user: smtpUser, pass } })
  try {
    // cópia oculta (BCC) de TODO envio para o e-mail pessoal do coordenador —
    // configurável por EMAIL_COPIA no .env.local; vazio ('') desliga.
    const copiaPara = process.env.EMAIL_COPIA !== undefined ? String(process.env.EMAIL_COPIA).trim() : 'djan.adv@gmail.com'
    const destinos = [para]
    if (cc && cc.toLowerCase() !== para.toLowerCase()) destinos.push(cc)
    if (copiaPara && /@/.test(copiaPara) && !destinos.some(d => d.toLowerCase() === copiaPara.toLowerCase())) destinos.push(copiaPara)
    const info = await transporter.sendMail({ envelope: { from: smtpUser, to: destinos }, raw })
    const copia = await salvarEnviados(raw)   // grava em "Enviados" (best-effort)
    return { ok: true, de: smtpUser, id: (info && info.messageId) || messageId, copiado_enviados: copia.ok, copia_pasta: copia.pasta, copia_motivo: copia.ok ? undefined : copia.motivo }
  } catch (e) {
    // envio falhou: solta a trava anti-repetição para permitir tentar de novo hoje
    if (dedupAdmin && dedupId) { try { await dedupAdmin.from('emails_enviados_dedup').delete().eq('id', dedupId) } catch (_) {} }
    return { erro: 'falha ao enviar: ' + ((e && e.message) || e), status: 502 }
  }
}
