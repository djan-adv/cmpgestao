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

  // resolve a URL de download
  let href = String(body.href || '').trim()
  let url
  if (/^https?:\/\//i.test(href)) url = href
  else if (href.startsWith('/')) url = PDPJ + href
  else url = `${PDPJ}/api/v2/processos/${numero}/documentos/${uuid}/binario`

  let resp
  try {
    resp = await fetch(url, { headers: { ...PDPJ_HEADERS, Authorization: 'Bearer ' + sess.token }, signal: AbortSignal.timeout(40000) })
  } catch (e) {
    return Response.json({ erro: 'falha ao baixar do PDPJ: ' + (e && e.message || e) }, { status: 502 })
  }
  if (resp.status === 401) return Response.json({ erro: 'jus.br: token inválido/expirado — sincronize novamente', motivo: 'expirado' }, { status: 409 })
  if (!resp.ok) return Response.json({ erro: 'PDPJ recusou o download (HTTP ' + resp.status + ')' }, { status: 502 })

  const buf = Buffer.from(await resp.arrayBuffer())
  if (!buf.length) return Response.json({ erro: 'documento vazio' }, { status: 502 })
  if (buf.length > MAX_BYTES) return Response.json({ erro: 'arquivo grande demais (>25MB) para guardar no sistema' }, { status: 413 })

  // detecta o tipo REAL (PDPJ às vezes não rotula ou rotula errado o HTML):
  // resposta > body.tipo > extensão do nome > sniff do conteúdo.
  let tipoFinal = String(resp.headers.get('content-type') || body.tipo || '').split(';')[0].trim().toLowerCase()
  const head = buf.slice(0, 256).toString('utf8').trim().toLowerCase()
  const parecePdf = head.startsWith('%pdf')
  const pareceHtml = /\.html?$/i.test(nome) || head.startsWith('<!doctype html') || head.startsWith('<html') || (head.startsWith('<') && head.indexOf('<body') > -1)
  if (!tipoFinal || tipoFinal === 'application/octet-stream') tipoFinal = parecePdf ? 'application/pdf' : (pareceHtml ? 'text/html' : 'application/pdf')
  if (tipoFinal === 'application/pdf' && pareceHtml && !parecePdf) tipoFinal = 'text/html' // PDPJ mentiu: era HTML
  if (tipoFinal.indexOf('html') > -1 && parecePdf) tipoFinal = 'application/pdf'          // ...ou o contrário

  // Só rejeita se for a CASCA do visor SPA (Angular/React) — HTML minúsculo cujo conteúdo
  // é montado por JavaScript (fica preso em "Carregando" no nosso quadro). Os expedientes
  // e decisões (Expediente.html/Decisão.html) são HTML de VERDADE, com o texto — esses
  // guardamos e exibimos (a limpeza do HTML é feita ao servir o arquivo).
  if (tipoFinal.indexOf('html') > -1) {
    const amostra = buf.slice(0, 8000).toString('utf8').toLowerCase()
    const ehCascaSpa = buf.length < 20000 && /<app-root|ng-version=|window\.__(nuxt|next)|<div id="root">\s*<\/div>|<div id="app">\s*<\/div>/.test(amostra)
    if (ehCascaSpa) return Response.json({ erro: 'O jus.br devolveu a página do visor (carregamento), não o arquivo em si. Abra o documento direto no jus.br (botão "Abrir no tribunal") ou tente de novo em instantes.', motivo: 'visor' }, { status: 502 })
  }

  const { data: ins, error } = await sb.from('jusbr_arquivos').insert({
    escritorio_id: ESCRITORIO_CMP, processo_numero: numero, doc_uuid: uuid,
    doc_nome: nome, doc_tipo: tipoFinal, tamanho: buf.length,
    conteudo_b64: buf.toString('base64'), baixado_por: String(user.email || ''),
  }).select('id,doc_nome,doc_tipo,tamanho').single()
  if (error) return Response.json({ erro: 'falha ao guardar: ' + error.message }, { status: 500 })

  return Response.json({ ok: true, id: ins.id, nome: ins.doc_nome, tipo: ins.doc_tipo, tamanho: ins.tamanho })
}
