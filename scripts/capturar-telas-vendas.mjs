// Capturas de tela REAIS para a página de vendas.
//
// A página vende um sistema; a prova de que ele existe é a tela dele. Estas
// imagens são geradas a partir do HTML DE VERDADE (public/sistema.html) — o
// mesmo arquivo que roda em produção —, com DADOS DE EXEMPLO injetados no lugar
// das chamadas ao servidor. Duas razões para ser assim:
//
//   - nenhum nome de cliente, número de processo real ou valor aparece numa
//     página pública. Não é só LGPD: é o contrário do que o produto promete;
//   - a imagem não pode ser um desenho bonito que o sistema não faz. Saindo do
//     HTML real, quando a tela muda, basta rodar isto de novo e a página de
//     vendas volta a dizer a verdade.
//
//   node scripts/capturar-telas-vendas.mjs
//
// Precisa do Playwright instalado (dev): npm i -D playwright

import fs from 'fs'
import path from 'path'
import http from 'http'
import { chromium } from 'playwright'

const RAIZ = process.cwd()
const SAIDA = path.join(RAIZ, 'public', 'vendas')
const CHROME = process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const html = fs.readFileSync(path.join(RAIZ, 'public', 'sistema.html'), 'utf8')
const css = html.slice(html.indexOf(':root{'), html.indexOf('</style>'))

const pedaco = (de, ate) => html.slice(html.indexOf(de), html.indexOf(ate))
const funcao = (marca) => {
  const i = html.indexOf(marca)
  if (i < 0) throw new Error('não achei no sistema.html: ' + marca)
  return html.slice(i, html.indexOf('\n</script>', i))
}

const BASE = (corpo, extra) => `<!doctype html><meta charset="utf-8"><style>${css}
  body{margin:0;padding:18px;background:#f3f5f8}
  .overlay{position:static!important;background:transparent}
  .modal{background:#fff;border-radius:16px;padding:20px}
  ${extra || ''}
</style><body>${corpo}</body>`

const COMUM = `
function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function finEsc(s){ return esc(s); }
function fmtCNJ(n){ return String(n||''); }
window.confirm=function(){ return true; };
window.__escInfo={oabs:[{numero:'000000',uf:'PB'}],marca:{}};
window.__sb={auth:{getSession:async()=>({data:{session:{access_token:'x'}}})}};
`

