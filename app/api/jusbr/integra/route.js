// jus.br / PDPJ — baixa a ÍNTEGRA do processo (todas as peças) e devolve um ZIP
// direto para o navegador (pasta Downloads). NÃO grava nada no sistema.
//   GET /api/jusbr/integra?numero=<digitos>&jwt=<jwt do Supabase>
// O PDPJ não expõe um "download dos autos" único nesta API, então montamos o
// pacote puxando cada documento (mesma lógica do download por peça).
//
// O motor (baixar + ordenar + juntar em PDF) vive em ./core.js, compartilhado
// com o robô, que guarda a íntegra na pasta do processo.

import { createClient } from '@supabase/supabase-js'
import { zip } from '../../_lib/zip.js'
import { jusbrAdmin } from '../lib.js'
import { escritorioDoUsuario } from '../../_lib/inquilino.js'
import fs from 'fs'
import path from 'path'
import { coletarPecas, ordenarPecas, pdfUnico, salvarNaPasta } from './core.js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0
export const maxDuration = 60

const ROOT = '/opt/cmpdocs'
const soDig = (s) => String(s || '').replace(/\D/g, '')

async function usuario(jwt) {
  if (!jwt) return null
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    const u = await sb.auth.getUser(jwt)
    return (u && u.data && u.data.user) || null
  } catch (e) { return null }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const numero = soDig(searchParams.get('numero'))
  const jwt = searchParams.get('jwt') || (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  // seleção opcional: se vier ?uuids=a,b,c baixa só esses; senão, todos (íntegra)
  const uuidsSel = (searchParams.get('uuids') || '').split(',').map(s => s.trim()).filter(Boolean)
  // zip (padrão) | pdf (tudo num PDF só) | solto (um arquivo, com o nome original)
  const formato = (searchParams.get('formato') || 'zip').toLowerCase()
  if (numero.length < 16) return Response.json({ erro: 'número inválido' }, { status: 400 })
  const user = await usuario(jwt)
  if (!user) return Response.json({ erro: 'não autenticado' }, { status: 401 })

  const esc = await escritorioDoUsuario(user.id)
  if (!esc) return Response.json({ erro: 'usuário sem escritório vinculado' }, { status: 403 })
  const col = await coletarPecas(jusbrAdmin(), numero, { uuidsSel, esc })
  if (col.erro) return Response.json({ erro: col.erro, motivo: col.motivo }, { status: col.status || 502 })
  const { files, pulados } = col
  ordenarPecas(files, { uuidsSel, ordem: searchParams.get('ordem') || '' })

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
    let r
    try { r = await pdfUnico(files) }
    catch (e) { return Response.json({ erro: 'PDF único indisponível: ' + String((e && e.message) || e) + ' — use o .zip' }, { status: 502 }) }
    if (r.erro) return Response.json({ erro: r.erro }, { status: 502 })
    // ?salvar=1 → além de baixar, deixa uma cópia na pasta do processo, no topo
    // da lista. Substitui a cópia anterior do mesmo tipo (íntegra ou seleção).
    let salvo = null
    if (searchParams.get('salvar') != null) {
      const completa = !uuidsSel.length || uuidsSel.length >= (col.totalDocs || 0)
      salvo = salvarNaPasta(fs, path, ROOT, numero, r.bytes, completa)
    }
    const cab = {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="' + numero + '-autos.pdf"',
      'Content-Length': String(r.bytes.length),
      'X-CMP-Pecas': String(r.juntados) + '/' + String(r.total) + (r.falhos ? (' (' + r.falhos + ' falharam)') : ''),
    }
    if (salvo) cab['X-CMP-Salvo'] = encodeURIComponent(salvo)
    return new Response(r.bytes, { headers: cab })
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
