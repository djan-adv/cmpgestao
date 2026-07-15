// Utilitários da integração com o Banco Cora (Integração Direta via API, mTLS).
//
// Por que existe: os segredos do Cora (client_id, certificado e chave privada)
// NÃO podem ir para o navegador. Toda chamada ao Cora é feita aqui no servidor,
// lendo as credenciais de process.env (arquivo /opt/cmpgestao/.env.local no VPS).
//
// Variáveis esperadas no servidor:
//   CORA_CLIENT_ID     -> Client ID da Integração Direta
//   CORA_CERT_PATH     -> caminho do certificado .pem no VPS   (ou CORA_CERT com o conteúdo)
//   CORA_KEY_PATH      -> caminho da chave privada .key no VPS  (ou CORA_KEY com o conteúdo)
//   CORA_ENV           -> 'prod' (padrão) ou 'stage' (homologação)
//   CORA_WEBHOOK_SECRET-> segredo que protege a URL do webhook
// (Supabase já configurado: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.)

import https from 'https'
import fs from 'fs'
import { createClient } from '@supabase/supabase-js'

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY

const CORA_ENV = String(process.env.CORA_ENV || 'prod').toLowerCase()
const CORA_HOST = CORA_ENV === 'stage'
  ? 'matls-clients.api.stage.cora.com.br'
  : 'matls-clients.api.cora.com.br'

// lê a credencial do arquivo (path) ou direto do conteúdo no env
function lerCred(valor, path) {
  try { if (path && fs.existsSync(path)) return fs.readFileSync(path, 'utf8') } catch (e) {}
  return valor || ''
}
function coraCert() { return lerCred(process.env.CORA_CERT, process.env.CORA_CERT_PATH) }
function coraKey() { return lerCred(process.env.CORA_KEY, process.env.CORA_KEY_PATH) }

export function coraConfigurado() {
  return !!(process.env.CORA_CLIENT_ID && coraCert() && coraKey())
}

// requisição HTTPS ao Cora com certificado mútuo (mTLS)
function mtls(method, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null
    const req = https.request({
      host: CORA_HOST, port: 443, method, path,
      cert: coraCert(), key: coraKey(),
      headers: Object.assign({}, headers, data ? { 'Content-Length': Buffer.byteLength(data) } : {})
    }, (res) => {
      let buf = ''
      res.on('data', d => { buf += d })
      res.on('end', () => {
        let json = null
        try { json = buf ? JSON.parse(buf) : null } catch (e) {}
        resolve({ status: res.statusCode || 0, json, raw: buf })
      })
    })
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

// token OAuth (client_credentials) via mTLS — cacheado em memória enquanto válido
let _tok = { access: null, exp: 0 }
export async function coraToken() {
  if (_tok.access && Date.now() < _tok.exp - 30000) return _tok.access
  const form = 'grant_type=client_credentials&client_id=' + encodeURIComponent(process.env.CORA_CLIENT_ID || '')
  const r = await mtls('POST', '/token', { 'Content-Type': 'application/x-www-form-urlencoded' }, form)
  if (r.status !== 200 || !r.json || !r.json.access_token) {
    throw new Error('Falha ao autenticar no Cora (' + r.status + '): ' + String(r.raw || '').slice(0, 300))
  }
  _tok.access = r.json.access_token
  _tok.exp = Date.now() + ((r.json.expires_in || 3600) * 1000)
  return _tok.access
}

// chamada autenticada à API do Cora
export async function coraApi(method, path, body, extraHeaders) {
  const token = await coraToken()
  const headers = Object.assign(
    { 'Authorization': 'Bearer ' + token, 'Accept': 'application/json' },
    body ? { 'Content-Type': 'application/json' } : {},
    extraHeaders || {}
  )
  return mtls(method, path, headers, body)
}

// status do Cora que significam "pago" (OPEN|PAID|CANCELLED|LATE|DRAFT|IN_PAYMENT)
export function estaPago(status) {
  const s = String(status || '').toUpperCase()
  return s.includes('PAID') || s.includes('PAGA') || s.includes('PAGO') || s.includes('SETTLED') || s.includes('COMPENSAT')
}

// --- Supabase ---
// cliente do usuário: respeita a RLS (escritorio_id = meu_escritorio()) via JWT
export function sbUsuario(jwt) {
  return createClient(SB_URL, ANON, {
    global: { headers: { Authorization: 'Bearer ' + jwt } },
    auth: { persistSession: false, autoRefreshToken: false }
  })
}
// cliente admin (service role): só para o webhook, que chega sem JWT de usuário
export function sbAdmin() {
  return createClient(SB_URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })
}
// identifica o usuário autenticado a partir do header Authorization
export async function usuarioDoToken(request) {
  const auth = request.headers.get('authorization') || ''
  const jwt = auth.replace(/^Bearer\s+/i, '')
  if (!jwt) return { jwt: null, user: null }
  const sb = createClient(SB_URL, ANON)
  const u = await sb.auth.getUser(jwt)
  return { jwt, user: (u && u.data && u.data.user) || null }
}
