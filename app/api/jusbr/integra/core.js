// Motor da íntegra dos autos — baixa todas as peças do processo no PDPJ e monta
// o pacote. Usado por dois caminhos:
//   • /api/jusbr/integra    → o advogado baixa na hora (zip / PDF único / solto)
//   • /api/robo/minutas     → o robô guarda a íntegra em PDF na pasta do processo
// Não gasta IA: é só download do jus.br.

import { getFreshToken } from '../lib.js'

export const PDPJ = 'https://portaldeservicos.pdpj.jus.br'
export const PDPJ_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'Origin': 'https://portaldeservicos.pdpj.jus.br',
  'Referer': 'https://portaldeservicos.pdpj.jus.br/consulta/autosdigitais',
}
export const MAX_TOTAL = 180 * 1024 * 1024 // teto do pacote (memória/tempo)

// Nome do PDF guardado na pasta do processo. O prefixo "000 - " é o que faz o
// arquivo ficar no topo da listagem, que é alfabética. Um slot por tipo: gravar
// de novo substitui o anterior, então a pasta não engorda.
export const INTEGRA_PREFIXO = '000 - ÍNTEGRA DOS AUTOS'
export const SELECAO_PREFIXO = '000 - PEÇAS SELECIONADAS'
export function nomeArquivoAutos(completa, hoje) {
  const d = (hoje || new Date().toISOString().slice(0, 10)).split('-').reverse().join('-')
  return (completa ? INTEGRA_PREFIXO : SELECAO_PREFIXO) + ' (' + d + ').pdf'
}

// Grava o PDF na pasta do processo, apagando a versão anterior do mesmo slot.
// Devolve o nome gravado, ou null se não deu (nunca lança: salvar é um extra,
// não pode derrubar o download que o usuário pediu).
export function salvarNaPasta(fs, path, ROOT, dig, bytes, completa) {
  try {
    const nome = nomeArquivoAutos(completa)
    const prefixo = completa ? INTEGRA_PREFIXO : SELECAO_PREFIXO
    const pasta = path.join(ROOT, dig)
    fs.mkdirSync(pasta, { recursive: true })
    try { fs.readdirSync(pasta).filter(n => n.startsWith(prefixo) && n !== nome).forEach(n => fs.unlinkSync(path.join(pasta, n))) } catch (e) {}
    fs.writeFileSync(path.join(pasta, nome), bytes)
    return nome
  } catch (e) { return null }
}

