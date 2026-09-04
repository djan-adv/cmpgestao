// Petição em PDF A4, montada aqui mesmo — sem Word, sem conversor externo.
//
// O sistema já redigia a minuta em .doc (que é HTML com outro nome): serve para
// editar, não para protocolar. O jus.br quer PDF, e converter .doc→PDF no
// servidor exigiria um Chrome headless inteiro. Como o pdf-lib já monta a
// procuração A4 do assinador, o mesmo motor desenha a peça: margens de petição,
// texto justificado, numeração de página e o timbre do escritório.
//
// NÃO assina nem protocola: gera o arquivo que o advogado confere antes.

import { embutirLogo } from './timbre.js'

const W = 595.28, H = 841.89      // A4 em pontos
const MARGEM_ESQ = 85, MARGEM_DIR = 57, MARGEM_TOPO = 78, MARGEM_BASE = 62
const TAM = 11.5, ENTRE = 18, ENTRE_SIMPLES = 14   // corpo (~1,5) e o cabeçalho (simples)

// pdf-lib desenha em WinAnsi: caractere fora da tabela derruba a geração
function winAnsi(s) {
  return String(s == null ? '' : s)
    .replace(/[""]/g, '"').replace(/['']/g, "'")
    .replace(/[–—]/g, '-').replace(/…/g, '...')
    .replace(/[​-‍﻿]/g, '')
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, ' ')
}

// quebra o parágrafo em linhas que cabem na largura útil
function quebrar(txt, fonte, tamanho, largura) {
  const linhas = []
  for (const bruto of String(txt).split('\n')) {
    const palavras = bruto.split(/\s+/).filter(Boolean)
    if (!palavras.length) { linhas.push(''); continue }
    let atual = ''
    for (const p of palavras) {
      const tent = atual ? atual + ' ' + p : p
      if (fonte.widthOfTextAtSize(tent, tamanho) <= largura) atual = tent
      else { if (atual) linhas.push(atual); atual = p }
    }
    if (atual) linhas.push(atual)
  }
  return linhas
}

/* Justificação: distribui a sobra entre os espaços da linha. A última linha do
   parágrafo fica alinhada à esquerda, como em qualquer peça. */
function desenharJustificado(pg, linha, ehUltima, { x, y, fonte, tamanho, largura, cor }) {
  const palavras = linha.split(' ').filter(Boolean)
  if (ehUltima || palavras.length < 2) {
    pg.drawText(linha, { x, y, size: tamanho, font: fonte, color: cor })
    return
  }
  const larguraTexto = palavras.reduce((s, p) => s + fonte.widthOfTextAtSize(p, tamanho), 0)
  const sobra = largura - larguraTexto
  const passo = sobra / (palavras.length - 1)
  let cx = x
  for (const p of palavras) {
    pg.drawText(p, { x: cx, y, size: tamanho, font: fonte, color: cor })
    cx += fonte.widthOfTextAtSize(p, tamanho) + passo
  }
}

/* ——— cabeçalho da peça ———
   Padrão do escritório (pedido do dono, 02/09/2026): endereçamento, TRÊS linhas
   em branco, o bloco de identificação em espaçamento simples, e SETE linhas em
   branco antes do corpo. O PDF saía com tudo espremido. */
const RE_ENDERECAMENTO = /^(a[o]?\s+(ju[íi]z|ex|meritíssim|dr)|excelent[íi]ssim|exm[oa]|mm\.|meritíssim|ilustr[íi]ssim|ao\s+ju[íi]zo|à\s+vara|ao\s+tribunal|colenda|egr[ée]gi)/i
const RE_IDENTIFICACAO = /^(processo|autos|refer[êe]ncia|ref\.|autor|r[ée]u|r[ée]|exequente|executad|requerente|requerid|reclamante|reclamad|embargante|embargad|agravante|agravad|apelante|apelad|impugnante|impugnad|recorrente|recorrid|suscitante|suscitad|impetrante|impetrad|credor|devedor|inventariante|espólio)\b[\s:ºn°]/i
function papelDoBloco(txt) {
  const primeira = String(txt).split('\n')[0].trim()
  if (RE_ENDERECAMENTO.test(primeira)) return 'enderecamento'
  if (RE_IDENTIFICACAO.test(primeira)) return 'identificacao'
  return 'corpo'
}

// Um título é linha curta, sem ponto final, em caixa alta ou terminada em ":".
function ehTitulo(l) {
  const t = l.trim()
  if (!t || t.length > 90) return false
  if (/^(EXCELENT[ÍI]SSIM|MM\.|MERIT[ÍI]SSIM)/i.test(t)) return false
  return (t === t.toUpperCase() && /[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{4}/.test(t)) || /^(DOS?|DAS?|I{1,3}V?|[0-9]+)[\).\-–]\s/.test(t)
}

