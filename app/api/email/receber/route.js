// Caixa de entrada do escritório — lê as respostas por IMAP e leva cada uma para
// o HISTÓRICO do processo certo.
//
//   GET /api/email/receber          → importa o que chegou desde a última leitura
//   GET /api/email/receber?dias=7   → primeira carga: varre os últimos N dias
//
// Como a resposta acha o processo, nesta ordem:
//   1. thread  — a resposta traz de volta a raiz de References que usamos no envio
//                (email_threads). É o caminho exato, não depende do texto.
//   2. numero  — o número CNJ aparece no assunto ou no corpo e bate com um processo.
//   3. contato — o remetente é o e-mail cadastrado da vara e ela só tem UM processo
//                ativo nosso. Com mais de um, não chuta.
//
// O que não casa NÃO vai para o histórico de ninguém: fica na caixa, para
// classificar à mão. Melhor um e-mail sem processo do que no processo errado.
//
// Nunca lê a caixa inteira: guarda o último UID em email_imap_estado e só pega o
// que veio depois. Se o servidor recriar a caixa (uidvalidity muda), recomeça.

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0
export const maxDuration = 120

const MAX_MSGS = 60                 // por rodada
const MAX_CORPO = 60 * 1024         // guarda no máximo 60 KB de texto por e-mail

function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }) }
const soDig = (s) => String(s || '').replace(/\D/g, '')

// tira a citação do e-mail anterior — o que interessa é o que a pessoa escreveu agora
function limpaResposta(txt) {
  let t = String(txt || '').replace(/\r\n/g, '\n')
  const cortes = [
    /\n[ \t]*(?:Em|On)\b[^\n]{0,120}(?:escreveu|wrote)\s*:?\s*\n/i,
    /\n-{2,}\s*(?:Mensagem original|Original Message|Forwarded message)\s*-{2,}/i,
    /\n[ \t]*De:\s*[^\n]+\n[ \t]*Enviada?(?: em)?:/i,
    /\n[ \t]*_{10,}\s*\n/,
  ]
  for (const re of cortes) { const m = t.match(re); if (m && m.index > 40) t = t.slice(0, m.index) }
  // linhas citadas com ">" no fim do texto
  t = t.replace(/(\n>[^\n]*)+\s*$/g, '')
  return t.replace(/\n{3,}/g, '\n\n').trim()
}

