// Marca d'água nos documentos abertos por ESTAGIÁRIO.
//
// Pedido do dono (04/09/2026): o escritório pode marcar todo documento que um
// estagiário abrir com o nome dele, a data e a hora. Não impede print nem foto
// — impede o uso desavisado e identifica a origem de um vazamento. É a mesma
// ideia da tarja do portal do perito (app/api/inove/lib.js), com duas exigências
// que o dono fez e que mudam a implementação:
//
//   1. AO FUNDO. O carimbo entra ANTES do conteúdo da página, não por cima: o
//      texto da peça continua nítido e o carimbo fica como papel timbrado. Em
//      PDF isso é a ordem do fluxo de conteúdo — por isso o desenho é movido
//      para o começo do array /Contents depois de pronto.
//   2. SEM LEITURA. O carimbo NÃO é texto: as letras são desenhadas como
//      contorno vetorial (lib/marcadagua-glifos.json). Foi a única forma que
//      resistiu ao teste — carimbo em texto marcado como Artifact
//      (ISO 32000-1 §14.8.2.2), que é a técnica recomendada e a que o portal do
//      perito usa, CONTINUOU saindo na extração do pdf.js. Sem texto no fluxo,
//      não há o que extrair: o estagiário copia a peça e leva só a peça.
//
// O arquivo no disco NUNCA é alterado: o carimbo é aplicado numa cópia em
// memória, no momento da entrega.

import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

// a chave que liga/desliga, na configuração do próprio escritório
export const CHAVE_CONFIG = 'marca_dagua_estagiario'

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    global: { fetch: (u, o) => fetch(u, { ...o, cache: 'no-store' }) },
  })
}

const ehEstagiario = (papel) => /^est/i.test(String(papel || '')) || /estagi/i.test(String(papel || ''))

// Data e hora de Brasília no formato que o carimbo mostra.
function agoraBR() {
  const d = new Date(Date.now() - 3 * 3600000)
  const p = (n) => String(n).padStart(2, '0')
  return p(d.getUTCDate()) + '/' + p(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear() +
    ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes())
}

/* Este pedido leva carimbo? Devolve { marcar, etiqueta }.
   Só marca quando as DUAS coisas valem: o escritório ligou a opção e quem pede
   é estagiário. Advogado e sócio recebem o documento limpo — a marca existe
   para o material que sai da mão de quem está aprendendo, não para atrapalhar
   quem protocola. */
export async function carimboDoPedido(escritorioId, userId, sb) {
  try {
    if (!escritorioId || !userId) return { marcar: false }
    const cli = sb || admin()
    const [cfg, quem, escr] = await Promise.all([
      cli.from('produtividade_config').select('valor').eq('escritorio_id', escritorioId).eq('chave', CHAVE_CONFIG).maybeSingle(),
      cli.from('usuarios').select('nome,email,papel').eq('id', userId).maybeSingle(),
      cli.from('escritorios').select('teste_ate').eq('id', escritorioId).maybeSingle(),
    ])
    const u = quem.data
    if (!u) return { marcar: false }

    // DURANTE O TESTE, TODO DOCUMENTO SAI MARCADO — para todo mundo, não só
    // para estagiário, e sem depender de ninguém ligar nada.
    //
    // O motivo é a porta aberta: qualquer pessoa abre um teste sozinha e digita
    // a inscrição na OAB que quiser. O que ela consegue com isso é material
    // público (o Diário de Justiça é público, e os autos de verdade continuam
    // exigindo o certificado digital do escritório) — mas o sistema entrega
    // isso reunido, organizado e pronto para levar embora, e essa comodidade é
    // nossa, não do Diário.
    //
    // A marca não impede a cópia: ela tira o anonimato dela. Quem baixou fica
    // escrito na página, e material com carimbo de avaliação não se apresenta
    // como trabalho próprio em lugar nenhum. É o freio proporcional a um risco
    // que dura 30 dias — e some sozinho quando o escritório contrata.
    if (escr.data && escr.data.teste_ate) {
      return { marcar: true, etiqueta: etiquetaDe(u, true) }
    }

    const ligado = String((cfg.data && cfg.data.valor) || '').trim()
    if (!/^(1|true|sim|on)$/i.test(ligado)) return { marcar: false }
    if (!ehEstagiario(u.papel)) return { marcar: false }
    return { marcar: true, etiqueta: etiquetaDe(u) }
  } catch (e) { return { marcar: false } }
}

export function etiquetaDe(u, emTeste) {
  const nome = String((u && u.nome) || '').trim()
  const email = String((u && u.email) || '').trim()
  const quem = nome && email ? (nome + ' · ' + email) : (nome || email || 'estagiário')
  // Dois rótulos porque são duas conversas diferentes: dentro do escritório, a
  // marca diz "cópia de trabalho, não é a via boa"; no teste, diz que aquele
  // documento saiu de um sistema em avaliação, e por quem.
  return (emTeste ? 'AVALIAÇÃO · ' : 'CÓPIA DE TRABALHO · ') + quem + ' · ' + agoraBR()
}

/* O carimbo em PDF.
   Nunca lança: documento com carimbo é melhor que documento, mas documento sem
   carimbo é melhor que erro na cara de quem só queria ler a peça. Em caso de
   falha (PDF cifrado, arquivo torto) devolve o original. */
/* Os contornos das letras, gerados de uma vez por
   scripts/gerar-glifos-marcadagua.mjs. Lido uma vez por processo do servidor. */
let _glifos = null
function glifos() {
  if (_glifos) return _glifos
  try {
    const j = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'lib', 'marcadagua-glifos.json'), 'utf8'))
    _glifos = j.glifos || {}
  } catch (e) { _glifos = {} }
  return _glifos
}