export async function pecaEmPdf({ texto, processo, rodape, medir, sb = null, esc = null }) {
  const medidas = []   // com `medir`, devolve onde cada bloco começou — é como o espaçamento do cabeçalho é conferido
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const pdf = await PDFDocument.create()
  const reg = await pdf.embedFont(StandardFonts.TimesRoman)
  const neg = await pdf.embedFont(StandardFonts.TimesRomanBold)
  const TINTA = rgb(0.09, 0.12, 0.17), CINZA = rgb(0.45, 0.48, 0.53)
  const UTIL = W - MARGEM_ESQ - MARGEM_DIR

  // timbre: o logotipo do ESCRITÓRIO de quem gerou a peça (ver lib/timbre.js).
  // Sem escritório informado vale o da instalação, que é o caso do robô da casa.
  const logo = await embutirLogo(pdf, sb, esc)

  const paginas = []
  let pg = null, y = 0
  function novaPagina() {
    pg = pdf.addPage([W, H]); paginas.push(pg)
    y = H - MARGEM_TOPO
    if (paginas.length === 1 && logo) {
      const larg = 150, alt = (logo.height / logo.width) * larg
      pg.drawImage(logo, { x: (W - larg) / 2, y: y - alt, width: larg, height: alt })
      y -= alt + 26
    }
  }
  function espaco(n) {
    if (y - n < MARGEM_BASE + 26) novaPagina()
    else y -= n
  }
  novaPagina()

  const blocos = String(texto || '').split(/\n{2,}/).map(x => winAnsi(x).trim()).filter(Boolean)
  const papeis = blocos.map(papelDoBloco)
  /* o cabeçalho é o começo da peça: identificação que aparece no meio do texto
     (uma citação, por exemplo) não conta */
  const fimCabecalho = (() => {
    let i = 0
    while (i < papeis.length && papeis[i] === 'enderecamento') i++
    while (i < papeis.length && papeis[i] === 'identificacao') i++
    return i
  })()

  blocos.forEach((cru, idx) => {
    const papel = idx < fimCabecalho ? papeis[idx] : 'corpo'
    if (medir) medidas.push({ idx, papel, y, pagina: paginas.length, texto: cru.split('\n')[0].slice(0, 40) })
    const identificacao = papel === 'identificacao'
    const titulo = !identificacao && ehTitulo(cru)
    const fonte = (titulo || identificacao) ? neg : reg
    const linhas = quebrar(cru, fonte, TAM, UTIL)
    if (y - (linhas.length * ENTRE) < MARGEM_BASE + 26 && linhas.length <= 4) novaPagina()
    linhas.forEach((l, i) => {
      if (y < MARGEM_BASE + 26) novaPagina()
      /* identificação em espaçamento simples e sem justificar: são linhas
         curtas, e justificá-las abriria buracos entre as palavras */
      if (titulo || identificacao) pg.drawText(l, { x: MARGEM_ESQ, y, size: TAM, font: (identificacao && i > 0) ? reg : neg, color: TINTA })
      else desenharJustificado(pg, l, i === linhas.length - 1, { x: MARGEM_ESQ, y, fonte, tamanho: TAM, largura: UTIL, cor: TINTA })
      y -= identificacao ? ENTRE_SIMPLES : ENTRE
    })
    const proximo = papeis[idx + 1]
    if (papel === 'enderecamento' && proximo !== 'enderecamento') espaco(3 * ENTRE)      // três linhas
    else if (identificacao && idx + 1 >= fimCabecalho) espaco(7 * ENTRE)                  // sete linhas
    else if (identificacao) espaco(0)                                                     // dentro do bloco: simples
    else espaco(titulo ? 8 : 12)
  })

  // rodapé: processo e numeração, em todas as páginas
  const linhaProc = winAnsi((processo && processo.numero) ? ('Processo n. ' + processo.numero) : '')
  paginas.forEach((p, i) => {
    const num = (i + 1) + '/' + paginas.length
    if (linhaProc) p.drawText(linhaProc, { x: MARGEM_ESQ, y: 40, size: 8, font: reg, color: CINZA })
    p.drawText(num, { x: W - MARGEM_DIR - reg.widthOfTextAtSize(num, 8), y: 40, size: 8, font: reg, color: CINZA })
    if (rodape) {
      const r = winAnsi(rodape).slice(0, 120)
      p.drawText(r, { x: (W - reg.widthOfTextAtSize(r, 7.5)) / 2, y: 26, size: 7.5, font: reg, color: CINZA })
    }
  })

  const bytes = Buffer.from(await pdf.save())
  return medir ? { bytes, medidas, entre: ENTRE, entreSimples: ENTRE_SIMPLES } : bytes
}
