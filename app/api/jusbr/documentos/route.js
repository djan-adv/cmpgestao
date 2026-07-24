// jus.br / PDPJ — listar os documentos de um processo (ao vivo, com o token salvo).
//   POST /api/jusbr/documentos   (Authorization: Bearer <jwt do Supabase>)
//   body: { numero: "0802587-41.2021.8.15.2003" }
// Retorna a lista de documentos (id/uuid, nome, tipo, data, href de download) e
// marca quais já estão baixados no sistema.

import { createClient } from '@supabase/supabase-js'
import { getFreshToken } from '../lib.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const ESCRITORIO_CMP = '908f77fc-19f5-4d86-9576-f5590af09e0a'
const PDPJ = 'https://portaldeservicos.pdpj.jus.br'
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
// usa a sessão com renovação automática (refresh_token) — ver ../lib.js
async function tokenValido(sb) { return await getFreshToken(sb) }
// normaliza um documento do JSON do PDPJ para o formato do app
function normDoc(d) {
  const arq = d.arquivo || {}
  const hrefBin = d.hrefBinario || (arq && arq.hrefBinario) || null
  const hrefTxt = d.hrefTexto || (arq && arq.hrefTexto) || null
  // o uuid CERTO para o binário é o do hrefBinario (idCodex do documento), NÃO o idOrigem
  const uuid = (hrefBin && (hrefBin.match(/documentos\/([^/]+)\/(?:binario|texto)/) || [])[1]) || d.idOrigem || d.id || d.idCodex || null
  return {
    uuid: uuid ? String(uuid) : null,
    nome: d.nome || d.descricao || arq.nome || 'documento',
    tipo: (arq && arq.tipo) || d.tipoConteudo || 'application/pdf',
    data: d.dataHoraJuntada || d.data || d.dataHora || null,
    seq: d.sequencia || d.numeroDocumento || null,
    href: hrefBin,
    hrefTexto: hrefTxt,
  }
}

export async function POST(request) {
  const user = await usuario(request)
  if (!user) return Response.json({ erro: 'não autenticado' }, { status: 401 })
  let body
  try { body = await request.json() } catch (e) { return Response.json({ erro: 'json inválido' }, { status: 400 }) }
  const numero = String(body.numero || '').replace(/\D/g, '')
  if (numero.length < 16) return Response.json({ erro: 'número de processo inválido' }, { status: 400 })

  const sb = admin()
  const tk = await tokenValido(sb)
  if (tk.erro === 'sem_chave') return Response.json({ erro: 'servidor sem JUSBR_ENC_KEY (chave de cifragem)' }, { status: 500 })
  if (tk.erro) return Response.json({ erro: 'jus.br: ' + (tk.erro === 'expirado' ? 'token expirado — sincronize novamente' : 'sem token — sincronize a sessão do jus.br'), motivo: tk.erro }, { status: 409 })

  let resp, data
  try {
    resp = await fetch(`${PDPJ}/api/v2/processos/${numero}`, {
      headers: { ...PDPJ_HEADERS, Authorization: 'Bearer ' + tk.token, Accept: 'application/json' },
      signal: AbortSignal.timeout(25000),
    })
    data = await resp.json().catch(() => null)
  } catch (e) {
    return Response.json({ erro: 'falha ao consultar o PDPJ: ' + (e && e.message || e) }, { status: 502 })
  }
  if (resp.status === 401) return Response.json({ erro: 'jus.br: token inválido/expirado — sincronize novamente', motivo: 'expirado' }, { status: 409 })
  if (!resp.ok) return Response.json({ erro: 'PDPJ recusou (HTTP ' + resp.status + ')' }, { status: 502 })

  // o processo pode vir como objeto único ou dentro de um array/tramitacoes
  const proc = Array.isArray(data && data.content) ? data.content[0] : (Array.isArray(data) ? data[0] : data)
  let docs = []
  const cand = (proc && (proc.documentos || (proc.tramitacaoAtual && proc.tramitacaoAtual.documentos))) || (data && data.documentos) || []
  docs = (Array.isArray(cand) ? cand : []).map(normDoc).filter(d => d.uuid || d.href)

  // diagnóstico: mostra os campos CRUS dos primeiros documentos (para achar o
  // campo certo de id/hrefBinario do PDPJ)
  if (body.debug) {
    const cru = (Array.isArray(cand) ? cand : []).slice(0, 3)
    return Response.json({ ok: true, debug: true, total: docs.length, amostra_crua: cru, normalizados: docs.slice(0, 3) })
  }

  // marca os que já estão baixados no sistema
  const { data: jaTem } = await sb.from('jusbr_arquivos').select('doc_uuid,id').eq('escritorio_id', ESCRITORIO_CMP).eq('processo_numero', numero)
  const baixados = {}
  ;(jaTem || []).forEach(r => { baixados[r.doc_uuid] = r.id })
  docs.forEach(d => { d.baixado_id = (d.uuid && baixados[d.uuid]) || null })

  return Response.json({ ok: true, numero, total: docs.length, documentos: docs })
}
