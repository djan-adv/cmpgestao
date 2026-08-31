// jus.br / PDPJ — robô diário que PUXA sozinho os documentos novos.
// Para cada processo ATIVO que teve movimentação nova, baixa os 3 documentos
// mais recentes que ainda não estão no sistema. Usa o token com renovação
// automática (../lib.js) — não precisa de ninguém logado na hora.
//
//   GET /api/jusbr/puxar-docs                 -> rotina diária (cron)
//   GET /api/jusbr/puxar-docs?numero=NNN&debug=1  -> teste de um processo
//   Parâmetros: ?dias=2 (janela de movimentação) ?porproc=3 ?max=120 (tetos)
// Aberta (sem login) para rodar no crontab; não expõe o token.

import { jusbrAdmin, getFreshToken, tipoRealDoArquivo, ESCRITORIO_CMP } from '../lib.js'
import { camposConteudo } from '../guardar.js'
import { ehOficial, copiarParaAppCliente } from '../../../../lib/appCliente.js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0
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
// peça oficial que o CLIENTE vê no app (mesmo filtro do portal): sentença, acórdão,
// decisão, despacho, acordo, homologação, ata/termo de audiência, alvará. Essas
// (a) entram SEMPRE no lote, mesmo fora do top-N mais recente, e (b) ficam
// permanentes — a sentença não pode sumir do app na faxina dos 30 dias.
const RE_PECA_OFICIAL = /(senten|despach|decis|ac[óo]rd|acordo|homolog|(ata|termo)\s+d[aeo]s?\s+audi|alvar)/i

