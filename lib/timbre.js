// O timbre dos PDFs que o sistema gera — de QUEM é o logotipo.
//
// A procuração assinada e o PDF da peça saíam com o logotipo da casa que opera o
// sistema, lido de public/logo_cmp_full.png. Num documento do escritório cliente
// isso não é só rastro de marca: é documento de cliente saindo com o nome de
// outro escritório — o pior lugar possível para uma marca errada, porque a
// procuração vai para os autos.
//
// Regra: o logotipo é o que o escritório cadastrou (marca.logo, uma URL pública
// do próprio sistema). O arquivo local só vale para o escritório da instalação,
// que sempre usou ele. Sem logotipo cadastrado, o documento sai SEM timbre — em
// branco é correto; com a marca de terceiro, não.

import fs from 'fs'
import path from 'path'
import { ESCRITORIO_RAIZ } from '../app/api/_lib/inquilino.js'

const LIMITE_BYTES = 4 * 1024 * 1024   // logotipo é imagem pequena; acima disso, algo está errado

// Devolve { bytes, tipo } ou null. Nunca lança: documento sem timbre é melhor
// do que documento que não sai.
export async function logoDoEscritorio(sb, esc) {
  try {
    if (!esc || esc === ESCRITORIO_RAIZ) {
      const p = path.join(process.cwd(), 'public', 'logo_cmp_full.png')
      if (fs.existsSync(p)) return { bytes: fs.readFileSync(p), tipo: 'png' }
      return null
    }
    if (!sb) return null
    const { data } = await sb.from('escritorios').select('marca').eq('id', esc).maybeSingle()
    const url = data && data.marca && data.marca.logo
    if (!url || !/^https?:\/\//i.test(String(url))) return null
    const r = await fetch(String(url), { cache: 'no-store', signal: AbortSignal.timeout(8000) })
    if (!r.ok) return null
    const buf = Buffer.from(await r.arrayBuffer())
    if (!buf.length || buf.length > LIMITE_BYTES) return null
    // o tipo vem dos bytes, não da extensão da URL: quem envia o logotipo pelo
    // sistema pode ter mandado JPEG com nome .png
    const png = buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50
    const jpg = buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8
    if (!png && !jpg) return null
    return { bytes: buf, tipo: png ? 'png' : 'jpg' }
  } catch (e) { return null }
}

// Embute o logotipo num PDFDocument do pdf-lib. Devolve a imagem ou null.
export async function embutirLogo(pdf, sb, esc) {
  const l = await logoDoEscritorio(sb, esc)
  if (!l) return null
  try { return l.tipo === 'png' ? await pdf.embedPng(l.bytes) : await pdf.embedJpg(l.bytes) }
  catch (e) { return null }
}
