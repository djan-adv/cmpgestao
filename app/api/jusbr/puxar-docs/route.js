// jus.br / PDPJ — robô diário que PUXA sozinho os documentos novos.
// Para cada processo ATIVO que teve movimentação nova, baixa os 3 documentos
// mais recentes que ainda não estão no sistema. Usa o token com renovação
// automática (../lib.js) — não precisa de ninguém logado na hora.
//
//   GET /api/jusbr/puxar-docs                 -> rotina diária (cron)
//   GET /api/jusbr/puxar-docs?numero=NNN&debug=1  -> teste de um processo
//   Parâmetros: ?dias=2 (janela de movimentação) ?porproc=3 ?max=120 (tetos)
// Aberta (sem login) para rodar no crontab; não expõe o token.

import { jusbrAdmin, getFreshToken, ESCRITORIO_CMP } from '../lib.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const PDPJ = 'https://portaldeservicos.pdpj.jus.br'
const PDPJ_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'Origin': 'https://portaldeservicos.pdpj.jus.br',
  'Referer': 'https://portaldeservicos.pdpj.jus.br/consulta/autosdigitais',
}
const MAX_BYTES = 25 * 1024 * 1024
const soDig = (s) => String(s || '').replace(/\D/g, '')
// procuração e petição inicial são leves e sempre úteis: guardamos PERMANENTE
// (expira_em = null → a limpeza de 30 dias não apaga).
function ehDocLeve(nome) { return /procura[çc][aã]o|peti[çc][aã]o\s+inicial|\binicial\b/i.test(String(nome || '')) }

function normDoc(d) {
  const arq = (d && d.arquivo) || {}
  const uuid = d.idorigem || d.uuid || d.id || arq.idorigem || arq.uuid || null
  let href = d.hrefBinario || d.href || (arq && arq.href) || null
  return {
    uuid: uuid ? String(uuid) : null,
    nome: d.nome || d.descricao || arq.nome || 'documento',
    tipo: (arq.tipo) || d.tipoConteudo || 'application/pdf',
    data: d.dataHoraJuntada || d.data || d.dataHora || null,
    href: href,
  }
}

async function listarDocs(token, numero) {
  let resp, data
  try {
    resp = await fetch(`${PDPJ}/api/v2/processos/${numero}`, {
      headers: { ...PDPJ_HEADERS, Authorization: 'Bearer ' + token, Accept: 'application/json' },
      signal: AbortSignal.timeout(25000),
    })
    data = await resp.json().catch(() => null)
  } catch (e) { return { erro: 'rede: ' + String((e && e.message) || e) } }
  if (resp.status === 401) return { erro: 'expirado' }
  if (!resp.ok) return { erro: 'HTTP ' + resp.status }
  const proc = Array.isArray(data && data.content) ? data.content[0] : (Array.isArray(data) ? data[0] : data)
  const cand = (proc && (proc.documentos || (proc.tramitacaoAtual && proc.tramitacaoAtual.documentos))) || (data && data.documentos) || []
  const docs = (Array.isArray(cand) ? cand : []).map(normDoc).filter(d => d.uuid || d.href)
  return { docs }
}

