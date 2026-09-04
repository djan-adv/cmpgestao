// Gera lib/marcadagua-glifos.json — os contornos VETORIAIS das letras usadas na
// marca d'água dos documentos abertos por estagiário.
//
// Por que contorno e não texto: a marca precisa ser invisível para o copiar e
// colar. Texto no PDF é sempre extraível — inclusive marcado como Artifact, o
// que foi testado aqui com o pdf.js e NÃO segurou a extração. Desenhando as
// letras como caminho vetorial, não existe texto nenhum para extrair: o
// estagiário copia a peça e leva só a peça.
//
// Roda à mão, quando for preciso mudar o conjunto de caracteres:
//   node scripts/gerar-glifos-marcadagua.mjs
//
// A fonte de origem é a Liberation Sans (SIL OFL 1.1) — a licença acompanha em
// lib/fontes/LICENSE_LIBERATION. Só entram os contornos dos caracteres abaixo.

import opentype from 'opentype.js'
import fs from 'fs'

const FONTE = 'lib/fontes/LiberationSans-Regular.ttf'
const SAIDA = 'lib/marcadagua-glifos.json'

let chars = ''
for (let c = 0x20; c <= 0x7e; c++) chars += String.fromCharCode(c)      // ASCII imprimível
for (let c = 0xc0; c <= 0xff; c++) chars += String.fromCharCode(c)      // acentuadas Latin-1
chars += '·—–“”‘’'                                                      // pontuação que aparece nos nomes e no rótulo

const font = opentype.loadSync(FONTE)
// desenha num em de 1000 unidades (o que o desenho em runtime espera), qualquer
// que seja o unitsPerEm da fonte de origem — a Liberation usa 2048
const EM = 1000
const glifos = {}
for (const ch of chars) {
  const g = font.charToGlyph(ch)
  if (!g) continue
  const p = g.getPath(0, 0, EM)           // origem na linha de base, em de 1000
  /* Sem inverter o y: o drawSvgPath do pdf-lib já desenha o caminho no sentido
     do SVG (y para baixo), e o contorno da fonte vem com y para cima — as duas
     inversões se cancelam. Invertendo aqui, a letra sai de cabeça para baixo
     (foi o primeiro resultado do teste). */
  glifos[ch] = { a: Math.round((g.advanceWidth / font.unitsPerEm) * 1000) / 1000, d: p.toPathData(2) }
}
fs.writeFileSync(SAIDA, JSON.stringify({ upm: 1000, fonte: 'Liberation Sans (SIL OFL 1.1)', glifos }))
console.log(Object.keys(glifos).length + ' glifos em ' + SAIDA + ' (' + Math.round(fs.statSync(SAIDA).size / 1024) + ' KB)')