/* Desenha o rótulo UMA vez, numa página solta, e devolve essa página para ser
   embutida como objeto reaproveitável. Repetir o desenho letra a letra em cada
   posição da grade inflaria o arquivo (uma íntegra de 200 páginas ganharia
   megabytes de contorno repetido); embutido, cada repetição é uma referência. */
async function paginaDoRotulo(PDFDocument, rgb, txt, tam) {
  const G = glifos()
  const doc = await PDFDocument.create()
  let largura = 0
  for (const ch of txt) { const g = G[ch] || G['?']; if (g) largura += g.a * tam }
  if (!largura) return null
  const alt = tam * 1.35
  const pag = doc.addPage([Math.ceil(largura) + 2, Math.ceil(alt)])
  const linhaBase = tam * 0.28          // sobra embaixo para as descidas (g, p, y)
  let x = 1
  for (const ch of txt) {
    const g = G[ch] || G['?']
    if (!g) continue
    if (g.d) {
      // o caminho vem em 1 em com y já invertido (o pdf-lib usa y para baixo no SVG)
      pag.drawSvgPath(g.d, { x, y: linhaBase, scale: tam / 1000, color: rgb(0.42, 0.47, 0.56) })
    }
    x += g.a * tam
  }
  return { pag, largura, alt }
}

export async function marcarPdf(buf, etiqueta) {
  try {
    const { PDFDocument, rgb, degrees, PDFName, PDFOperator } = await import('pdf-lib')
    const txt = String(etiqueta || '').trim()
    if (!txt) return buf
    const doc = await PDFDocument.load(buf, { ignoreEncryption: true })
    const TAM = 12
    const rot = await paginaDoRotulo(PDFDocument, rgb, txt, TAM)
    if (!rot) return buf
    const emb = await doc.embedPage(rot.pag)
    const props = doc.context.obj({ Type: 'Pagination', Subtype: 'Watermark' })

    for (const pag of doc.getPages()) {
      const { width, height } = pag.getSize()
      // quantos fluxos de conteúdo a página já tinha: o que for acrescentado
      // daqui para a frente é nosso, e é isso que vai para o começo
      pag.node.normalize()
      const contents = pag.node.get(PDFName.of('Contents'))
      const antes = contents && contents.size ? contents.size() : 0

      pag.pushOperators(PDFOperator.of('BDC', [PDFName.of('Artifact'), props]))
      /* Densidade: o rótulo é longo (nome + e-mail + data), então a grade anda
         menos que a largura dele — as fileiras diagonais se entrelaçam e cobrem
         a folha sem deixar o meio vazio, que foi como ficou na primeira tentativa. */
      const passoX = Math.max(rot.largura * 0.62, 200)
      const passoY = 120
      for (let y = -height; y < height * 1.45; y += passoY) {
        for (let x = -rot.largura; x < width * 1.35; x += passoX) {
          pag.drawPage(emb, { x, y, rotate: degrees(45), opacity: 0.16 })
        }
      }
      pag.pushOperators(PDFOperator.of('EMC', []))

      // ——— e agora para trás do conteúdo ———
      // Em PDF quem desenha depois cobre quem desenhou antes. O pdf-lib só sabe
      // acrescentar ao fim, então o bloco recém-criado é movido para o começo do
      // array /Contents: o carimbo vira fundo, e a peça é desenhada por cima.
      try {
        const arr = pag.node.get(PDFName.of('Contents'))
        if (arr && arr.size && arr.size() > antes) {
          const novos = []
          for (let i = arr.size() - 1; i >= antes; i--) { novos.unshift(arr.get(i)); arr.remove(i) }
          novos.forEach((ref, i) => arr.insert(i, ref))
        }
      } catch (e) { /* não deu para reordenar: fica por cima, que ainda serve */ }
    }
    return Buffer.from(await doc.save())
  } catch (e) { return buf }
}

/* O carimbo em HTML (o jus.br entrega expediente e certidão em HTML).
   Aqui não existe o problema da seleção: a camada é pointer-events:none e
   user-select:none, e fica atrás do texto por z-index negativo. */
export function marcarHtml(html, etiqueta) {
  const txt = String(etiqueta || '')
  if (!txt.trim()) return html
  const e = txt.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const camada =
    '<div aria-hidden="true" style="position:fixed;inset:0;z-index:-1;pointer-events:none;user-select:none;-webkit-user-select:none;overflow:hidden">' +
      '<div style="position:absolute;inset:-50%;display:flex;flex-wrap:wrap;align-content:space-around;justify-content:space-around;transform:rotate(-32deg);opacity:.14">' +
        Array.from({ length: 60 }).map(() =>
          '<span style="display:inline-block;margin:34px 46px;font:600 12px system-ui,sans-serif;color:#5a6472;white-space:nowrap">' + e + '</span>').join('') +
      '</div></div>'
  if (/<body[\s>]/i.test(html)) return html.replace(/<body([^>]*)>/i, '<body$1>' + camada)
  return '<!doctype html><html><head><meta charset="utf-8"></head><body>' + camada + html + '</body></html>'
}

// Só PDF e HTML têm carimbo. Word/Excel/imagem passam direto — carimbar cada
// formato exigiria uma biblioteca por formato, e prometer o que não se entrega
// é pior do que dizer onde a marca vale.
export function tipoCarimbavel(tipo, nome) {
  const t = String(tipo || '').toLowerCase()
  const n = String(nome || '').toLowerCase()
  if (t.includes('pdf') || /\.pdf$/.test(n)) return 'pdf'
  if (t.includes('html') || /\.html?$/.test(n)) return 'html'
  return null
}
