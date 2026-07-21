// API do CMPGestão — documentos por processo, armazenados no VPS em /opt/cmpdocs.
// Todas as operações exigem usuário autenticado (JWT do Supabase no header).
//   GET  /api/docs?dir=<subpasta>           → lista pastas/arquivos
//   GET  /api/docs?file=<caminho>           → baixa um arquivo
//   POST /api/docs {path, b64, append}      → grava arquivo (em pedaços base64)

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ROOT = '/opt/cmpdocs'
const TRASH = 'Lixeira'
const ORDEM = '.ordem.json'
const DIAS_LIXEIRA = 30
const ESCRITORIO_CMP = '908f77fc-19f5-4d86-9576-f5590af09e0a'

// cliente com service role — só para copiar um documento para o histórico (Storage + tabela anexos)
function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}

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
      try { fs.rmSync(path.join(tdir, nome), { recursive: true, force: true }) } catch (e) {}
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

// conta os arquivos de um processo (recursivo), ignorando a Lixeira e metadados
function contaArquivos(dir, prof) {
  if (prof > 6) return 0
  let n = 0
  let itens
  try { itens = fs.readdirSync(dir, { withFileTypes: true }) } catch (e) { return 0 }
  for (const d of itens) {
    if (d.name === TRASH || d.name === '.meta.json' || d.name === ORDEM) continue
    if (d.isDirectory()) n += contaArquivos(path.join(dir, d.name), prof + 1)
    else n++
  }
  return n
}

// soma { arquivos, bytes } de um processo (recursivo) — para o selo de pasta/MB na lista
function censoProc(dir, prof) {
  if (prof > 6) return { n: 0, bytes: 0 }
  let n = 0, bytes = 0
  let itens
  try { itens = fs.readdirSync(dir, { withFileTypes: true }) } catch (e) { return { n: 0, bytes: 0 } }
  for (const d of itens) {
    if (d.name === TRASH || d.name === '.meta.json' || d.name === ORDEM) continue
    const full = path.join(dir, d.name)
    if (d.isDirectory()) { const r = censoProc(full, prof + 1); n += r.n; bytes += r.bytes }
    else { n++; try { bytes += fs.statSync(full).size } catch (e) {} }
  }
  return { n, bytes }
}

