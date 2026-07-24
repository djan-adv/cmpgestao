// jus.br / PDPJ — baixar UM documento (o escolhido) e guardar no sistema (30 dias).
//   POST /api/jusbr/documento   (Authorization: Bearer <jwt do Supabase>)
//   body: { numero, uuid, href?, nome?, tipo? }
// Se já estiver baixado, devolve o existente. Guarda o PDF em base64 (jusbr_arquivos).

import { createClient } from '@supabase/supabase-js'
import { getFreshToken } from '../lib.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 45

const ESCRITORIO_CMP = '908f77fc-19f5-4d86-9576-f5590af09e0a'
const PDPJ = 'https://portaldeservicos.pdpj.jus.br'
const MAX_BYTES = 25 * 1024 * 1024 // trava de segurança: 25 MB por arquivo
// headers de navegador — o WAF do PDPJ recusa (403 HTML) requisições sem eles. NÃO remover.
const PDPJ_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'Origin': 'https://portaldeservicos.pdpj.jus.br',
  'Referer': 'https://portaldeservicos.pdpj.jus.br/consulta/autosdigitais',
}

async function usuario(request) {
  const auth = request.headers.get('authorization') || ''
  const jwt = auth.replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const u = await sb.auth.getUser(jwt)
  return (u && u.data && u.data.user) || null
}
function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}

