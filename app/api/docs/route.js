// API do CMPGestão — documentos por processo, armazenados no VPS em /opt/cmpdocs.
// Todas as operações exigem usuário autenticado (JWT do Supabase no header).
//   GET  /api/docs?dir=<subpasta>           → lista pastas/arquivos
//   GET  /api/docs?file=<caminho>           → baixa um arquivo
//   POST /api/docs {path, b64, append}      → grava arquivo (em pedaços base64)

import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ROOT = '/opt/cmpdocs'
const TRASH = 'Lixeira'
const DIAS_LIXEIRA = 30

function metaPath(procDir) { return path.join(procDir, TRASH, '.meta.json') }
function lerMeta(procDir) { try { return JSON.parse(fs.readFileSync(metaPath(procDir), 'utf8')) } catch (e) { return {} } }
function gravarMeta(procDir, m) { fs.mkdirSync(path.join(procDir, TRASH), { recursive: true }); fs.writeFileSync(metaPath(procDir), JSON.stringify(m)) }
// apaga de vez o que está na Lixeira há mais de 30 dias
function purgarLixeira(procDir) {
  const tdir = path.join(procDir, TRASH)
  if (!fs.existsSync(tdir)) return
  const m = lerMeta(procDir); let mudou = false; const agora = Date.now()
  for (const [nome, info] of Object.entries(m)) {
    const t = new Date(info.quando).getTime()
    if (!fs.existsSync(path.join(tdir, nome))) { delete m[nome]; mudou = true; continue }
    if (agora - t > DIAS_LIXEIRA * 86400000) {
      try { fs.unlinkSync(path.join(tdir, nome)) } catch (e) {}
      delete m[nome]; mudou = true
    }
  }
  if (mudou) gravarMeta(procDir, m)
}

async function usuario(request) {
  const auth = request.headers.get('authorization') || ''
  const jwt = auth.replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const u = await sb.auth.getUser(jwt)
  return (u && u.data && u.data.user) || null
}

function seguro(rel) {
  const limpo = String(rel || '').replace(/\\/g, '/').replace(/\.\.+/g, '.').replace(/^\/+/, '')
  return limpo
}

export async function GET(request) {
  const user = await usuario(request)
  if (!user) return Response.json({ erro: 'não autenticado' }, { status: 401 })
  const { searchParams } = new URL(request.url)

  const file = searchParams.get('file')
  if (file) {
    const full = path.join(ROOT, seguro(file))
    if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory())
      return Response.json({ erro: 'arquivo não encontrado' }, { status: 404 })
    const buf = fs.readFileSync(full)
    return new Response(buf, { headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="' + encodeURIComponent(path.basename(full)) + '"',
    } })
  }

  const dir = seguro(searchParams.get('dir') || '')
  const full = path.join(ROOT, dir)
  if (!full.startsWith(ROOT)) return Response.json({ erro: 'caminho inválido' }, { status: 400 })
  const seg = dir.split('/')[0]
  if (seg) { try { purgarLixeira(path.join(ROOT, seg)) } catch (e) {} }
  if (!fs.existsSync(full)) return Response.json({ itens: [] })
  const naLixeira = path.basename(full) === TRASH
  const meta = naLixeira && seg ? lerMeta(path.join(ROOT, seg)) : null
  const itens = fs.readdirSync(full, { withFileTypes: true }).filter(d => d.name !== '.meta.json').map(d => {
    const st = fs.statSync(path.join(full, d.name))
    const it = { nome: d.name, tipo: d.isDirectory() ? 'pasta' : 'arquivo', tam: d.isDirectory() ? null : st.size, mod: st.mtime }
    if (meta && meta[d.name]) {
      const passados = Math.floor((Date.now() - new Date(meta[d.name].quando).getTime()) / 86400000)
      it.resta = Math.max(0, DIAS_LIXEIRA - passados)
    }
    return it
  }).sort((a, b) => {
    const ax = a.tipo === 'pasta' && a.nome === TRASH, bx = b.tipo === 'pasta' && b.nome === TRASH
    if (ax !== bx) return ax ? 1 : -1 // Lixeira sempre por último
    return (a.tipo === b.tipo) ? a.nome.localeCompare(b.nome, 'pt') : (a.tipo === 'pasta' ? -1 : 1)
  })
  return Response.json({ dir, itens })
}

export async function POST(request) {
  const user = await usuario(request)
  if (!user) return Response.json({ erro: 'não autenticado' }, { status: 401 })
  const b = await request.json()
  const rel = seguro(b.path)
  if (!rel) return Response.json({ erro: 'informe path' }, { status: 400 })
  const full = path.join(ROOT, rel)
  if (!full.startsWith(ROOT)) return Response.json({ erro: 'caminho inválido' }, { status: 400 })

  // mover para a Lixeira do processo (fica 30 dias, depois é apagado)
  if (b.op === 'trash') {
    if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) return Response.json({ erro: 'arquivo não encontrado' }, { status: 404 })
    const seg = rel.split('/')[0]
    const procDir = path.join(ROOT, seg)
    if (rel.split('/').includes(TRASH)) return Response.json({ erro: 'já está na Lixeira' }, { status: 400 })
    const tdir = path.join(procDir, TRASH); fs.mkdirSync(tdir, { recursive: true })
    let nome = path.basename(full)
    if (fs.existsSync(path.join(tdir, nome))) nome = Date.now() + '_' + nome
    fs.renameSync(full, path.join(tdir, nome))
    const m = lerMeta(procDir); m[nome] = { orig: rel, quando: new Date().toISOString() }; gravarMeta(procDir, m)
    return Response.json({ ok: true, lixeira: nome, dias: DIAS_LIXEIRA })
  }

  // restaurar da Lixeira para o local original
  if (b.op === 'restore') {
    if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) return Response.json({ erro: 'arquivo não encontrado' }, { status: 404 })
    const seg = rel.split('/')[0]
    const procDir = path.join(ROOT, seg)
    const nome = path.basename(rel)
    const m = lerMeta(procDir); const info = m[nome]
    const destRel = seguro((info && info.orig) || (seg + '/' + nome.replace(/^\d{13}_/, '')))
    let dest = path.join(ROOT, destRel)
    if (!dest.startsWith(ROOT)) return Response.json({ erro: 'caminho inválido' }, { status: 400 })
    if (fs.existsSync(dest)) dest = dest.replace(/(\.[^./]*)?$/, ' (restaurado)$1')
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.renameSync(full, dest)
    if (info) { delete m[nome]; gravarMeta(procDir, m) }
    return Response.json({ ok: true, restaurado: path.relative(ROOT, dest) })
  }

  fs.mkdirSync(path.dirname(full), { recursive: true })
  const buf = Buffer.from(b.b64 || '', 'base64')
  if (b.append) fs.appendFileSync(full, buf)
  else fs.writeFileSync(full, buf)
  if (b.mtime) { try { const t = new Date(b.mtime); if (!isNaN(t)) fs.utimesSync(full, t, t) } catch (e) {} }
  return Response.json({ ok: true, bytes: buf.length, path: rel })
}