export async function GET(request) {
  const user = await usuario(request)
  if (!user) return Response.json({ erro: 'não autenticado' }, { status: 401 })
  const { searchParams } = new URL(request.url)

  // censo: ?censo=<digitos,digitos,...> -> { counts: { digitos: qtdArquivos } }
  // (usado para apontar processos SEM documentos no servidor)
  const censo = searchParams.get('censo')
  if (censo) {
    const nums = [...new Set(String(censo).split(',').map(s => s.replace(/\D/g, '')).filter(s => s.length >= 16))].slice(0, 500)
    const counts = {}, bytes = {}
    for (const dig of nums) { const r = censoProc(path.join(ROOT, dig), 0); counts[dig] = r.n; bytes[dig] = r.bytes }
    return Response.json({ counts, bytes })
  }

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
  // ordem manual salva pelo usuário (arrastar p/ cima/baixo) — nome -> posição
  let ordem = {}
  try { const arr = JSON.parse(fs.readFileSync(path.join(full, ORDEM), 'utf8')); if (Array.isArray(arr)) arr.forEach((n, i) => { ordem[n] = i }) } catch (e) {}
  const itens = fs.readdirSync(full, { withFileTypes: true }).filter(d => d.name !== '.meta.json' && d.name !== ORDEM).map(d => {
    const st = fs.statSync(path.join(full, d.name))
    const it = { nome: d.name, tipo: d.isDirectory() ? 'pasta' : 'arquivo', tam: d.isDirectory() ? null : st.size, mod: st.mtime }
    if (Object.prototype.hasOwnProperty.call(ordem, d.name)) it.ordem = ordem[d.name]
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
    if (!fs.existsSync(full)) return Response.json({ erro: 'item não encontrado' }, { status: 404 })
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
    if (!fs.existsSync(full)) return Response.json({ erro: 'item não encontrado' }, { status: 404 })
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

  // renomear arquivo/pasta (mesmo diretório)
  if (b.op === 'rename') {
    if (!fs.existsSync(full)) return Response.json({ erro: 'item não encontrado' }, { status: 404 })
    if (rel.split('/').includes(TRASH)) return Response.json({ erro: 'não é possível renomear na Lixeira' }, { status: 400 })
    const base = String(b.nome || '').replace(/[\/\\]/g, '').replace(/\.\.+/g, '.').trim()
    if (!base) return Response.json({ erro: 'informe o novo nome' }, { status: 400 })
    const novoRel = seguro(path.dirname(rel) + '/' + base)
    const dest = path.join(ROOT, novoRel)
    if (!dest.startsWith(ROOT)) return Response.json({ erro: 'caminho inválido' }, { status: 400 })
    if (fs.existsSync(dest)) return Response.json({ erro: 'já existe um item com esse nome' }, { status: 409 })
    fs.renameSync(full, dest)
    return Response.json({ ok: true, path: novoRel })
  }

  // mover arquivo/pasta para outra pasta (dentro do mesmo processo)
  if (b.op === 'move') {
    if (!fs.existsSync(full)) return Response.json({ erro: 'item não encontrado' }, { status: 404 })
    if (rel.split('/').includes(TRASH)) return Response.json({ erro: 'não é possível mover da Lixeira' }, { status: 400 })
    const destDirRel = seguro(String(b.dest || ''))
    const destDir = path.join(ROOT, destDirRel)
    if (!destDir.startsWith(ROOT)) return Response.json({ erro: 'destino inválido' }, { status: 400 })
    // não mover uma pasta para dentro dela mesma
    if ((destDir + path.sep).startsWith(full + path.sep)) return Response.json({ erro: 'não é possível mover para dentro da própria pasta' }, { status: 400 })
    const dest = path.join(destDir, path.basename(full))
    if (dest === full) return Response.json({ ok: true, path: rel })
    if (fs.existsSync(dest)) return Response.json({ erro: 'já existe um item com esse nome no destino' }, { status: 409 })
    fs.mkdirSync(destDir, { recursive: true })
    fs.renameSync(full, dest)
    return Response.json({ ok: true, path: path.relative(ROOT, dest) })
  }

  // salvar a ordem manual dos itens de uma pasta (arrastar p/ cima/baixo)
  if (b.op === 'order') {
    // aqui `rel` é o diretório cuja ordem estamos salvando
    if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) return Response.json({ erro: 'pasta não encontrada' }, { status: 404 })
    if (rel.split('/').includes(TRASH)) return Response.json({ erro: 'não é possível ordenar a Lixeira' }, { status: 400 })
    const nomes = Array.isArray(b.ordem) ? b.ordem.map(n => String(n).replace(/[\/\\]/g, '')).filter(Boolean) : []
    try { fs.writeFileSync(path.join(full, ORDEM), JSON.stringify(nomes)) } catch (e) { return Response.json({ erro: 'falha ao salvar a ordem' }, { status: 500 }) }
    return Response.json({ ok: true })
  }

  // copiar um documento do processo para o histórico (Storage 'capturas' + tabela anexos)
  if (b.op === 'tohist') {
    if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) return Response.json({ erro: 'arquivo não encontrado' }, { status: 404 })
    const andamentoId = b.andamento_id
    const procNum = String(b.processo_numero || '')
    if (!andamentoId || !procNum) return Response.json({ erro: 'informe andamento_id e processo_numero' }, { status: 400 })
    const nome = path.basename(full)
    const ext = (nome.match(/\.[^.]+$/) || [''])[0].toLowerCase()
    const tipo = ext === '.pdf' ? 'application/pdf'
      : ext === '.doc' ? 'application/msword'
      : ext === '.docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : /\.(png|jpe?g|gif|webp)$/.test(ext) ? ('image/' + ext.replace('.', '').replace('jpg', 'jpeg'))
      : 'application/octet-stream'
    let buf
    try { buf = fs.readFileSync(full) } catch (e) { return Response.json({ erro: 'falha ao ler o arquivo' }, { status: 500 }) }
    const sb = admin()
    const key = ESCRITORIO_CMP + '/' + procNum.replace(/\D/g, '') + '/' + crypto.randomUUID() + '_' + nome.replace(/[^\w.\-]+/g, '_')
    const up = await sb.storage.from('capturas').upload(key, buf, { contentType: tipo, upsert: false })
    if (up.error) return Response.json({ erro: 'falha ao enviar ao histórico: ' + up.error.message }, { status: 502 })
    const insA = await sb.from('anexos').insert({
      escritorio_id: ESCRITORIO_CMP, processo_numero: procNum, andamento_id: andamentoId,
      origem: 'documento', nome, tipo, tamanho: buf.length, path: key, criado_por: (user && user.email) || null,
    }).select('id').single()
    if (insA.error) return Response.json({ erro: 'falha ao registrar o anexo: ' + insA.error.message }, { status: 502 })
    return Response.json({ ok: true, anexo_id: insA.data && insA.data.id, nome })
  }

  // criar pasta vazia ({ path, mkdir:true }). Se já existir um arquivo vazio com esse
  // nome (bug anterior, quando mkdir não era tratado), remove-o e cria a pasta.
  if (b.mkdir) {
    if (fs.existsSync(full)) {
      const st = fs.statSync(full)
      if (st.isDirectory()) return Response.json({ ok: true, path: rel })
      if (st.isFile() && st.size === 0) { try { fs.rmSync(full) } catch (e) {} }
      else return Response.json({ erro: 'já existe um arquivo com esse nome' }, { status: 409 })
    }
    fs.mkdirSync(full, { recursive: true })
    return Response.json({ ok: true, path: rel })
  }

  fs.mkdirSync(path.dirname(full), { recursive: true })
  const buf = Buffer.from(b.b64 || '', 'base64')
  if (b.append) fs.appendFileSync(full, buf)
  else fs.writeFileSync(full, buf)
  if (b.mtime) { try { const t = new Date(b.mtime); if (!isNaN(t)) fs.utimesSync(full, t, t) } catch (e) {} }
  return Response.json({ ok: true, bytes: buf.length, path: rel })
}