async function baixarDoc(token, numero, doc) {
  let url = String(doc.href || '').trim()
  if (/^https?:\/\//i.test(url)) { /* absoluta */ }
  else if (url.startsWith('/')) url = PDPJ + url
  else url = `${PDPJ}/api/v2/processos/${numero}/documentos/${doc.uuid}/binario`
  let resp
  try { resp = await fetch(url, { headers: { ...PDPJ_HEADERS, Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(40000) }) }
  catch (e) { return { erro: 'rede' } }
  if (resp.status === 401) return { erro: 'expirado' }
  if (!resp.ok) return { erro: 'HTTP ' + resp.status }
  const buf = Buffer.from(await resp.arrayBuffer())
  if (!buf.length) return { erro: 'vazio' }
  if (buf.length > MAX_BYTES) return { erro: 'grande' }
  const head = buf.slice(0, 256).toString('utf8').trim().toLowerCase()
  const parecePdf = head.startsWith('%pdf')
  const pareceHtml = /\.html?$/i.test(doc.nome) || head.startsWith('<!doctype html') || head.startsWith('<html') || (head.startsWith('<') && head.indexOf('<body') > -1)
  let tipo = String(resp.headers.get('content-type') || doc.tipo || '').split(';')[0].trim().toLowerCase()
  if (!tipo || tipo === 'application/octet-stream') tipo = parecePdf ? 'application/pdf' : (pareceHtml ? 'text/html' : 'application/pdf')
  if (tipo === 'application/pdf' && pareceHtml && !parecePdf) tipo = 'text/html'
  if (tipo.indexOf('html') > -1 && parecePdf) tipo = 'application/pdf'
  // descarta a casca do visor SPA (HTML pequeno montado por JS)
  if (tipo.indexOf('html') > -1) {
    const amostra = buf.slice(0, 8000).toString('utf8').toLowerCase()
    if (buf.length < 20000 && /<app-root|ng-version=|<div id="root">\s*<\/div>|<div id="app">\s*<\/div>/.test(amostra)) return { erro: 'visor' }
  }
  return { buf, tipo }
}

export async function GET(request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ erro: 'falta service key' }, { status: 500 })
  if (!process.env.JUSBR_ENC_KEY) return Response.json({ erro: 'falta JUSBR_ENC_KEY' }, { status: 500 })
  const { searchParams } = new URL(request.url)
  const debug = searchParams.get('debug') != null
  const soNumero = soDig(searchParams.get('numero') || '')
  const dias = Math.min(parseInt(searchParams.get('dias') || '2', 10) || 2, 30)
  const porProc = Math.min(parseInt(searchParams.get('porproc') || '3', 10) || 3, 10)
  const maxTotal = Math.min(parseInt(searchParams.get('max') || '120', 10) || 120, 400)
  const sb = jusbrAdmin()

  const tk = await getFreshToken(sb)
  if (tk.erro) return Response.json({ ok: false, erro: 'jus.br: ' + tk.erro + ' — sincronize a sessão do jus.br', motivo: tk.erro })
  const token = tk.token

  // seleciona os processos-alvo
  let alvos = []
  if (soNumero) {
    const { data } = await sb.from('processos').select('id,numero,numero_digitos').eq('escritorio_id', ESCRITORIO_CMP).eq('numero_digitos', soNumero).limit(1)
    alvos = data || []
  } else {
    const corte = new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10)
    const { data } = await sb.from('processos')
      .select('id,numero,numero_digitos,status,suspenso,ultima_movimentacao')
      .eq('escritorio_id', ESCRITORIO_CMP)
      .or('suspenso.is.null,suspenso.eq.false')
      .gte('ultima_movimentacao', corte)
      .order('ultima_movimentacao', { ascending: false })
      .limit(200)
    alvos = (data || []).filter(p => soDig(p.numero_digitos || p.numero).length === 20 && !/encerrad|arquivad|baixad/i.test(p.status || ''))
  }

  const rel = { ok: true, dia: new Date().toISOString().slice(0, 10), processos: alvos.length, baixados: 0, pulados: 0, detalhe: [] }
  let total = 0

  for (const p of alvos) {
    if (total >= maxTotal) break
    const numero = soDig(p.numero_digitos || p.numero)
    const lst = await listarDocs(token, numero)
    if (lst.erro) { rel.detalhe.push({ numero, erro: lst.erro }); if (lst.erro === 'expirado') break; continue }
    // ordena por data desc e pega os mais recentes ainda não guardados
    const ordenados = lst.docs.slice().sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')))
    const { data: jaTem } = await sb.from('jusbr_arquivos').select('doc_uuid').eq('escritorio_id', ESCRITORIO_CMP).eq('processo_numero', numero)
    const tem = new Set((jaTem || []).map(r => r.doc_uuid))
    const novos = ordenados.filter(d => d.uuid && !tem.has(d.uuid)).slice(0, porProc)
    let baix = 0
    for (const d of novos) {
      if (total >= maxTotal) break
      const r = await baixarDoc(token, numero, d)
      if (r.erro) { rel.pulados++; if (r.erro === 'expirado') { rel.detalhe.push({ numero, erro: 'expirado' }); total = maxTotal; break } continue }
      const linha = {
        escritorio_id: ESCRITORIO_CMP, processo_numero: numero, doc_uuid: d.uuid,
        doc_nome: d.nome, doc_tipo: r.tipo, tamanho: r.buf.length,
        conteudo_b64: r.buf.toString('base64'), baixado_por: 'robo',
      }
      if (ehDocLeve(d.nome)) linha.expira_em = null // procuração/inicial: permanente
      const ins = await sb.from('jusbr_arquivos').insert(linha).select('id').single()
      if (!ins.error) { baix++; total++; rel.baixados++ }
    }
    if (debug || baix) rel.detalhe.push({ numero, docs: lst.docs.length, novos: novos.length, baixados: baix })
  }

  // ——— passo B: processos ATIVOS ainda SEM nenhum documento no sistema ———
  // preenche aos poucos (só a inicial/procuração + 1), sem estourar a rodada.
  if (!soNumero && total < maxTotal) {
    const { data: comArq } = await sb.from('jusbr_arquivos').select('processo_numero').eq('escritorio_id', ESCRITORIO_CMP)
    const jaTemAlgum = new Set((comArq || []).map(r => r.processo_numero))
    const { data: ativos } = await sb.from('processos')
      .select('numero,numero_digitos,status,suspenso')
      .eq('escritorio_id', ESCRITORIO_CMP)
      .or('suspenso.is.null,suspenso.eq.false')
      .order('ultima_movimentacao', { ascending: false, nullsFirst: false })
      .limit(400)
    let vazios = (ativos || [])
      .filter(p => soDig(p.numero_digitos || p.numero).length === 20 && !/encerrad|arquivad|baixad/i.test(p.status || ''))
      .filter(p => !jaTemAlgum.has(soDig(p.numero_digitos || p.numero)))
    const LIMITE_VAZIOS = 15 // por rodada (por partes, dia após dia)
    let feitos = 0
    for (const p of vazios) {
      if (total >= maxTotal || feitos >= LIMITE_VAZIOS) break
      const numero = soDig(p.numero_digitos || p.numero)
      const lst = await listarDocs(token, numero)
      if (lst.erro) { if (lst.erro === 'expirado') break; continue }
      // os primeiros documentos (inicial, procuração, docs pessoais) = ordem crescente de data
      const primeiros = lst.docs.slice().sort((a, b) => String(a.data || '').localeCompare(String(b.data || ''))).slice(0, porProc)
      let baix = 0
      for (const d of primeiros) {
        if (total >= maxTotal) break
        if (!d.uuid) continue
        const r = await baixarDoc(token, numero, d)
        if (r.erro) { rel.pulados++; if (r.erro === 'expirado') { total = maxTotal; break } continue }
        const linha = { escritorio_id: ESCRITORIO_CMP, processo_numero: numero, doc_uuid: d.uuid, doc_nome: d.nome, doc_tipo: r.tipo, tamanho: r.buf.length, conteudo_b64: r.buf.toString('base64'), baixado_por: 'robo' }
        if (ehDocLeve(d.nome)) linha.expira_em = null
        const ins = await sb.from('jusbr_arquivos').insert(linha).select('id').single()
        if (!ins.error) { baix++; total++; rel.baixados++ }
      }
      feitos++
      if (debug || baix) rel.detalhe.push({ numero, vazio: true, docs: lst.docs.length, baixados: baix })
    }
    rel.vazios_processados = feitos
  }

  return Response.json(rel)
}