export function abs(h) {
  h = String(h || '').trim()
  if (!h) return null
  if (/^https?:\/\//i.test(h)) return h
  if (h.startsWith('/api/')) return PDPJ + h
  if (h.startsWith('/')) return PDPJ + '/api/v2' + h
  return PDPJ + '/api/v2/' + h
}
export function ehShell(b) { return /<app-root|ng-version=/.test(b.slice(0, 6000).toString('utf8').toLowerCase()) }
export function limpaNome(s) { return String(s || 'documento').replace(/[\\/:*?"<>|\r\n\t]+/g, '-').slice(0, 120) }

// Entidades nomeadas do HTML4 (Latin-1 + pontuação comum) — os documentos do
// TJ (expedientes/atos ordinatórios em HTML) vêm cheios delas ("JUDICI&Aacute;RIO",
// "&ordm;", "&ccedil;ão"...) e, sem decodificar, a peça inteira fica ilegível
// no PDF final ("PODER JUDICI&Aacute;RIO" em vez de "PODER JUDICIÁRIO").
const ENTIDADES_HTML = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  Aacute: 'Á', aacute: 'á', Agrave: 'À', agrave: 'à', Acirc: 'Â', acirc: 'â', Atilde: 'Ã', atilde: 'ã', Auml: 'Ä', auml: 'ä', Aring: 'Å', aring: 'å', AElig: 'Æ', aelig: 'æ',
  Eacute: 'É', eacute: 'é', Egrave: 'È', egrave: 'è', Ecirc: 'Ê', ecirc: 'ê', Euml: 'Ë', euml: 'ë',
  Iacute: 'Í', iacute: 'í', Igrave: 'Ì', igrave: 'ì', Icirc: 'Î', icirc: 'î', Iuml: 'Ï', iuml: 'ï',
  Oacute: 'Ó', oacute: 'ó', Ograve: 'Ò', ograve: 'ò', Ocirc: 'Ô', ocirc: 'ô', Otilde: 'Õ', otilde: 'õ', Ouml: 'Ö', ouml: 'ö', Oslash: 'Ø', oslash: 'ø',
  Uacute: 'Ú', uacute: 'ú', Ugrave: 'Ù', ugrave: 'ù', Ucirc: 'Û', ucirc: 'û', Uuml: 'Ü', uuml: 'ü',
  Yacute: 'Ý', yacute: 'ý', yuml: 'ÿ',
  Ntilde: 'Ñ', ntilde: 'ñ', Ccedil: 'Ç', ccedil: 'ç',
  szlig: 'ß', ETH: 'Ð', eth: 'ð', THORN: 'Þ', thorn: 'þ',
  ordf: 'ª', ordm: 'º', sect: '§', para: '¶', deg: '°', middot: '·', micro: 'µ',
  laquo: '«', raquo: '»', iexcl: '¡', iquest: '¿',
  cent: '¢', pound: '£', curren: '¤', yen: '¥', euro: '€',
  copy: '©', reg: '®', trade: '™',
  times: '×', divide: '÷', plusmn: '±', sup1: '¹', sup2: '²', sup3: '³', frac12: '½', frac14: '¼', frac34: '¾',
  ndash: '–', mdash: '—', minus: '−',
  lsquo: '‘', rsquo: '’', sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„',
  hellip: '…', bull: '•', dagger: '†', Dagger: '‡', permil: '‰', prime: '′', Prime: '″',
  shy: '', not: '¬', brvbar: '¦', uml: '¨', acute: '´', cedil: '¸', macr: '¯',
}
export function decodeEntidadesHtml(s) {
  return String(s || '')
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, nome) => Object.prototype.hasOwnProperty.call(ENTIDADES_HTML, nome) ? ENTIDADES_HTML[nome] : m)
}

// Baixa as peças. Devolve { files, pulados } ou { erro, status }.
/* Uma peça vale a pena como TEXTO quando o tribunal tem texto dela e esse texto
   é de verdade. Abaixo disso é digitalização (scan, foto, comprovante, laudo com
   tabela) — e aí a imagem É a prova, tem que ir como PDF. */
const MIN_TEXTO_UTIL = 400   // caracteres, depois de limpar as tags

export async function coletarPecas(sb, numero, { uuidsSel = [], preferirTexto = false } = {}) {
  const sess = await getFreshToken(sb)
  if (sess.erro) return { erro: 'jus.br: ' + sess.erro + ' — sincronize a sessão', motivo: sess.erro, status: 409 }
  const token = sess.token
  const uuidSet = uuidsSel.length ? new Set(uuidsSel) : null

  let data
  try {
    const r = await fetch(`${PDPJ}/api/v2/processos/${numero}`, { headers: { ...PDPJ_HEADERS, Authorization: 'Bearer ' + token, Accept: 'application/json' }, signal: AbortSignal.timeout(25000) })
    if (!r.ok) return { erro: 'PDPJ recusou a lista (HTTP ' + r.status + ')', status: 502 }
    data = await r.json().catch(() => null)
  } catch (e) { return { erro: 'falha na lista: ' + String((e && e.message) || e), status: 502 } }

  const proc = Array.isArray(data && data.content) ? data.content[0] : (Array.isArray(data) ? data[0] : data)
  const docsRaw = (proc && (proc.documentos || (proc.tramitacaoAtual && proc.tramitacaoAtual.documentos))) || (data && data.documentos) || []
  const docs = (Array.isArray(docsRaw) ? docsRaw : [])
  if (!docs.length) return { erro: 'nenhuma peça retornada pelo jus.br', status: 404 }

  const files = []; let total = 0; let pulados = 0
  const usados = {}
  for (const d of docs) {
    if (total >= MAX_TOTAL) { pulados++; continue }
    const arq = d.arquivo || {}
    const hb = d.hrefBinario || arq.hrefBinario
    if (uuidSet) { const du = ((String(hb || '').match(/documentos\/([^/]+)\//) || [])[1]) || ''; if (!uuidSet.has(du)) continue }
    const url = abs(hb)
    if (!url) { pulados++; continue }
    let rb
    try { rb = await fetch(url, { headers: { ...PDPJ_HEADERS, Accept: 'application/pdf,application/octet-stream,text/html;q=0.8,*/*;q=0.5', Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(40000) }) }
    catch (e) { pulados++; continue }
    if (!rb.ok) { pulados++; continue }
    const buf = Buffer.from(await rb.arrayBuffer())
    if (!buf.length) { pulados++; continue }
    /* Modo econômico: se o tribunal tem a versão em texto desta peça e ela é
       substanciosa, guarda o texto junto — quem for ler decide o que usar. A
       peça em PDF continua aqui do lado, intacta. */
    if (preferirTexto) {
      const ht = abs(d.hrefTexto || arq.hrefTexto)
      if (ht) {
        try {
          const rt = await fetch(ht, { headers: { ...PDPJ_HEADERS, Accept: 'text/html,text/plain;q=0.9,*/*;q=0.5', Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(30000) })
          if (rt.ok) {
            const bt = Buffer.from(await rt.arrayBuffer())
            if (bt.length && !ehShell(bt)) {
              const txt = decodeEntidadesHtml(bt.toString('utf8').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/[ \t\u00a0]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
              if (txt.replace(/\s/g, '').length >= MIN_TEXTO_UTIL) d.__texto = txt
            }
          }
        } catch (e) { /* sem texto: segue com o PDF, que é o que importa */ }
      }
    }
    const ct = String(rb.headers.get('content-type') || '').split(';')[0].toLowerCase()
    const head = buf.slice(0, 64).toString('utf8').toLowerCase().trim()
    if (/json/.test(ct) || head.startsWith('{') || ehShell(buf)) { pulados++; continue }
    const seq = String(d.sequencia != null ? d.sequencia : files.length + 1).padStart(3, '0')
    let base = limpaNome(d.nome || arq.nome || 'documento')
    if (!/\.[a-z0-9]{2,4}$/i.test(base)) base += head.startsWith('%pdf') ? '.pdf' : '.html'
    let name = seq + ' - ' + base
    if (usados[name]) { name = seq + '-' + (usados[name]++) + ' - ' + base } else usados[name] = 1
    const duuid = ((String(hb || '').match(/documentos\/([^/]+)\//) || [])[1]) || ''
    files.push({ name, data: buf, uuid: duuid, dt: String(d.dataHoraJuntada || d.data || ''), texto: d.__texto || null })
    total += buf.length
  }
  if (!files.length) return { erro: 'não foi possível baixar nenhuma peça', status: 502 }
  return { files, pulados, totalDocs: docs.length }
}

// Ordem final: a MESMA da tela. Com seleção, os uuids vêm na ordem escolhida
// (crescente = autos na sequência); sem seleção, usa `ordem` ('asc'/'desc').
export function ordenarPecas(files, { uuidsSel = [], ordem = '' } = {}) {
  if (uuidsSel.length) {
    const pos = {}; uuidsSel.forEach((u, i) => { pos[u] = i })
    files.sort((a, b) => (pos[a.uuid] == null ? 9999 : pos[a.uuid]) - (pos[b.uuid] == null ? 9999 : pos[b.uuid]))
  } else if (String(ordem).toLowerCase() === 'asc') {
    files.sort((a, b) => String(a.dt || '').localeCompare(String(b.dt || '')))
  } else if (String(ordem).toLowerCase() === 'desc') {
    files.sort((a, b) => String(b.dt || '').localeCompare(String(a.dt || '')))
  }
  // renumera os prefixos (001, 002…) seguindo a ordem final
  files.forEach((f, i) => { f.name = String(i + 1).padStart(3, '0') + ' - ' + f.name.replace(/^\d{3}(-\d+)? - /, '') })
  return files
}

// Quebra o HTML em blocos (parágrafo/linha/célula), preservando negrito e
// centralização — sem isso, texto de expediente/ato ordinatório virava um
// bloco só, tudo esquerda e sem destaque nenhum (ilegível perto do original).
// Não é um parser de árvore de verdade (é regex sobre os tokens de tag), mas
// cobre bem o padrão desses documentos do TJ: tags de bloco não aninhadas
// de forma complexa, negrito/centralização por linha inteira.
const TAGS_BLOCO = new Set(['p', 'div', 'td', 'th', 'tr', 'table', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'br'])
const TAGS_NEGRITO = new Set(['b', 'strong', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
export function blocosDeHtml(html) {
  const semScript = String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  const tokens = semScript.match(/<[^>]+>|[^<]+/g) || []
  let boldDepth = 0, centerDepth = 0, destaqueDepth = 0
  let buf = '', bufBold = false, bufCenter = false, bufDestaque = false
  const blocos = []
  function flush() {
    const t = decodeEntidadesHtml(buf).replace(/[ \t]+/g, ' ').trim()
    buf = ''; const b = bufBold, c = bufCenter, d = bufDestaque
    bufBold = false; bufCenter = false; bufDestaque = false
    if (t) blocos.push({ texto: t, negrito: b, centro: c, destaque: d })
  }
  for (const tk of tokens) {
    if (tk[0] === '<') {
      const fecha = /^<\//.test(tk)
      const nome = ((tk.match(/^<\/?\s*([a-zA-Z0-9]+)/) || [, ''])[1] || '').toLowerCase()
      const centralizado = /\balign\s*=\s*["']?center["']?/i.test(tk) || /text-align\s*:\s*center/i.test(tk)
      // "destaque" = fundo colorido de verdade (bgcolor/background) — NÃO borda.
      // É o que diferencia o título de seção ("SENTENÇA"/"ATO ORDINATÓRIO", caixa
      // cinza) do cabeçalho (negrito+centralizado, mas sem caixa nenhuma) e da
      // tabela de partes (borda tracejada, sem fundo).
      const destacado = /\bbgcolor\s*=/i.test(tk) || /background(-color)?\s*:/i.test(tk)
      if (!fecha) {
        if (TAGS_NEGRITO.has(nome)) boldDepth++
        if (centralizado) centerDepth++
        if (destacado) destaqueDepth++
        if (nome === 'br') flush()
      } else {
        if (TAGS_BLOCO.has(nome) && nome !== 'br') flush()
        if (TAGS_NEGRITO.has(nome)) boldDepth = Math.max(0, boldDepth - 1)
        if (TAGS_BLOCO.has(nome)) { centerDepth = 0; destaqueDepth = 0 }
      }
    } else {
      buf += tk
      if (boldDepth > 0) bufBold = true
      if (centerDepth > 0) bufCenter = true
      if (destaqueDepth > 0) bufDestaque = true
    }
  }
  flush()
  return blocos
}
// Quebra um texto em linhas que cabem em `larguraMax` pontos, medindo pela
// fonte de verdade (em vez de contar caracteres) — necessário pra centralizar direito.
function quebraLinhas(texto, font, tamanho, larguraMax) {
  const linhas = []
  String(texto || '').split('\n').forEach((par) => {
    const palavras = par.split(' ').filter((w) => w !== '')
    if (!palavras.length) { linhas.push(''); return }
    let atual = ''
    for (const w of palavras) {
      const tentativa = atual ? atual + ' ' + w : w
      if (atual && font.widthOfTextAtSize(tentativa, tamanho) > larguraMax) { linhas.push(atual); atual = w }
      else atual = tentativa
    }
    if (atual) linhas.push(atual)
  })
  return linhas
}

// Junta tudo num PDF só. Peça em HTML/texto vira páginas de texto (com
// negrito/centralização preservados), para não sumir do documento final.
export async function pdfUnico(files) {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const out = await PDFDocument.create()
  const fonte = await out.embedFont(StandardFonts.Helvetica)
  const negrito = await out.embedFont(StandardFonts.HelveticaBold)
  const lat1 = (s) => String(s == null ? '' : s)
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/[–—−]/g, '-').replace(/ /g, ' ')
    .replace(/[^\x00-\xFF]/g, '?')
  const MARG_ESQ = 45, MARG_DIR = 550, LARG_UTIL = MARG_DIR - MARG_ESQ
  let juntados = 0, falhos = 0
  for (const f of files) {
    const ehPdf = f.data.slice(0, 5).toString('utf8').toLowerCase().startsWith('%pdf')
    if (ehPdf) {
      try {
        const src = await PDFDocument.load(f.data, { ignoreEncryption: true })
        const pgs = await out.copyPages(src, src.getPageIndices())
        pgs.forEach((p) => out.addPage(p))
        juntados++
      } catch (e) { falhos++ }
    } else {
      try {
        const blocos = blocosDeHtml(f.data.toString('utf8'))
        let pg = out.addPage([595, 842]); let y = 800
        pg.drawText(lat1(f.name).slice(0, 90), { x: MARG_ESQ, y, size: 11, font: negrito }); y -= 22
        for (const b of blocos) {
          const fnt = b.negrito ? negrito : fonte
          const tamanho = b.negrito ? 10.5 : 9.5
          const linhas = quebraLinhas(lat1(b.texto), fnt, tamanho, LARG_UTIL)
          if (b.destaque && linhas.length === 1) {
            if (y < 55) { pg = out.addPage([595, 842]); y = 800 }
            const w = fnt.widthOfTextAtSize(linhas[0], tamanho)
            const boxW = Math.min(LARG_UTIL, w + 40)
            const boxX = MARG_ESQ + (LARG_UTIL - boxW) / 2
            pg.drawRectangle({ x: boxX, y: y - 5, width: boxW, height: 18, color: rgb(0.88, 0.88, 0.88), borderColor: rgb(0.55, 0.55, 0.55), borderWidth: 0.75 })
            pg.drawText(linhas[0], { x: MARG_ESQ + (LARG_UTIL - w) / 2, y, size: tamanho, font: fnt }); y -= 13 + 10
            continue
          }
          for (const ln of linhas) {
            if (y < 45) { pg = out.addPage([595, 842]); y = 800 }
            let x = MARG_ESQ
            if (b.centro) { const w = fnt.widthOfTextAtSize(ln, tamanho); x = MARG_ESQ + Math.max(0, (LARG_UTIL - w) / 2) }
            pg.drawText(ln, { x, y, size: tamanho, font: fnt }); y -= 13
          }
          y -= 6
        }
        juntados++
      } catch (e) { falhos++ }
    }
  }
  if (!out.getPageCount()) return { erro: 'não foi possível montar o PDF' }
  return { bytes: Buffer.from(await out.save()), juntados, falhos, total: files.length }
}
