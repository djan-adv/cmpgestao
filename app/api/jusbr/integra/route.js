// jus.br / PDPJ — baixa a ÍNTEGRA do processo (todas as peças) e devolve um ZIP
// direto para o navegador (pasta Downloads). NÃO grava nada no sistema.
//   GET /api/jusbr/integra?numero=<digitos>&jwt=<jwt do Supabase>
// O PDPJ não expõe um "download dos autos" único nesta API, então montamos o
// pacote puxando cada documento (mesma lógica do download por peça).

import { createClient } from '@supabase/supabase-js'
import { getFreshToken, jusbrAdmin } from '../lib.js'

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
const soDig = (s) => String(s || '').replace(/\D/g, '')
const MAX_TOTAL = 180 * 1024 * 1024 // teto do pacote (memória/tempo)

async function usuario(jwt) {
  if (!jwt) return null
  try { const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY); const u = await sb.auth.getUser(jwt); return (u && u.data && u.data.user) || null } catch (e) { return null }
}
function abs(h) {
  h = String(h || '').trim(); if (!h) return null
  if (/^https?:\/\//i.test(h)) return h
  if (h.startsWith('/api/')) return PDPJ + h
  if (h.startsWith('/')) return PDPJ + '/api/v2' + h
  return PDPJ + '/api/v2/' + h
}
function ehShell(b) { return /<app-root|ng-version=/.test(b.slice(0, 6000).toString('utf8').toLowerCase()) }
function limpaNome(s) { return String(s || 'documento').replace(/[\\/:*?"<>|\r\n\t]+/g, '-').slice(0, 120) }

// CRC32 (para o ZIP)
let CRCT = null
function crc32(buf) {
  if (!CRCT) { CRCT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; CRCT[n] = c >>> 0 } }
  let crc = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRCT[(crc ^ buf[i]) & 0xFF]
  return (crc ^ 0xFFFFFFFF) >>> 0
}
// ZIP "store" (sem compressão — PDFs já são comprimidos)
function zip(files) {
  const chunks = [], central = []; let offset = 0
  for (const f of files) {
    const nome = Buffer.from(f.name, 'utf8'), crc = crc32(f.data), size = f.data.length
    const lfh = Buffer.alloc(30)
    lfh.writeUInt32LE(0x04034b50, 0); lfh.writeUInt16LE(20, 4); lfh.writeUInt16LE(0x0800, 6); lfh.writeUInt16LE(0, 8)
    lfh.writeUInt16LE(0, 10); lfh.writeUInt16LE(0x21, 12); lfh.writeUInt32LE(crc, 14); lfh.writeUInt32LE(size, 18)
    lfh.writeUInt32LE(size, 22); lfh.writeUInt16LE(nome.length, 26); lfh.writeUInt16LE(0, 28)
    chunks.push(lfh, nome, f.data)
    const cdh = Buffer.alloc(46)
    cdh.writeUInt32LE(0x02014b50, 0); cdh.writeUInt16LE(20, 4); cdh.writeUInt16LE(20, 6); cdh.writeUInt16LE(0x0800, 8)
    cdh.writeUInt16LE(0, 10); cdh.writeUInt16LE(0, 12); cdh.writeUInt16LE(0x21, 14); cdh.writeUInt32LE(crc, 16)
    cdh.writeUInt32LE(size, 20); cdh.writeUInt32LE(size, 24); cdh.writeUInt16LE(nome.length, 28); cdh.writeUInt16LE(0, 30)
    cdh.writeUInt16LE(0, 32); cdh.writeUInt16LE(0, 34); cdh.writeUInt16LE(0, 36); cdh.writeUInt32LE(0, 38); cdh.writeUInt32LE(offset, 42)
    central.push(Buffer.concat([cdh, nome]))
    offset += 30 + nome.length + size
  }
  const cd = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16); eocd.writeUInt16LE(0, 20)
  return Buffer.concat([...chunks, cd, eocd])
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const numero = soDig(searchParams.get('numero'))
  const jwt = searchParams.get('jwt') || (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  // seleção opcional: se vier ?uuids=a,b,c baixa só esses; senão, todos (íntegra)
  const uuidsSel = (searchParams.get('uuids') || '').split(',').map(s => s.trim()).filter(Boolean)
  const uuidSet = uuidsSel.length ? new Set(uuidsSel) : null
  // zip (padrão) | pdf (tudo num PDF só) | solto (um arquivo, com o nome original)
  const formato = (searchParams.get('formato') || 'zip').toLowerCase()
  if (numero.length < 16) return Response.json({ erro: 'número inválido' }, { status: 400 })
  const user = await usuario(jwt)
  if (!user) return Response.json({ erro: 'não autenticado' }, { status: 401 })

  const sb = jusbrAdmin()
  const sess = await getFreshToken(sb)
  if (sess.erro) return Response.json({ erro: 'jus.br: ' + sess.erro + ' — sincronize a sessão', motivo: sess.erro }, { status: 409 })
  const token = sess.token

  // lista as peças
  let data
  try {
    const r = await fetch(`${PDPJ}/api/v2/processos/${numero}`, { headers: { ...PDPJ_HEADERS, Authorization: 'Bearer ' + token, Accept: 'application/json' }, signal: AbortSignal.timeout(25000) })
    if (!r.ok) return Response.json({ erro: 'PDPJ recusou a lista (HTTP ' + r.status + ')' }, { status: 502 })
    data = await r.json().catch(() => null)
  } catch (e) { return Response.json({ erro: 'falha na lista: ' + String((e && e.message) || e) }, { status: 502 }) }
  const proc = Array.isArray(data && data.content) ? data.content[0] : (Array.isArray(data) ? data[0] : data)
  const docsRaw = (proc && (proc.documentos || (proc.tramitacaoAtual && proc.tramitacaoAtual.documentos))) || (data && data.documentos) || []
  const docs = (Array.isArray(docsRaw) ? docsRaw : [])
  if (!docs.length) return Response.json({ erro: 'nenhuma peça retornada pelo jus.br' }, { status: 404 })

  const files = []; let total = 0; let pulados = 0
  const usados = {}
  for (const d of docs) {
    if (total >= MAX_TOTAL) { pulados++; continue }
    const arq = d.arquivo || {}
    const hb = d.hrefBinario || arq.hrefBinario
    // filtro de seleção: pula o que não foi marcado
    if (uuidSet) { const du = ((String(hb || '').match(/documentos\/([^/]+)\//) || [])[1]) || ''; if (!uuidSet.has(du)) continue }
    const url = abs(hb)
    if (!url) { pulados++; continue }
    let rb
    try { rb = await fetch(url, { headers: { ...PDPJ_HEADERS, Accept: 'application/pdf,application/octet-stream,text/html;q=0.8,*/*;q=0.5', Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(40000) }) }
    catch (e) { pulados++; continue }
    if (!rb.ok) { pulados++; continue }
    const buf = Buffer.from(await rb.arrayBuffer())
    if (!buf.length) { pulados++; continue }
    const ct = String(rb.headers.get('content-type') || '').split(';')[0].toLowerCase()
    const head = buf.slice(0, 64).toString('utf8').toLowerCase().trim()
    if (/json/.test(ct) || head.startsWith('{') || ehShell(buf)) { pulados++; continue }
    const seq = String(d.sequencia != null ? d.sequencia : files.length + 1).padStart(3, '0')
    let base = limpaNome(d.nome || arq.nome || 'documento')
    if (!/\.[a-z0-9]{2,4}$/i.test(base)) base += head.startsWith('%pdf') ? '.pdf' : '.html'
    let name = seq + ' - ' + base
    if (usados[name]) { name = seq + '-' + (usados[name]++) + ' - ' + base } else usados[name] = 1
    const duuid = ((String(hb || '').match(/documentos\/([^/]+)\//) || [])[1]) || ''
    files.push({ name, data: buf, uuid: duuid, dt: String(d.dataHoraJuntada || d.data || '') })
    total += buf.length
  }
  if (!files.length) return Response.json({ erro: 'não foi possível baixar nenhuma peça' }, { status: 502 })

  // ordem final: a MESMA da tela. Quando o usuário manda a seleção, os uuids vêm
  // na ordem escolhida (crescente = autos na sequência); sem seleção, usa ?ordem.
  if (uuidsSel.length) {
    const pos = {}; uuidsSel.forEach((u, i) => { pos[u] = i })
    files.sort((a, b) => (pos[a.uuid] == null ? 9999 : pos[a.uuid]) - (pos[b.uuid] == null ? 9999 : pos[b.uuid]))
  } else if ((searchParams.get('ordem') || '').toLowerCase() === 'asc') {
    files.sort((a, b) => String(a.dt || '').localeCompare(String(b.dt || '')))
  } else if ((searchParams.get('ordem') || '').toLowerCase() === 'desc') {
    files.sort((a, b) => String(b.dt || '').localeCompare(String(a.dt || '')))
  }
  // renumera os prefixos (001, 002…) seguindo a ordem final
  files.forEach((f, i) => { f.name = String(i + 1).padStart(3, '0') + ' - ' + f.name.replace(/^\d{3}(-\d+)? - /, '') })

  // ——— formato SOLTO: devolve UM arquivo só, com o nome original ———
  if (formato === 'solto') {
    const f = files[0]
    const ehPdf = f.data.slice(0, 5).toString('utf8').toLowerCase().startsWith('%pdf')
    return new Response(f.data, {
      headers: {
        'Content-Type': ehPdf ? 'application/pdf' : (/\.html?$/i.test(f.name) ? 'text/html; charset=utf-8' : 'application/octet-stream'),
        'Content-Disposition': 'attachment; filename="' + f.name.replace(/"/g, '') + '"',
      },
    })
  }

  // ——— formato PDF ÚNICO: junta tudo num só PDF ———
  if (formato === 'pdf') {
    try {
      const { PDFDocument, StandardFonts } = await import('pdf-lib')
      const out = await PDFDocument.create()
      const fonte = await out.embedFont(StandardFonts.Helvetica)
      const negrito = await out.embedFont(StandardFonts.HelveticaBold)
      const lat1 = (s) => String(s == null ? '' : s)
        .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
        .replace(/[–—−]/g, '-').replace(/ /g, ' ')
        .replace(/[^\x00-\xFF]/g, '?')
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
          // HTML/texto: vira páginas de texto (mantém a peça no documento final)
          try {
            const txt = f.data.toString('utf8')
              .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ')
              .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, ' ')
              .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
              .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
            const linhas = []
            lat1(txt).split('\n').forEach((ln) => {
              while (ln.length > 96) { let c = ln.lastIndexOf(' ', 96); if (c < 40) c = 96; linhas.push(ln.slice(0, c)); ln = ln.slice(c).replace(/^ /, '') }
              linhas.push(ln)
            })
            let pg = out.addPage([595, 842]); let y = 800
            pg.drawText(lat1(f.name).slice(0, 90), { x: 45, y: y, size: 11, font: negrito }); y -= 22
            for (const ln of linhas) {
              if (y < 45) { pg = out.addPage([595, 842]); y = 800 }
              pg.drawText(ln, { x: 45, y: y, size: 9.5, font: fonte }); y -= 13
            }
            juntados++
          } catch (e) { falhos++ }
        }
      }
      if (!out.getPageCount()) return Response.json({ erro: 'não foi possível montar o PDF' }, { status: 502 })
      const bytes = Buffer.from(await out.save())
      return new Response(bytes, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="' + numero + '-autos.pdf"',
          'Content-Length': String(bytes.length),
          'X-CMP-Pecas': String(juntados) + '/' + String(files.length) + (falhos ? (' (' + falhos + ' falharam)') : ''),
        },
      })
    } catch (e) {
      return Response.json({ erro: 'PDF único indisponível: ' + String((e && e.message) || e) + ' — use o .zip' }, { status: 502 })
    }
  }

  // ——— formato ZIP (padrão) ———
  if (pulados) files.push({ name: '_AVISO.txt', data: Buffer.from('Íntegra parcial: ' + pulados + ' peça(s) não puderam ser incluídas (tamanho/limite/formato). Baixe-as individualmente pela ficha se necessário.', 'utf8') })
  const zbuf = zip(files)
  return new Response(zbuf, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="' + numero + '-autos.zip"',
      'Content-Length': String(zbuf.length),
    },
  })
}
