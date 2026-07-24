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
// Origin '*' de propósito: o userscript roda em mais de um domínio do jus.br
// (portaldeservicos e sso.cloud.pje) e o navegador só aceita UM valor aqui.
// Não há cookie/credencial nesta rota — a barreira real é o segredo de relay.
const CORS = {
  'Access-Control-Allow-Origin': '*',
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

// helper: resposta SEMPRE com CORS (o relay é cross-origin; erro sem CORS vira bloqueio opaco)
function j(body, status) { return Response.json(body, { status: status || 200, headers: CORS }) }

export async function POST(request) {
  try {
    // aceita 2 formas de autenticação:
    //  (a) JWT do Supabase (quando sincronizado de dentro do sistema); ou
    //  (b) segredo de relay (x-jusbr-relay) — usado pelo userscript no jus.br,
    //      que não tem a sessão do Supabase. O segredo fica em JUSBR_RELAY_SECRET.
    const relay = request.headers.get('x-jusbr-relay') || ''
    const relaySecret = process.env.JUSBR_RELAY_SECRET || ''
    let quem = null
    // segredo do banco (gerado pelo /api/jusbr/userscript) — dispensa configurar env
    let relayDB = ''
    if (relay && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      try {
        const sbA = admin()
        const { data } = await sbA.from('produtividade_config').select('valor').eq('escritorio_id', ESCRITORIO_CMP).eq('chave', 'jusbr_relay_secret').maybeSingle()
        relayDB = (data && data.valor) || ''
      } catch (e) {}
    }
    if (relay && ((relaySecret && relay === relaySecret) || (relayDB && relay === relayDB))) {
      quem = 'relay'
    } else {
      const user = await usuario(request)
      if (!user) return j({ erro: 'não autenticado (segredo de relay ausente/incorreto)' }, 401)
      quem = String(user.email || '')
    }
    let body
    try { body = await request.json() } catch (e) { return j({ erro: 'json inválido' }, 400) }
    const token = String(body.token || '').trim()
    if (token.split('.').length !== 3) return j({ erro: 'token inválido (esperado um JWT do PDPJ)' }, 400)
    // refresh_token + metadados OIDC (opcionais) — habilitam a renovação automática
    const refresh = String(body.refresh_token || body.refresh || '').trim() || null
    const clientId = String(body.client_id || '').trim()
    const tokenUrl = String(body.token_url || '').trim()
    let oidc = null
    if (clientId || tokenUrl) { oidc = {}; if (clientId) oidc.client_id = clientId; if (tokenUrl) oidc.token_url = tokenUrl }

    const encKey = process.env.JUSBR_ENC_KEY
    if (!encKey) return j({ erro: 'servidor sem JUSBR_ENC_KEY (defina no .env.local)' }, 500)
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return j({ erro: 'servidor sem SUPABASE_SERVICE_ROLE_KEY (defina no .env.local)' }, 500)

    const expira = expDoJwt(token)
    const sb = admin()
    const { error } = await sb.rpc('jusbr_set_sessao', { p_esc: ESCRITORIO_CMP, p_token: token, p_refresh: refresh, p_key: encKey, p_expira: expira, p_por: quem, p_oidc: oidc })
    if (error) return j({ erro: 'falha ao salvar token: ' + error.message }, 500)
    return j({ ok: true, expira, refresh: !!refresh })
  } catch (e) {
    return j({ erro: 'erro no servidor: ' + String((e && e.message) || e) }, 500)
  }
}

// GET: status da sessão (sem devolver o token)
export async function GET(request) {
  const user = await usuario(request)
  if (!user) return Response.json({ erro: 'não autenticado' }, { status: 401 })
  const sb = admin()
  const { data } = await sb.from('jusbr_sessao').select('expira,atualizado_em,atualizado_por,refresh_cif,refresh_em').eq('escritorio_id', ESCRITORIO_CMP).maybeSingle()
  const valido = !!(data && data.expira && new Date(data.expira).getTime() > Date.now())
  const autoRenova = !!(data && data.refresh_cif)
  return Response.json({ ok: true, valido, auto_renova: autoRenova, expira: data && data.expira || null, atualizado_em: data && data.atualizado_em || null, refresh_em: data && data.refresh_em || null })
}