export async function POST(request) {
  const user = await usuario(request)
  if (!user) return Response.json({ erro: 'não autenticado' }, { status: 401 })
  let body
  try { body = await request.json() } catch (e) { return Response.json({ erro: 'json inválido' }, { status: 400 }) }
  const numero = String(body.numero || '').replace(/\D/g, '')
  const uuid = String(body.uuid || '').trim()
  const nome = String(body.nome || 'documento').slice(0, 200)
  if (numero.length < 16 || !uuid) return Response.json({ erro: 'informe número do processo e uuid do documento' }, { status: 400 })

  const sb = admin()
  sb.rpc('jusbr_limpar_expirados').then(() => {}, () => {}) // limpeza oportunista (30 dias)

  // já baixado?
  const { data: existente } = await sb.from('jusbr_arquivos').select('id,doc_nome,doc_tipo,tamanho,baixado_em').eq('escritorio_id', ESCRITORIO_CMP).eq('processo_numero', numero).eq('doc_uuid', uuid).maybeSingle()
  if (existente) return Response.json({ ok: true, id: existente.id, nome: existente.doc_nome, tipo: existente.doc_tipo, tamanho: existente.tamanho, ja_tinha: true })

  // token (com renovação automática via refresh_token — ver ../lib.js)
  const encKey = process.env.JUSBR_ENC_KEY
  if (!encKey) return Response.json({ erro: 'servidor sem JUSBR_ENC_KEY (chave de cifragem)' }, { status: 500 })
  const sess = await getFreshToken(sb)
  if (sess.erro === 'sem_token' || sess.erro === 'sem_chave') return Response.json({ erro: 'jus.br: sem token — sincronize a sessão', motivo: 'sem_token' }, { status: 409 })
  if (sess.erro) return Response.json({ erro: 'jus.br: token expirado — sincronize novamente', motivo: 'expirado' }, { status: 409 })

  // resolve href relativo do PDPJ: hrefBinario/hrefTexto vêm como /processos/...
  // e precisam do prefixo /api/v2 (senão o servidor devolve a casca do app).
  function abs(h) {
    h = String(h || '').trim()
    if (!h) return null
    if (/^https?:\/\//i.test(h)) return h
    if (h.startsWith('/api/')) return PDPJ + h
    if (h.startsWith('/')) return PDPJ + '/api/v2' + h
    return PDPJ + '/api/v2/' + h
  }
  // candidatos, em ordem: hrefBinario (o real) → hrefTexto (p/ HTML) → construídos
  const cands = []
  const hb = abs(body.href)
  const ht = abs(body.hrefTexto)
  if (hb) cands.push(hb)
  if (ht) cands.push(ht)
  cands.push(`${PDPJ}/api/v2/processos/${numero}/documentos/${uuid}/binario`)
  cands.push(`${PDPJ}/api/v2/processos/${numero}/documentos/${uuid}/texto`)
  const urls = cands.filter((u, i) => u && cands.indexOf(u) === i)
  const debug = new URL(request.url).searchParams.get('debug') != null || body.debug === true

  // "casca do visor": a index.html do app Angular (tem <app-root>/ng-version)
  function ehShell(b) {
    const h = b.slice(0, 6000).toString('utf8').toLowerCase()
    return /<app-root|ng-version=/.test(h)
  }
  // aceita SÓ arquivo de verdade; rejeita envelope JSON de erro e a casca do app
  function ehArquivoReal(b, ct, nm) {
    if (!b || !b.length) return false
    const h = b.slice(0, 64).toString('utf8').toLowerCase().trim()
    if (h.indexOf('%pdf') === 0) return true
    if (/pdf|octet-stream|^image\/|msword|officedocument|zip|rtf/.test(ct)) return true
    if (/json/.test(ct) || h.startsWith('{') || h.startsWith('[')) return false // erro do PDPJ
    if (ehShell(b)) return false
    if (/html|text\//.test(ct) || /\.html?$/i.test(nm)) return true // decisão/expediente real (mesmo curto)
    return b.length >= 400
  }

  let escolhido = null
  const tentativas = []
  for (const u of urls) {
    let r
    try {
      r = await fetch(u, { headers: { ...PDPJ_HEADERS, Accept: 'application/pdf,application/octet-stream,text/html;q=0.8,*/*;q=0.5', Authorization: 'Bearer ' + sess.token }, signal: AbortSignal.timeout(40000) })
    } catch (e) { tentativas.push({ url: u.replace(PDPJ, ''), erro: String((e && e.message) || e) }); continue }
    if (r.status === 401) return Response.json({ erro: 'jus.br: token inválido/expirado — sincronize novamente', motivo: 'expirado' }, { status: 409 })
    const b = Buffer.from(await r.arrayBuffer())
    const ct = String(r.headers.get('content-type') || '').split(';')[0].trim()
    const real = r.ok && ehArquivoReal(b, ct, nome)
    tentativas.push({ url: u.replace(PDPJ, ''), status: r.status, content_type: ct, bytes: b.length, ok: real, head: b.slice(0, 90).toString('utf8').replace(/\s+/g, ' ').trim() })
    if (real) { escolhido = { resp: r, buf: b }; break }
  }

  if (debug) return Response.json({ debug: true, numero, uuid, nome, tentativas })

  if (!escolhido) {
    const diag = tentativas.map(t => (t.url ? t.url.split('/').slice(-1)[0] : '') + ' → ' + (t.status || 'x') + '·' + (t.content_type || t.erro || '?') + '·' + (t.bytes || 0) + 'b' + (t.head ? (' · ' + t.head.slice(0, 60)) : '')).join('   ||   ')
    return Response.json({ erro: 'O jus.br não devolveu o arquivo (só a casca do visor ou um erro). Para .html (decisões/expedientes), leia pelo botão "Abrir no jus.br". [diag: ' + diag + ']', motivo: 'visor', diag: tentativas }, { status: 502 })
  }

  const resp = escolhido.resp
  const buf = escolhido.buf
  if (buf.length > MAX_BYTES) return Response.json({ erro: 'arquivo grande demais (>25MB) para guardar no sistema' }, { status: 413 })

  // detecta o tipo REAL (PDPJ às vezes não rotula ou rotula errado)
  let tipoFinal = String(resp.headers.get('content-type') || body.tipo || '').split(';')[0].trim().toLowerCase()
  const head = buf.slice(0, 256).toString('utf8').trim().toLowerCase()
  const parecePdf = head.startsWith('%pdf')
  const pareceHtml = /\.html?$/i.test(nome) || head.startsWith('<!doctype html') || head.startsWith('<html') || (head.startsWith('<') && head.indexOf('<body') > -1)
  if (!tipoFinal || tipoFinal === 'application/octet-stream') tipoFinal = parecePdf ? 'application/pdf' : (pareceHtml ? 'text/html' : 'application/pdf')
  if (tipoFinal === 'application/pdf' && pareceHtml && !parecePdf) tipoFinal = 'text/html'
  if (tipoFinal.indexOf('html') > -1 && parecePdf) tipoFinal = 'application/pdf'

  // procuração e petição inicial são leves e sempre úteis: guardamos PERMANENTE
  const ehLeve = /procura[çc][aã]o|peti[çc][aã]o\s+inicial|\binicial\b/i.test(String(nome || ''))
  const linhaArq = {
    escritorio_id: ESCRITORIO_CMP, processo_numero: numero, doc_uuid: uuid,
    doc_nome: nome, doc_tipo: tipoFinal, tamanho: buf.length,
    conteudo_b64: buf.toString('base64'), baixado_por: String(user.email || ''),
  }
  if (ehLeve) linhaArq.expira_em = null
  const { data: ins, error } = await sb.from('jusbr_arquivos').insert(linhaArq).select('id,doc_nome,doc_tipo,tamanho').single()
  if (error) return Response.json({ erro: 'falha ao guardar: ' + error.message }, { status: 500 })

  return Response.json({ ok: true, id: ins.id, nome: ins.doc_nome, tipo: ins.doc_tipo, tamanho: ins.tamanho })
}
