// jus.br / PDPJ — sessão com RENOVAÇÃO AUTOMÁTICA.
//
// O PDPJ autentica via gov.br/Keycloak. Junto com o access token (~8h) vem um
// refresh_token de vida bem mais longa. Se guardarmos o refresh + o client_id +
// o endpoint de token do provedor, o servidor renova o acesso sozinho — sem o
// advogado precisar relogar toda hora.
//
// Este módulo centraliza: ler a sessão, saber se está perto de expirar, e
// renovar via grant_type=refresh_token. As rotas consumidoras chamam
// getFreshToken(sb) e recebem SEMPRE um access token válido (renovado se preciso).

import { createClient } from '@supabase/supabase-js'

export const ESCRITORIO_CMP = '908f77fc-19f5-4d86-9576-f5590af09e0a'

// endpoint padrão de token do PDPJ (gov.br SSO). Pode ser sobrescrito pelo que o
// userscript capturar (campo oidc.token_url), caso o provedor mude.
const TOKEN_URL_PADRAO = 'https://sso.cloud.pje.jus.br/auth/realms/pje/protocol/openid-connect/token'
const CLIENT_ID_PADRAO = 'portalexterno-frontend'

// IMPORTANTE: cache: 'no-store' em todas as chamadas. O Next.js guarda respostas
// de fetch e chegou a servir uma leitura ANTIGA da sessão — o download acusava
// "expirado" enquanto o banco tinha token válido. Sessão é dado vivo: nunca cachear.
export function jusbrAdmin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    global: { fetch: (input, init) => fetch(input, { ...(init || {}), cache: 'no-store' }) },
  })
}