function htmlParaTexto(h) {
  return String(h || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

// acha o número da parte text/plain (ou text/html) dentro da estrutura MIME
function achaParteTexto(node, caminho = '') {
  if (!node) return null
  const tipo = String(node.type || '').toLowerCase()
  if (tipo === 'text/plain' && (!node.disposition || node.disposition === 'inline')) return { part: node.part || caminho || '1', html: false }
  if (Array.isArray(node.childNodes) && node.childNodes.length) {
    for (const c of node.childNodes) { const r = achaParteTexto(c); if (r && !r.html) return r }
    for (const c of node.childNodes) {
      const t = String(c.type || '').toLowerCase()
      if (t === 'text/html') return { part: c.part || '1', html: true }
      if (Array.isArray(c.childNodes) && c.childNodes.length) { const r = achaParteTexto(c); if (r) return r }
    }
  }
  if (tipo === 'text/html') return { part: node.part || caminho || '1', html: true }
  return null
}

async function lerStream(st) {
  const pedacos = []; let total = 0
  for await (const c of st) { pedacos.push(c); total += c.length; if (total > MAX_CORPO) break }
  return Buffer.concat(pedacos).toString('utf8')
}

export async function GET(request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ erro: 'falta service key' }, { status: 500 })
  const { searchParams } = new URL(request.url)
  const dias = parseInt(searchParams.get('dias') || '0', 10)

  const host = process.env.IMAP_HOST || (process.env.SMTP_HOST || '').replace(/^smtp\./i, 'imap.') || 'imap.hostinger.com'
  const port = parseInt(process.env.IMAP_PORT || '993', 10)
  const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS
  if (!host || !user || !pass) return Response.json({ erro: 'IMAP não configurado (SMTP_USER/SMTP_PASS)' }, { status: 500 })

  let ImapFlow
  try { ({ ImapFlow } = await import('imapflow')) }
  catch (e) { return Response.json({ erro: 'imapflow ausente no servidor — rode "npm install" no VPS' }, { status: 500 }) }

  const sb = admin()

  // escritório: a caixa é uma só, do escritório do sistema
  const esc = await sb.from('escritorios').select('id').order('criado_em', { ascending: true }).limit(1).single()
  if (esc.error || !esc.data) return Response.json({ erro: 'escritório não encontrado' }, { status: 500 })
  const escritorioId = esc.data.id

  const est = await sb.from('email_imap_estado').select('*').eq('id', 1).single()
  let ultimaUid = (est.data && est.data.ultima_uid) || 0
  const uidvAnterior = (est.data && est.data.uidvalidity) || null

  // processos e contatos, para casar as respostas
  const [procs, contatos] = await Promise.all([
    sb.from('processos').select('id,numero,numero_digitos,status').limit(5000),
    sb.from('contatos_orgao').select('email').limit(2000),
  ])
  const porNumero = {}
  ;(procs.data || []).forEach(p => { const d = p.numero_digitos || soDig(p.numero); if (d) porNumero[d] = p })
  const numeros = Object.keys(porNumero)

  const client = new ImapFlow({ host, port, secure: port === 993, auth: { user, pass }, logger: false })
  const importados = []
  let vistos = 0, pulados = 0
  let lock
  try {
    await client.connect()
    lock = await client.getMailboxLock('INBOX')
    const uidv = Number(client.mailbox.uidValidity)
    // caixa recriada no servidor: os UIDs antigos não valem mais
    if (uidvAnterior && uidvAnterior !== uidv) ultimaUid = 0

    // o que buscar: por UID (rotina) ou por data (primeira carga / recuperação)
    let range, opts
    if (dias > 0 || !ultimaUid) {
      const desde = new Date(Date.now() - (dias > 0 ? dias : 3) * 86400000)
      const achados = await client.search({ since: desde }, { uid: true })
      const lista = (achados || []).filter(u => u > ultimaUid).slice(-MAX_MSGS)
      range = lista.length ? lista.join(',') : null
      opts = { uid: true }
    } else {
      range = (ultimaUid + 1) + ':*'
      opts = { uid: true }
    }

    if (range) {
      const msgs = []
      for await (const m of client.fetch(range, { uid: true, envelope: true, bodyStructure: true, headers: ['references', 'in-reply-to', 'list-unsubscribe', 'auto-submitted', 'precedence'] }, opts)) {
        if (m.uid > ultimaUid) msgs.push(m)
        if (msgs.length >= MAX_MSGS) break
      }
      msgs.sort((a, b) => a.uid - b.uid)

      for (const m of msgs) {
        vistos++
        ultimaUid = Math.max(ultimaUid, m.uid)
        const env = m.envelope || {}
        const de = ((env.from && env.from[0] && env.from[0].address) || '').toLowerCase()
        const deNome = (env.from && env.from[0] && env.from[0].name) || ''
        const messageId = env.messageId || ('<sem-id-' + m.uid + '@cmpgestao>')
        // e-mail que nós mesmos mandamos (a cópia oculta volta para a caixa): ignora
        if (!de || de === String(user).toLowerCase()) { pulados++; continue }

        // cabeçalhos de conversa
        let refs = ''
        try { refs = (m.headers ? Buffer.from(m.headers).toString('utf8') : '') } catch (e) {}
        const raizes = (refs.match(/<cmp-thread-[a-f0-9]+@cmpadvogados\.com\.br>/gi) || [])

        // mala direta e automação não são resposta de ninguém: newsletter, aviso de
        // sistema, "não responda". Sem isso a caixa vira lixeira em uma semana.
        const ehMassa = /^list-unsubscribe:/im.test(refs) || /^precedence:\s*(bulk|list|junk)/im.test(refs)
          || (/^auto-submitted:\s*(?!no\b)/im.test(refs) && !raizes.length)
          || /^(no-?reply|nao-?responda|naoresponda|newsletter|marketing|noreply)@/i.test(de)
        if (ehMassa) { pulados++; continue }

        // corpo
        let corpo = ''
        try {
          const alvo = achaParteTexto(m.bodyStructure)
          if (alvo) {
            const dl = await client.download(m.uid, alvo.part, { uid: true, maxBytes: MAX_CORPO })
            if (dl && dl.content) { corpo = await lerStream(dl.content); if (alvo.html) corpo = htmlParaTexto(corpo) }
          }
        } catch (e) { corpo = '' }
        corpo = limpaResposta(corpo).slice(0, MAX_CORPO)

        // ——— a qual processo pertence ———
        let numero = null, casouPor = null
        if (raizes.length) {
          const t = await sb.from('email_threads').select('numero').in('raiz', raizes.map(r => r.toLowerCase())).not('numero', 'is', null).limit(1)
          if (t.data && t.data.length && t.data[0].numero) { numero = soDig(t.data[0].numero); casouPor = 'thread' }
        }
        if (!numero) {
          const texto = (env.subject || '') + '\n' + corpo
          const cands = (texto.match(/\d{7}-?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{4}/g) || []).map(soDig)
          const hit = cands.find(c => porNumero[c])
          if (hit) { numero = hit; casouPor = 'numero' }
        }
        if (!numero) {
          // remetente é contato de vara: só resolve se houver UM processo ativo nela
          const ehOrgao = (contatos.data || []).some(c => String(c.email || '').toLowerCase() === de)
          if (ehOrgao) {
            const t = await sb.from('email_threads').select('numero').eq('destinatario', de).not('numero', 'is', null).limit(3)
            const uniq = [...new Set((t.data || []).map(x => soDig(x.numero)).filter(Boolean))]
            if (uniq.length === 1) { numero = uniq[0]; casouPor = 'contato' }
          }
        }
        const proc = numero ? porNumero[numero] : null

        // ——— grava na caixa ———
        const linha = {
          escritorio_id: escritorioId, message_id: messageId, uid: m.uid,
          de, de_nome: deNome, para: user, assunto: env.subject || '(sem assunto)',
          corpo, recebido_em: (env.date ? new Date(env.date) : new Date()).toISOString(),
          thread_raiz: raizes[0] ? raizes[0].toLowerCase() : null,
          numero: numero || null, processo_id: (proc && proc.id) || null, casou_por: casouPor,
        }
        const ins = await sb.from('emails_recebidos').insert(linha).select('id').single()
        if (ins.error) { if (String(ins.error.code) === '23505') pulados++; continue }  // já importado

        // ——— e no histórico do processo ———
        if (proc) {
          const dt = linha.recebido_em.slice(0, 10)
          const quem = deNome ? (deNome + ' <' + de + '>') : de
          const texto = '[E-mail recebido — resposta] De: ' + quem + '\n'
            + 'Assunto: ' + (env.subject || '(sem assunto)') + '\n\n' + (corpo || '(mensagem sem texto legível — abra na caixa de e-mails)')
          const a = await sb.from('andamentos').insert({ processo_id: proc.id, data: dt, texto, fonte: 'email' }).select('id').single()
          if (!a.error && a.data) await sb.from('emails_recebidos').update({ andamento_id: a.data.id }).eq('id', ins.data.id)
        }
        importados.push({ de, assunto: env.subject, numero, casou_por: casouPor })
      }
    }
    await sb.from('email_imap_estado').upsert({
      id: 1, uidvalidity: uidv, ultima_uid: ultimaUid, ultima_checagem: new Date().toISOString(),
      ultimo_resultado: importados.length + ' importado(s) de ' + vistos + ' visto(s)',
    }, { onConflict: 'id' })
  } catch (e) {
    try { await sb.from('email_imap_estado').update({ ultima_checagem: new Date().toISOString(), ultimo_resultado: 'erro: ' + String((e && e.message) || e).slice(0, 300) }).eq('id', 1) } catch (_) {}
    return Response.json({ erro: 'IMAP ' + host + ':' + port + ' — ' + ((e && e.message) || String(e)) }, { status: 502 })
  } finally {
    try { if (lock) lock.release() } catch (e) {}
    try { await client.logout() } catch (e) {}
  }

  return Response.json({
    ok: true, vistos, pulados, importados: importados.length,
    no_historico: importados.filter(x => x.numero).length,
    sem_processo: importados.filter(x => !x.numero).length,
    itens: importados.slice(0, 20),
  })
}
