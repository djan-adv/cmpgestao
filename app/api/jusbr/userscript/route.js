// Gera o userscript do Tampermonkey JÁ COM O SEGREDO embutido — o advogado só
// cola no Tampermonkey uma vez. A partir daí o próprio Tampermonkey se atualiza
// sozinho pela rota pública (@updateURL), sem novo copia-e-cola.

import { createClient } from '@supabase/supabase-js'
import { montarScript } from './gerar.js'
import { escritorioDoUsuario } from '../../_lib/inquilino.js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0
export const maxDuration = 15

async function usuario(request) {
  const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const u = await sb.auth.getUser(jwt)
  return (u && u.data && u.data.user) || null
}
function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }) }

export async function GET(request) {
  const user = await usuario(request)
  if (!user) return new Response('Faça login no sistema para gerar o userscript.', { status: 401 })
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return new Response('servidor sem service key', { status: 500 })
  // O segredo vai DENTRO do arquivo: gerar sempre o da raiz entregaria a chave
  // da sessão da casa a qualquer usuário logado do sistema.
  const esc = await escritorioDoUsuario(user.id)
  if (!esc) return new Response('Usuário sem escritório vinculado.', { status: 403 })
  const texto = await montarScript(admin(), request, esc)
  return new Response(texto, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
}
