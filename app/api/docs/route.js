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
  if (!fs.existsSync(full)) return Response.json({ itens: [] })
  const itens = fs.readdirSync(full, { withFileTypes: true }).map(d => {
    const st = fs.statSync(path.join(full, d.name))
    return { nome: d.name, tipo: d.isDirectory() ? 'pasta' : 'arquivo', tam: d.isDirectory() ? null : st.size, mod: st.mtime }
  }).sort((a, b) => (a.tipo === b.tipo) ? a.nome.localeCompare(b.nome, 'pt') : (a.tipo === 'pasta' ? -1 : 1))
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
  fs.mkdirSync(path.dirname(full), { recursive: true })
  const buf = Buffer.from(b.b64 || '', 'base64')
  if (b.append) fs.appendFileSync(full, buf)
  else fs.writeFileSync(full, buf)
  return Response.json({ ok: true, bytes: buf.length, path: rel })
}
