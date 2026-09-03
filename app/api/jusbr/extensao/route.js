// Baixa a extensão do Chrome JÁ PAREADA com este escritório.
//   GET /api/jusbr/extensao   (Authorization: Bearer <jwt do Supabase>)  -> .zip
//
// Por que gerar aqui em vez de mandar a pasta crua: o que trava a instalação é
// a chave de pareamento. Vindo de dentro do sistema, ela já entra no pacote
// (padrao.js) e o colega só precisa arrastar a pasta para o chrome://extensions
// — nada para copiar, nada para digitar.
//
// O zip é montado à mão, sem dependência: método "store" (sem compressão). São
// sete arquivos de texto pequenos; comprimir não valeria uma biblioteca nova.

import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'
import { basePublica } from '../userscript/gerar.js'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0
export const maxDuration = 20

import { ESCRITORIO_PADRAO as ESCRITORIO_CMP } from '../../../../lib/escritorio.js'
const PASTA = path.join(process.cwd(), 'public', 'extensao-jusbr')
const ARQUIVOS = ['manifest.json', 'fundo.js', 'padrao.js', 'pagina.js', 'ponte.js', 'opcoes.html', 'opcoes.js', 'LEIA-ME.txt']

async function usuario(request) {
  const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const u = await sb.auth.getUser(jwt)
  return (u && u.data && u.data.user) || null
}
function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }) }

// mesma chave do userscript: quem já usa o Tampermonkey não precisa trocar nada
async function segredoDoEscritorio(sb) {
  const { data } = await sb.from('produtividade_config').select('valor')
    .eq('escritorio_id', ESCRITORIO_CMP).eq('chave', 'jusbr_relay_secret').maybeSingle()
  if (data && data.valor) return data.valor
  const novo = 'rly_' + crypto.randomBytes(24).toString('hex')
  await sb.from('produtividade_config').upsert(
    { escritorio_id: ESCRITORIO_CMP, chave: 'jusbr_relay_secret', valor: novo },
    { onConflict: 'escritorio_id,chave' })
  return novo
}

// ————— zip mínimo (store), suficiente para um punhado de arquivos de texto —————
const TAB_CRC = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c }
  return t
})()
function crc32(buf) {
  let c = 0 ^ -1
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ TAB_CRC[(c ^ buf[i]) & 0xff]
  return (c ^ -1) >>> 0
}
// data/hora no formato MS-DOS que o zip usa
function dosData(d) {
  const hora = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31)
  const data = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31)
  return { hora, data }
}
function zip(entradas) {
  const { hora, data } = dosData(new Date())
  const locais = [], centrais = []
  let desloc = 0
  for (const e of entradas) {
    const nome = Buffer.from(e.nome, 'utf8'), conteudo = Buffer.from(e.conteudo, 'utf8')
    const crc = crc32(conteudo)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(0, 8); local.writeUInt16LE(hora, 10); local.writeUInt16LE(data, 12)
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(conteudo.length, 18); local.writeUInt32LE(conteudo.length, 22)
    local.writeUInt16LE(nome.length, 26); local.writeUInt16LE(0, 28)
    locais.push(local, nome, conteudo)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(0, 10); central.writeUInt16LE(hora, 12); central.writeUInt16LE(data, 14)
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(conteudo.length, 20); central.writeUInt32LE(conteudo.length, 24)
    central.writeUInt16LE(nome.length, 28); central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36); central.writeUInt32LE(0, 38)
    central.writeUInt32LE(desloc, 42)
    centrais.push(central, nome)
    desloc += 30 + nome.length + conteudo.length
  }
  const corpo = Buffer.concat(locais)
  const dir = Buffer.concat(centrais)
  const fim = Buffer.alloc(22)
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(0, 4); fim.writeUInt16LE(0, 6)
  fim.writeUInt16LE(entradas.length, 8); fim.writeUInt16LE(entradas.length, 10)
  fim.writeUInt32LE(dir.length, 12); fim.writeUInt32LE(corpo.length, 16); fim.writeUInt16LE(0, 20)
  return Buffer.concat([corpo, dir, fim])
}

export async function GET(request) {
  const user = await usuario(request)
  if (!user) return new Response('Faça login no sistema para baixar a extensão.', { status: 401 })
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return new Response('servidor sem service key', { status: 500 })

  const segredo = await segredoDoEscritorio(admin())
  const endpoint = basePublica(request) + '/api/jusbr/token'

  const entradas = []
  for (const nome of ARQUIVOS) {
    let txt
    try { txt = fs.readFileSync(path.join(PASTA, nome), 'utf8') } catch (e) { continue }
    if (nome === 'padrao.js') {
      txt = txt.replace(
        /self\.CMP_PADRAO\s*=\s*\{[^}]*\};/,
        'self.CMP_PADRAO = { endpoint: ' + JSON.stringify(endpoint) + ', segredo: ' + JSON.stringify(segredo) + ' };')
    }
    if (nome === 'manifest.json') {
      // o endereço do escritório entra nas permissões: sem isto o Chrome pede
      // autorização na primeira vez, e quem instala não entende o pedido
      try {
        const m = JSON.parse(txt)
        const origem = new URL(endpoint).origin + '/*'
        if (!m.host_permissions.includes(origem)) m.host_permissions.push(origem)
        txt = JSON.stringify(m, null, 2)
      } catch (e) {}
    }
    entradas.push({ nome: 'cmpgestao-jusbr/' + nome, conteudo: txt })
  }
  if (!entradas.length) return new Response('arquivos da extensão não encontrados no servidor', { status: 500 })

  const buf = zip(entradas)
  return new Response(buf, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="cmpgestao-jusbr.zip"',
      'Cache-Control': 'no-store',
    },
  })
}