// ————————————————————————————————————————————————————————————————
// As telas. Cada uma diz o que injeta e o que recorta.
// ————————————————————————————————————————————————————————————————
const TELAS = [
  {
    arquivo: 'cadastro-oab.png',
    largura: 1080,
    recorte: '#modal-oab .modal',
    pagina: () => BASE(pedaco('<div id="modal-oab"', '<div id="modal-sync"'), '.modal{max-width:980px}') .replace('</body>', `
      <script>${COMUM}
        var ITENS=[
          {numero:'0801234-55.2025.8.15.2001',digitos:'08012345520258152001',tribunal:'TJPB',data:'2026-08-28',publicacoes:2,ativo:'Cliente Exemplo Um',passivo:'Empresa Exemplo S/A',meu:false},
          {numero:'0805678-12.2024.8.15.2003',digitos:'08056781220248152003',tribunal:'TJPB',data:'2026-08-21',publicacoes:1,ativo:'Condomínio Exemplo',passivo:'Fornecedor Exemplo Ltda',meu:false},
          {numero:'0000987-65.2026.5.13.0004',digitos:'00009876520265130004',tribunal:'TRT13',data:'2026-08-15',publicacoes:3,ativo:'Cliente Exemplo Dois',passivo:'Comércio Exemplo Ltda',meu:false},
          {numero:'0812345-90.2023.8.15.2001',digitos:'08123459020238152001',tribunal:'TJPB',data:'2026-08-11',publicacoes:1,ativo:'Cliente Exemplo Três',passivo:'Município Exemplo',meu:true}
        ];
        window.fetch=async()=>({ok:true,json:async()=>({ok:true,busca:'OAB 000000/PB',dias:90,total:412,cadastrados:87,itens:ITENS,plano:{limite_processos:500,usados:87},falhas:[]})});
        ${funcao('/* ===== Cadastrar processos pela OAB (lote) =====')}
        (async()=>{ document.getElementById('modal-oab').classList.remove('hidden');
          await abrirCadastroOab(); await buscarOab(document.querySelector('#modal-oab .btn'));
          oabMarcar('08012345520258152001',true); oabMarcar('08056781220248152003',true); oabMarcar('00009876520265130004',true);
          window.__pronto=true; })();
      </script></body>`),
  },
  {
    arquivo: 'robos.png',
    largura: 860,
    recorte: '#cartao-robos',
    pagina: () => BASE(`<div id="cartao-robos" class="card" style="max-width:800px;margin:0 auto">
        <p class="sectlabel" style="margin:0">🤖 Robôs de leitura do seu escritório</p>
        <p class="note" style="margin:6px 0 10px">Rodam sozinhos no servidor, com o computador desligado. Aqui você vê a última rodada <b>do seu escritório</b> e pode mandar rodar na hora.</p>
        <div id="rl-body"></div></div>`).replace('</body>', `
      <script>${COMUM}
        async function _diToken(){ return 'x'; }
        window.fetch=async()=>({ok:true,json:async()=>({ok:true,robos:[
          {nome:'djen',rotulo:'Diário de Justiça — publicações',faz:'Procura de duas em duas horas, nas OAB do escritório, o que saiu no Diário de Justiça de todos os tribunais, e leva a publicação para o histórico do processo.',pendencia:null,ultima_exec:'2026-09-04T14:02:00Z',ultimo_ok:true,ultimo_resultado:'12 publicação(ões) nova(s) em 9 processo(s)'},
          {nome:'email_receber',rotulo:'Caixa de e-mail — respostas das varas e dos clientes',faz:'Lê a caixa do escritório de dez em dez minutos e leva cada resposta para o histórico do processo certo.',pendencia:null,ultima_exec:'2026-09-04T14:10:00Z',ultimo_ok:true,ultimo_resultado:'3 mensagem(ns) levada(s) para a ficha'},
          {nome:'minuta_triagem',rotulo:'Estagiário Virtual — triagem das intimações',faz:'Lê cada intimação que o diário trouxe, decide se ela exige peça, abre o prazo no Kanban e monta o dossiê dos autos.',pendencia:null,ultima_exec:'2026-09-04T13:40:00Z',ultimo_ok:true,ultimo_resultado:'5 intimação(ões) triada(s) · 3 prazos abertos'},
          {nome:'secretaria_audiencias',rotulo:'Secretária Virtual — audiências na agenda',faz:'Reconhece a publicação que designa, redesigna ou adia audiência e coloca o compromisso na agenda, com dia, hora, modalidade e local.',pendencia:null,ultima_exec:'2026-09-04T13:41:00Z',ultimo_ok:true,ultimo_resultado:'1 audiência marcada na agenda'}
        ]})});
        ${funcao('async function renderRobosLeitura(){')}
        (async()=>{ await renderRobosLeitura(); window.__pronto=true; })();
      </script></body>`),
  },
]

/* A marca d'água não é uma tela: é um PDF. Para a página de vendas mostrar como
   ela fica, geramos o mesmo PDF de exemplo que o sistema entrega ao coordenador
   (app/api/marca-dagua) e renderizamos a primeira página com o pdf.js — o mesmo
   motor que o navegador usa para exibir PDF. O que aparece na imagem é,
   literalmente, o arquivo que o estagiário receberia. */
