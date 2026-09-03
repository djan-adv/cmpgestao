// Assinatura recebida POR FORA do link — o cliente assinou o PDF à mão no
// celular e mandou por WhatsApp (caso do Heury, 03/09/2026). O sistema não tinha
// como saber, e o "PDF final" saía com a linha em branco e "Status: visto".
//
// Aqui o escritório sobe o arquivo assinado e o sistema faz o que eu fiz à mão
// naquele dia: recolore o traço da caneta (vermelho → azul, sem tocar no
// desenho), anexa a página de assinaturas com o identificador e os hashes reais
// dos dois arquivos, e marca o signatário como assinado. Vale como assinatura
// eletrônica simples (Lei 14.063/2020, art. 4º, I): a prova é a conversa em que
// o próprio signatário mandou o arquivo.
import { PDFDocument, PDFName, PDFArray, PDFRawStream, StandardFonts, rgb } from 'pdf-lib'
import zlib from 'zlib'
import crypto from 'crypto'

const AZUL = [0.06, 0.20, 0.62]
const NUM = String.raw`(-?\d*\.?\d+)`
/* cor de traço/preenchimento em RGB: "1 0.32 0.32 RG" (traço) / "rg" (preenchimento),
   e as variantes com espaço de cor nomeado "… sc / scn / SC / SCN" */
const RE_COR = new RegExp(`(^|[\\s])${NUM}\\s+${NUM}\\s+${NUM}\\s+(RG|rg|SC|sc|SCN|scn)(?=\\s|$)`, 'g')

export function ehVermelho(r, g, b) { return r > 0.6 && g < 0.5 && b < 0.5 && (r - Math.max(g, b)) > 0.3 }

/* troca, no texto de um content stream, toda cor vermelha por azul */
export function recolorirStream(txt) {
  let n = 0
  const out = txt.replace(RE_COR, (m, pre, r, g, b, op) => {
    if (!ehVermelho(+r, +g, +b)) return m
    n++
    return pre + AZUL.join(' ') + ' ' + op
  })
  return { texto: out, trocas: n }
}

function bytesDoStream(ctx, stream) {
  const filtro = stream.dict.get(PDFName.of('Filter'))
  const nome = filtro ? String(filtro) : ''
  const raw = stream.contents
  if (/FlateDecode/.test(nome)) return { bytes: zlib.inflateSync(Buffer.from(raw)), flate: true }
  if (!nome) return { bytes: Buffer.from(raw), flate: false }
  return null   // outro filtro: não mexe
}

/* recolore os traços vermelhos de TODAS as páginas (conteúdo direto e XObjects
   de formulário, que é onde alguns apps de celular guardam a tinta) */
export async function recolorirVermelhoParaAzul(bytesPdf) {
  const pdf = await PDFDocument.load(bytesPdf, { ignoreEncryption: true })
  const ctx = pdf.context
  let trocas = 0
  const feitos = new Set()
  const processa = (ref) => {
    const key = String(ref)
    if (feitos.has(key)) return
    feitos.add(key)
    const st = ctx.lookup(ref)
    if (!(st instanceof PDFRawStream)) return
    const b = bytesDoStream(ctx, st)
    if (!b) return
    const r = recolorirStream(b.bytes.toString('latin1'))
    if (!r.trocas) return
    trocas += r.trocas
    const novo = Buffer.from(r.texto, 'latin1')
    const flat = zlib.deflateSync(novo)
    st.dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'))
    st.dict.set(PDFName.of('Length'), ctx.obj(flat.length))
    st.contents = new Uint8Array(flat)
  }
  for (const page of pdf.getPages()) {
    const c = page.node.get(PDFName.of('Contents'))
    const cont = ctx.lookup(c)
    if (cont instanceof PDFArray) { for (let i = 0; i < cont.size(); i++) processa(cont.get(i)) }
    else if (c) processa(c)
    // XObjects de formulário da página
    try {
      const res = page.node.Resources()
      const xo = res && res.lookup(PDFName.of('XObject'))
      if (xo) for (const [, ref] of xo.entries()) {
        const s = ctx.lookup(ref)
        if (s instanceof PDFRawStream && String(s.dict.get(PDFName.of('Subtype'))) === '/Form') processa(ref)
      }
    } catch (e) {}
  }
  return { pdf, trocas }
}

export function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex') }

/* monta o PDF final: páginas do arquivo assinado (já recoloridas) + página de assinaturas */
export async function montarFinalExterno({ bytesAssinado, bytesOriginal, titulo, signatario, via, dataRecebida, identificador, quem }) {
  const { pdf, trocas } = await recolorirVermelhoParaAzul(bytesAssinado)
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const navy = rgb(.12, .20, .31), cinza = rgb(.35, .35, .35), preto = rgb(.1, .1, .1)
  const page = pdf.addPage([595.28, 841.89])
  const M = 56; let y = 785
  const T = (t, o = {}) => { page.drawText(String(t), { x: M, y, size: o.size || 10, font: o.bold ? bold : font, color: o.color || preto }); y -= (o.dy || 15) }
  T('PÁGINA DE ASSINATURAS', { size: 14, bold: true, color: navy, dy: 8 })
  page.drawLine({ start: { x: M, y }, end: { x: 539, y }, thickness: 1.2, color: navy }); y -= 26
  T('Documento: ' + (titulo || ''), { size: 11, dy: 26 })
  page.drawLine({ start: { x: M, y }, end: { x: M + 220, y }, thickness: .7, color: rgb(.4, .4, .4) }); y -= 16
  T(signatario.nome || signatario.email || '', { bold: true })
  if (signatario.cpf) T('CPF: ' + signatario.cpf)
  if (signatario.email) T('E-mail: ' + signatario.email)
  T('Assinatura: manuscrita, aposta pelo signatário sobre o documento e recebida dele por ' + (via || 'mensagem') + (dataRecebida ? (' em ' + dataRecebida) : '') + '.')
  T('Identificador do documento no sistema do escritório: ' + (identificador || ''), { dy: 21 })
  T('SHA-256 do arquivo assinado recebido do signatário:', { size: 9, bold: true, dy: 13 })
  T(sha256(bytesAssinado), { size: 8.5, dy: 15 })
  if (bytesOriginal) {
    T('SHA-256 do documento original emitido pelo sistema:', { size: 9, bold: true, dy: 13 })
    T(sha256(bytesOriginal), { size: 8.5, dy: 15 })
  }
  y -= 6
  const hoje = new Date().toLocaleDateString('pt-BR')
  T('Página gerada em ' + hoje + ' pelo escritório' + (quem ? (' (' + quem + ')') : '') + ' a partir do arquivo recebido do signatário.', { size: 8.5, color: cinza, dy: 12 })
  if (trocas) T('A assinatura foi recolorida de vermelho para azul sem alteração do traço.', { size: 8.5, color: cinza, dy: 12 })
  page.drawText('Assinatura eletrônica nos termos da Lei nº 14.063/2020, art. 4º, I (assinatura eletrônica simples) e da MP nº 2.200-2/2001, art. 10, § 2º.', { x: M, y: 42, size: 7.5, font, color: rgb(.45, .45, .45) })
  page.drawText('Crispim, Mendonça e Pinheiro — Advogados · 0800 591 7259 · contato@cmpadvogados.com.br', { x: M, y: 30, size: 7.5, font, color: rgb(.45, .45, .45) })
  const bytes = await pdf.save()
  return { bytes: Buffer.from(bytes), trocas, shaAssinado: sha256(bytesAssinado), shaOriginal: bytesOriginal ? sha256(bytesOriginal) : null }
}