function normDoc(d) {
  const arq = (d && d.arquivo) || {}
  const hrefBin = d.hrefBinario || (arq && arq.hrefBinario) || null
  // uuid CERTO = o do hrefBinario (idCodex do doc), não o idOrigem
  const uuid = (hrefBin && (hrefBin.match(/documentos\/([^/]+)\/(?:binario|texto)/) || [])[1]) || d.idOrigem || d.id || null
  return {
    uuid: uuid ? String(uuid) : null,
    nome: d.nome || d.descricao || arq.nome || 'documento',
    tipo: (arq && arq.tipo) || d.tipoConteudo || 'application/pdf',
    data: d.dataHoraJuntada || d.data || d.dataHora || null,
    href: hrefBin,
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

function absPDPJ(h) {
  h = String(h || '').trim()
  if (!h) return null
  if (/^https?:\/\//i.test(h)) return h
  if (h.startsWith('/api/')) return PDPJ + h
  if (h.startsWith('/')) return PDPJ + '/api/v2' + h
  return PDPJ + '/api/v2/' + h
}
async function baixarDoc(token, numero, doc) {
  const url = absPDPJ(doc.href) || `${PDPJ}/api/v2/processos/${numero}/documentos/${doc.uuid}/binario`
  let resp
  try { resp = await fetch(url, { headers: { ...PDPJ_HEADERS, Accept: 'application/pdf,application/octet-stream,text/html;q=0.8,*/*;q=0.5', Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(40000) }) }
  catch (e) { return { erro: 'rede' } }
  if (resp.status === 401) return { erro: 'expirado' }
  if (!resp.ok) return { erro: 'HTTP ' + resp.status }
  const buf = Buffer.from(await resp.arrayBuffer())
  if (!buf.length) return { erro: 'vazio' }
  if (buf.length > MAX_BYTES) return { erro: 'grande' }
  const ct = String(resp.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  const head = buf.slice(0, 64).toString('utf8').trim().toLowerCase()
  // rejeita envelope JSON de erro e a casca do app Angular
  if (/json/.test(ct) || head.startsWith('{') || head.startsWith('[')) return { erro: 'json' }
  if (/<app-root|ng-version=/.test(buf.slice(0, 6000).toString('utf8').toLowerCase())) return { erro: 'visor' }
  // o rótulo do PDPJ não decide nada: quem manda é o conteúdo (ver ../lib.js)
  const tipo = tipoRealDoArquivo(buf, ct, doc.nome)
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
  /* VARREDURA AUTOMÁTICA ≠ PEDIDO DE ALGUÉM.
     A rotina diária baixava os 3 documentos mais recentes de todo processo que
     se mexeu, fossem eles quais fossem — e assim caíam na pasta do processo
     coisas que ninguém pediu: "Imagem obras mal acabadas.pdf", "ENTREGA
     2021.pdf", "DECLARAÇÃO DE QUITAÇÃO" (reclamado em 31/08/2026). Agora, na
     varredura sem dono, só entra PEÇA OFICIAL — sentença, acórdão, decisão,
     despacho, acordo, homologação, ata/termo de audiência, alvará — que é o que
     alimenta o app do cliente e a contagem de prazo. Anexo de parte só vem
     quando alguém clica em "⬇ puxar".
     Quando a chamada traz ?numero= (alguém pediu aquele processo — a ficha, a
     Inove) ou ?tudo=1, o comportamento antigo continua valendo. */
  const soPecas = !soNumero && searchParams.get('tudo') == null
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

  const rel = { ok: true, dia: new Date().toISOString().slice(0, 10), modo: soPecas ? 'só peças oficiais' : 'todos os documentos novos', processos: alvos.length, baixados: 0, pulados: 0, detalhe: [] }
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
    const naoTem = ordenados.filter(d => d.uuid && !tem.has(d.uuid))
    let novos
    if (soPecas) {
      novos = naoTem.filter(d => RE_PECA_OFICIAL.test(d.nome || '')).slice(0, porProc + 5)
    } else {
      novos = naoTem.slice(0, porProc)
      // peça oficial nova fora do top-N entra mesmo assim (até +5 por processo)
      for (const d of naoTem.slice(porProc)) {
        if (novos.length >= porProc + 5) break
        if (RE_PECA_OFICIAL.test(d.nome || '')) novos.push(d)
      }
    }
    let baix = 0
    for (const d of novos) {
      if (total >= maxTotal) break
      const r = await baixarDoc(token, numero, d)
      if (r.erro) { rel.pulados++; if (r.erro === 'expirado') { rel.detalhe.push({ numero, erro: 'expirado' }); total = maxTotal; break } continue }
      const linha = {
        escritorio_id: ESCRITORIO_CMP, processo_numero: numero, doc_uuid: d.uuid,
        doc_nome: d.nome, doc_tipo: r.tipo, tamanho: r.buf.length,
        baixado_por: 'robo',
        // conteúdo vai para o disco do VPS; o banco fica só com o caminho
        ...camposConteudo(numero, d.nome, d.uuid, r.buf),
      }
      if (ehDocLeve(d.nome) || RE_PECA_OFICIAL.test(d.nome || '')) linha.expira_em = '2999-12-31T00:00:00.000Z' // permanente (coluna NOT NULL)
      const ins = await sb.from('jusbr_arquivos').insert(linha).select('id').single()
      if (!ins.error) {
        baix++; total++; rel.baixados++
        // espelha na pasta "App do Cliente" (é o que o cliente vê no app)
        if (ehOficial(d.nome, r.tipo)) { try { copiarParaAppCliente(numero, d.nome, r.buf) } catch (e) {} }
      }
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
      /* os primeiros documentos = ordem crescente de data. Na varredura sem dono
         ficamos na inicial/procuração e nas peças oficiais: "docs pessoais" é
         onde entram foto, comprovante e declaração de terceiro — material que
         ninguém pediu e que só enche a pasta. */
      const primeiros = lst.docs.slice()
        .sort((a, b) => String(a.data || '').localeCompare(String(b.data || '')))
        .filter(d => !soPecas || ehDocLeve(d.nome) || RE_PECA_OFICIAL.test(d.nome || ''))
        .slice(0, porProc)
      let baix = 0
      for (const d of primeiros) {
        if (total >= maxTotal) break
        if (!d.uuid) continue
        const r = await baixarDoc(token, numero, d)
        if (r.erro) { rel.pulados++; if (r.erro === 'expirado') { total = maxTotal; break } continue }
        const linha = { escritorio_id: ESCRITORIO_CMP, processo_numero: numero, doc_uuid: d.uuid, doc_nome: d.nome, doc_tipo: r.tipo, tamanho: r.buf.length, baixado_por: 'robo', ...camposConteudo(numero, d.nome, d.uuid, r.buf) }
        if (ehDocLeve(d.nome) || RE_PECA_OFICIAL.test(d.nome || '')) linha.expira_em = '2999-12-31T00:00:00.000Z' // permanente (coluna NOT NULL)
        const ins = await sb.from('jusbr_arquivos').insert(linha).select('id').single()
        if (!ins.error) {
          baix++; total++; rel.baixados++
          if (ehOficial(d.nome, r.tipo)) { try { copiarParaAppCliente(numero, d.nome, r.buf) } catch (e) {} }
        }
      }
      feitos++
      if (debug || baix) rel.detalhe.push({ numero, vazio: true, docs: lst.docs.length, baixados: baix })
    }
    rel.vazios_processados = feitos
  }

  return Response.json(rel)
}
