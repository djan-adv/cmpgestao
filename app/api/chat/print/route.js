// Upload de "print" (captura de tela) pro chat interno da equipe.
//
// A imagem NÃO entra na tabela chat_mensagens (ficaria pesada e bagunçaria o
// histórico) — sobe pro Storage 'capturas' (mesmo bucket já usado pelos
// anexos de histórico/lead) e vira uma linha em `anexos`. O cliente grava a
// mensagem do chat com um texto curto ("📷 print enviado") + o id do anexo
// devolvido aqui, e mostra a imagem via /api/anexo (rota já existente).
//
//   POST /api/chat/print   (Authorization: Bearer <jwt>)
//   body: { nome, tipo, b64 }   -> { ok:true, id }

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const MAX_BYTES = 8 * 1024 * 1024

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}

export async function POST(request) {
  const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return Response.json({ erro: 'não autenticado' }, { status: 401 })
  const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const u = await auth.auth.getUser(jwt)
  const user = u && u.data && u.data.user
  if (!user) return Response.json({ erro: 'não autenticado' }, { status: 401 })

  let body
  try { body = await request.json() } catch (e) { return Response.json({ erro: 'json inválido' }, { status: 400 }) }
  const tipo = String(body.tipo || '')
  if (!/^image\//.test(tipo)) return Response.json({ erro: 'só imagens são aceitas' }, { status: 400 })
  const b64 = String(body.b64 || '')
  if (!b64) return Response.json({ erro: 'arquivo vazio' }, { status: 400 })
  let buf
  try { buf = Buffer.from(b64, 'base64') } catch (e) { return Response.json({ erro: 'base64 inválido' }, { status: 400 }) }
  if (!buf.length) return Response.json({ erro: 'arquivo vazio' }, { status: 400 })
  if (buf.length > MAX_BYTES) return Response.json({ erro: 'imagem maior que 8 MB' }, { status: 400 })

  const sb = admin()
  const perfil = await sb.from('usuarios').select('escritorio_id,nome').eq('id', user.id).single()
  if (perfil.error || !perfil.data) return Response.json({ erro: 'usuário não encontrado' }, { status: 403 })

  const ext = (tipo.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'png'
  const path = 'chat/' + perfil.data.escritorio_id + '/' + crypto.randomUUID() + '.' + ext
  const up = await sb.storage.from('capturas').upload(path, buf, { contentType: tipo, upsert: false })
  if (up.error) return Response.json({ erro: 'falha ao enviar: ' + up.error.message }, { status: 500 })

  const ins = await sb.from('anexos').insert({
    escritorio_id: perfil.data.escritorio_id,
    origem: 'chat',
    nome: String(body.nome || 'print.png').slice(0, 180),
    tipo, tamanho: buf.length, path,
    criado_por: perfil.data.nome || user.email || null,
  }).select('id').single()
  if (ins.error) {
    try { await sb.storage.from('capturas').remove([path]) } catch (e) {}
    return Response.json({ erro: 'falha ao gravar: ' + ins.error.message }, { status: 500 })
  }

  return Response.json({ ok: true, id: ins.data.id })
}