async function pdfMarcaDagua() {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const { marcarPdf } = await import(path.join(RAIZ, 'lib', 'marcadagua.js'))
  const doc = await PDFDocument.create()
  const fonte = await doc.embedFont(StandardFonts.TimesRoman)
  const negrito = await doc.embedFont(StandardFonts.TimesRomanBold)
  const pag = doc.addPage([595.28, 841.89])
  const T = rgb(0.06, 0.09, 0.13)
  pag.drawText('EXCELENTÍSSIMO SENHOR DOUTOR JUIZ DE DIREITO', { x: 85, y: 762, size: 11.5, font: negrito, color: T })
  let y = 700
  for (const l of [
    'Fulano de Tal, já qualificado nos autos em epígrafe, vem, respeitosamente, à',
    'presença de Vossa Excelência, por seu advogado que esta subscreve, apresentar',
    'RÉPLICA à contestação, pelos fundamentos de fato e de direito a seguir expostos.',
    '',
    'O texto da peça continua nítido e pode ser copiado normalmente — a marca',
    'd’água fica ao fundo e não é texto, então ela não entra no copiar e colar.',
  ]) { if (l) pag.drawText(l, { x: 85, y, size: 11.5, font: fonte, color: T }); y -= 19 }
  const base = Buffer.from(await doc.save())
  return await marcarPdf(base, 'CÓPIA DE TRABALHO · Estagiário(a) do escritório · estagiario@exemplo.com · 04/09/2026 15:20')
}

async function servir(paginas) {
  const srv = http.createServer((req, res) => {
    const nome = req.url.split('?')[0].replace(/^\//, '') || 'index'
    const p = paginas[nome]
    if (!p) { res.writeHead(404); res.end(); return }
    const tipo = nome.endsWith('.mjs') ? 'text/javascript' : 'text/html; charset=utf-8'
    res.writeHead(200, { 'Content-Type': tipo }); res.end(p)
  })
  await new Promise(r => srv.listen(8799, r))
  return srv
}

const paginas = {}
for (const t of TELAS) paginas[t.arquivo.replace('.png', '')] = t.pagina()

// a página que desenha o PDF da marca d'água
const b64 = (await pdfMarcaDagua()).toString('base64')
paginas['marca-dagua'] = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#fff">
<canvas id="c"></canvas>
<script type="module">
import * as pdfjsLib from '/pdf.mjs'
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs'
const bruto = atob('${b64}')
const arr = new Uint8Array(bruto.length); for (let i=0;i<bruto.length;i++) arr[i]=bruto.charCodeAt(i)
const doc = await pdfjsLib.getDocument({data:arr}).promise
const pg = await doc.getPage(1)
const vp = pg.getViewport({scale:1.6})
const c = document.getElementById('c'); c.width=vp.width; c.height=vp.height
await pg.render({canvasContext:c.getContext('2d'), viewport:vp}).promise
window.__pronto = true
</script></body>`
paginas['pdf.mjs'] = fs.readFileSync(path.join(RAIZ, 'node_modules/pdfjs-dist/build/pdf.mjs'), 'utf8')
paginas['pdf.worker.mjs'] = fs.readFileSync(path.join(RAIZ, 'node_modules/pdfjs-dist/build/pdf.worker.mjs'), 'utf8')
// só a metade de cima da folha: o resto é margem em branco, que numa galeria
// só faz a imagem pesar e a marca parecer menor do que é
TELAS.push({ arquivo: 'marca-dagua.png', largura: 1000, recorte: '#c', alturaPct: 0.46, escala: 1.5, pagina: () => paginas['marca-dagua'] })
const srv = await servir(paginas)

fs.mkdirSync(SAIDA, { recursive: true })
const br = await chromium.launch({ executablePath: CHROME })
for (const t of TELAS) {
  const pg = await br.newPage({ viewport: { width: t.largura, height: 900 }, deviceScaleFactor: t.escala || 2 })
  pg.on('pageerror', e => console.log('  [erro]', t.arquivo, String(e)))
  await pg.goto('http://127.0.0.1:8799/' + t.arquivo.replace('.png', ''))
  await pg.waitForFunction('window.__pronto===true', null, { timeout: 20000 })
  await pg.waitForTimeout(200)
  const alvo = pg.locator(t.recorte)
  if (t.alturaPct) {
    const cx = await alvo.boundingBox()
    await pg.screenshot({ path: path.join(SAIDA, t.arquivo), clip: { x: cx.x, y: cx.y, width: cx.width, height: Math.round(cx.height * t.alturaPct) } })
  } else {
    await alvo.screenshot({ path: path.join(SAIDA, t.arquivo) })
  }
  const kb = Math.round(fs.statSync(path.join(SAIDA, t.arquivo)).size / 1024)
  console.log('✓', t.arquivo, kb + ' KB')
  await pg.close()
}
await br.close()
srv.close()
