// jus.br / PDPJ — sincronizar o Bearer da sessão do advogado.
//   POST /api/jusbr/token   (Authorization: Bearer <jwt do Supabase>)
//   body: { token: "<access token do PDPJ>" }
// Guarda 1 token por escritório. O token dura ~8h; ao expirar, sincroniza de novo.
// O token é credencial do próprio advogado, usada só para puxar os documentos dos
// processos dele. Fica em tabela com RLS (jusbr_sessao) — lido apenas pelo servidor.

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

const ESCRITORIO_CMP = '908f77fc-19f5-4d86-9576-f5590af09e0a'

async function usuario(request) {
  const auth = request.headers.get('authorization') || ''
  const jwt = auth.replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const u = await sb.auth.getUser(jwt)
  return (u && u.data && u.data.user) || null
}
function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}
// CORS para o relay do userscript (roda no domínio do jus.br). Só liberamos o
// necessário (POST + o header do segredo). O segredo continua sendo a barreira real.
const CORS = {
  'Access-Control-Allow-Origin': 'https://portaldeservicos.pdpj.jus.br',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-jusbr-relay',
  'Access-Control-Max-Age': '86400',
}
export async function OPTIONS() { return new Response(null, { status: 204, headers: CORS }) }

// lê o "exp" do JWT sem validar assinatura (só p/ saber quando expira)
function expDoJwt(t) {
  try {
    const p = JSON.parse(Buffer.from(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
    return p && p.exp ? new Date(p.exp * 1000).toISOString() : null
  } catch (e) { return null }
}

export async function POST(request) {
  // aceita 2 formas de autenticação:
  //  (a) JWT do Supabase (quando sincronizado de dentro do sistema); ou
  //  (b) segredo de relay (x-jusbr-relay) — usado pelo userscript no jus.br,
  //      que não tem a sessão do Supabase. O segredo fica em JUSBR_RELAY_SECRET.
  const relay = request.headers.get('x-jusbr-relay') || ''
  const relaySecret = process.env.JUSBR_RELAY_SECRET || ''
  let quem = null
  if (relaySecret && relay && relay === relaySecret) {
    quem = 'relay'
  } else {
    const user = await usuario(request)
    if (!user) return Response.json({ erro: 'não autenticado' }, { status: 401 })
    quem = String(user.email || '')
  }
  let body
  try { body = await request.json() } catch (e) { return Response.json({ erro: 'json inválido' }, { status: 400 }) }
  const token = String(body.token || '').trim()
  if (token.split('.').length !== 3) return Response.json({ erro: 'token inválido (esperado um JWT do PDPJ)' }, { status: 400, headers: CORS })
  const expira = expDoJwt(token)
  const sb = admin()
  const { error } = await sb.from('jusbr_sessao').upsert({
    escritorio_id: ESCRITORIO_CMP, token, expira,
    atualizado_por: quem, atualizado_em: new Date().toISOString(),
  }, { onConflict: 'escritorio_id' })
  if (error) return Response.json({ erro: 'falha ao salvar token: ' + error.message }, { status: 500, headers: CORS })
  return Response.json({ ok: true, expira }, { headers: CORS })
}

// GET: status da sessão (sem devolver o token)
export async function GET(request) {
  const user = await usuario(request)
  if (!user) return Response.json({ erro: 'não autenticado' }, { status: 401 })
  const sb = admin()
  const { data } = await sb.from('jusbr_sessao').select('expira,atualizado_em,atualizado_por').eq('escritorio_id', ESCRITORIO_CMP).maybeSingle()
  const valido = !!(data && data.expira && new Date(data.expira).getTime() > Date.now())
  return Response.json({ ok: true, valido, expira: data && data.expira || null, atualizado_em: data && data.atualizado_em || null })
}