// claims do JWT (sem validar assinatura). Serve para saber DE ONDE veio o token:
// o navegador do advogado guarda vários JWTs (gov.br, outros clientes Keycloak) e
// só o do realm do PJe/PDPJ é aceito pela API do processo. Sem isto, um token de
// outro emissor entra no lugar do bom e todo download passa a dar 401.
export function claimsDoJwt(t) {
  try {
    const p = JSON.parse(Buffer.from(String(t).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
    return p && typeof p === 'object' ? p : null
  } catch (e) { return null }
}

// resumo não sensível dos claims — o que pode aparecer em diagnóstico/log
export function resumoClaims(t) {
  const c = claimsDoJwt(t)
  if (!c) return null
  const aud = Array.isArray(c.aud) ? c.aud.join(',') : (c.aud || null)
  return {
    iss: c.iss || null, aud, azp: c.azp || null, typ: c.typ || null,
    scope: c.scope || null,
    usuario: c.preferred_username || c.email || c.name || null,
    exp: c.exp ? new Date(c.exp * 1000).toISOString() : null,
  }
}

// O token bom vem do SSO do PJe/PDPJ. Qualquer outro emissor (gov.br puro, por
// exemplo) é recusado pela API v2 do portal com 401.
export function ehEmissorPdpj(t) {
  const c = claimsDoJwt(t)
  if (!c || !c.iss) return false
  return /(^|\/\/)([a-z0-9.-]*\.)?(pje|pdpj)\.jus\.br/i.test(String(c.iss))
}

// PROVA DE FOGO: o PDPJ aceita este token? Só isto distingue "token dentro da
// validade" de "token que serve". Devolve { aceito, http } — e { aceito:null }
// quando não deu para testar (sem processo, rede fora): nesse caso quem chama
// NÃO deve barrar nada, para não travar por causa de falha nossa.
export async function provarToken(sb, token) {
  try {
    // Testa num processo do qual JÁ baixamos peça — ou seja, comprovadamente
    // acessível com uma credencial boa. Testar num processo qualquer confundiria
    // "token ruim" com "processo que o advogado não acompanha".
    let numero = ''
    const { data: ja } = await sb.from('jusbr_arquivos').select('processo_numero').order('criado_em', { ascending: false }).limit(1)
    if (ja && ja[0]) numero = String(ja[0].processo_numero || '').replace(/\D/g, '')
    if (numero.length < 16) {
      const { data: pr } = await sb.from('processos').select('numero_digitos').not('numero_digitos', 'is', null).limit(1)
      numero = (pr && pr[0] && String(pr[0].numero_digitos || '').replace(/\D/g, '')) || ''
    }
    if (!numero || numero.length < 16) return { aceito: null, motivo: 'sem processo para testar' }
    const r = await fetch('https://portaldeservicos.pdpj.jus.br/api/v2/processos/' + numero, {
      headers: {
        Authorization: 'Bearer ' + token, Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        Origin: 'https://portaldeservicos.pdpj.jus.br',
        Referer: 'https://portaldeservicos.pdpj.jus.br/consulta/autosdigitais',
      },
      cache: 'no-store', signal: AbortSignal.timeout(15000),
    })
    // só 401 condena o token. 403/404 podem ser falta de acesso ÀQUELE processo —
    // barrar por isso derrubaria uma credencial boa.
    if (r.status === 401) return { aceito: false, http: 401, processo: numero, detalhe: String(await r.text().catch(() => '')).slice(0, 200) }
    return { aceito: true, http: r.status, processo: numero }
  } catch (e) { return { aceito: null, motivo: String((e && e.message) || e) } }
}

// exp do JWT (sem validar assinatura) → ISO
export function expDoJwt(t) {
  try {
    const p = JSON.parse(Buffer.from(String(t).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
    return p && p.exp ? new Date(p.exp * 1000).toISOString() : null
  } catch (e) { return null }
}

// lê a sessão decifrada
export async function lerSessao(sb) {
  const encKey = process.env.JUSBR_ENC_KEY
  if (!encKey) return { erro: 'sem_chave' }
  const { data, error } = await sb.rpc('jusbr_get_sessao', { p_esc: ESCRITORIO_CMP, p_key: encKey })
  if (error) return { erro: error.message }
  const row = Array.isArray(data) ? data[0] : data
  if (!row || !row.token) return { erro: 'sem_token' }
  return { token: row.token, refresh: row.refresh || null, oidc: row.oidc || null, expira: row.expira || null }
}

function expiraEmMs(expira) {
  if (!expira) return 0
  return new Date(expira).getTime() - Date.now()
}

// renova o access token usando o refresh_token guardado. Devolve o novo token
// ou { erro }. Atualiza o banco em caso de sucesso.
export async function renovar(sb, sess) {
  const encKey = process.env.JUSBR_ENC_KEY
  if (!encKey) return { erro: 'sem_chave' }
  if (!sess || !sess.refresh) return { erro: 'sem_refresh' }
  const oidc = sess.oidc || {}
  const tokenUrl = oidc.token_url || TOKEN_URL_PADRAO
  const clientId = oidc.client_id || CLIENT_ID_PADRAO
  const form = new URLSearchParams()
  form.set('grant_type', 'refresh_token')
  form.set('client_id', clientId)
  form.set('refresh_token', sess.refresh)
  if (oidc.client_secret) form.set('client_secret', oidc.client_secret)
  let r
  try {
    r = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form.toString(),
      signal: AbortSignal.timeout(20000),
    })
  } catch (e) { return { erro: 'rede: ' + String((e && e.message) || e) } }
  const txt = await r.text()
  let j = {}
  try { j = JSON.parse(txt) } catch (e) {}
  if (!r.ok || !j.access_token) {
    return { erro: 'refresh_falhou', status: r.status, detalhe: String(txt).slice(0, 300) }
  }
  const novoToken = j.access_token
  const novoRefresh = j.refresh_token || null
  const expira = expDoJwt(novoToken) || new Date(Date.now() + (parseInt(j.expires_in, 10) || 3600) * 1000).toISOString()
  await sb.rpc('jusbr_apos_refresh', { p_esc: ESCRITORIO_CMP, p_token: novoToken, p_refresh: novoRefresh, p_key: encKey, p_expira: expira })
  return { token: novoToken, expira }
}

// devolve SEMPRE um access token válido: renova sob demanda se estiver expirado
// ou faltando pouco (margem de 5 min). Se não der pra renovar, informa o motivo.
export async function getFreshToken(sb, margemMin) {
  const margem = (margemMin == null ? 5 : margemMin) * 60000
  const sess = await lerSessao(sb)
  if (sess.erro) return sess
  if (expiraEmMs(sess.expira) > margem) return { token: sess.token, expira: sess.expira }
  // perto de expirar / expirado → tenta renovar
  const nov = await renovar(sb, sess)
  if (nov.token) return nov
  // não renovou: se o token ainda não expirou de fato, entrega assim mesmo
  if (expiraEmMs(sess.expira) > 0) return { token: sess.token, expira: sess.expira, aviso: nov.erro }
  return { erro: 'expirado', detalhe: nov.erro || nov.detalhe || '' }
}
