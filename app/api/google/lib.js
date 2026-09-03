// Integração com o Google Calendar — sessão com RENOVAÇÃO AUTOMÁTICA, no mesmo
// espírito do jus.br/PDPJ (ver app/api/jusbr/lib.js): o Google entrega um access
// token (~1h) e, na primeira autorização (com access_type=offline&prompt=consent),
// um refresh_token de vida bem mais longa. Guardando o refresh cifrado, o servidor
// renova sozinho — o advogado autoriza uma vez só, em /api/google/auth.
//
// Onde fica guardado: tabela produtividade_config (mesma usada para o segredo do
// relay do jus.br), chave a chave, com o valor cifrado (AES-256-GCM) antes de
// gravar. GOOGLE_ENC_KEY é obrigatória — sem ela nada aqui funciona.

import crypto from 'crypto'

import { ESCRITORIO_PADRAO } from '../../../lib/escritorio.js'
export const ESCRITORIO_CMP = ESCRITORIO_PADRAO
export const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar'
export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
export const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3'

const CHAVE_ACCESS = 'google_access_token'
const CHAVE_REFRESH = 'google_refresh_token'
const CHAVE_EXPIRA = 'google_token_expira'

function chaveDerivada() {
  const seg = process.env.GOOGLE_ENC_KEY
  if (!seg) return null
  return crypto.createHash('sha256').update(String(seg)).digest() // 32 bytes, sempre — não importa o tamanho do segredo original
}

function cifrar(texto) {
  const key = chaveDerivada()
  if (!key) throw new Error('sem_chave')
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(String(texto), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64')
}
function decifrar(b64) {
  const key = chaveDerivada()
  if (!key) throw new Error('sem_chave')
  const buf = Buffer.from(b64, 'base64')
  const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), enc = buf.subarray(28)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
}

async function lerConfig(sb, chave) {
  const { data } = await sb.from('produtividade_config').select('valor').eq('escritorio_id', ESCRITORIO_CMP).eq('chave', chave).maybeSingle()
  return data ? data.valor : null
}
async function gravarConfig(sb, chave, valor) {
  await sb.from('produtividade_config').upsert({ escritorio_id: ESCRITORIO_CMP, chave, valor }, { onConflict: 'escritorio_id,chave' })
}

// redirect_uri sempre igual à cadastrada no Google Cloud Console — mesma base
// pública usada no resto do sistema (ver enviar-email/enviar.js:URL_PUBLICA)
export function redirectUri() {
  const base = (process.env.PUBLIC_URL || 'https://gestao.cmpadvogados.com.br').replace(/\/+$/, '')
  return base + '/api/google/callback'
}

// URL para o advogado clicar e autorizar (uma vez só). access_type=offline +
// prompt=consent GARANTE que o Google devolve refresh_token — sem os dois, ele
// só manda na primeiríssima autorização da conta com este app, nunca mais.
export function urlAutorizacao() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const params = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri(), response_type: 'code',
    scope: GOOGLE_SCOPE, access_type: 'offline', prompt: 'consent',
  })
  return GOOGLE_AUTH_URL + '?' + params.toString()
}

// troca o code (do callback) pelos tokens e já grava cifrado
export async function trocarCodePorTokens(sb, code) {
  const clientId = process.env.GOOGLE_CLIENT_ID, clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) return { erro: 'faltam GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET no servidor' }
  const form = new URLSearchParams({
    code, client_id: clientId, client_secret: clientSecret,
    redirect_uri: redirectUri(), grant_type: 'authorization_code',
  })
  let r, j
  try {
    r = await fetch(GOOGLE_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() })
    j = await r.json()
  } catch (e) { return { erro: 'falha ao falar com o Google: ' + ((e && e.message) || e) } }
  if (!r.ok || !j.access_token) return { erro: 'Google recusou: ' + (j.error_description || j.error || ('HTTP ' + r.status)) }
  if (!j.refresh_token) return { erro: 'o Google não devolveu refresh_token — revogue o acesso do app em myaccount.google.com/permissions e autorize de novo (o consentimento precisa ser "novo" para vir com o refresh).' }
  const expira = new Date(Date.now() + (parseInt(j.expires_in, 10) || 3600) * 1000).toISOString()
  await gravarConfig(sb, CHAVE_ACCESS, cifrar(j.access_token))
  await gravarConfig(sb, CHAVE_REFRESH, cifrar(j.refresh_token))
  await gravarConfig(sb, CHAVE_EXPIRA, expira)
  return { ok: true, expira }
}

async function renovar(sb) {
  const clientId = process.env.GOOGLE_CLIENT_ID, clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) return { erro: 'faltam GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET no servidor' }
  const refreshCif = await lerConfig(sb, CHAVE_REFRESH)
  if (!refreshCif) return { erro: 'sem_refresh' }
  let refresh
  try { refresh = decifrar(refreshCif) } catch (e) { return { erro: 'falha ao decifrar o refresh_token: ' + e.message } }
  const form = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refresh, grant_type: 'refresh_token' })
  let r, j
  try {
    r = await fetch(GOOGLE_TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() })
    j = await r.json()
  } catch (e) { return { erro: 'falha ao falar com o Google: ' + ((e && e.message) || e) } }
  if (!r.ok || !j.access_token) return { erro: 'Google recusou a renovação: ' + (j.error_description || j.error || ('HTTP ' + r.status)) }
  const expira = new Date(Date.now() + (parseInt(j.expires_in, 10) || 3600) * 1000).toISOString()
  await gravarConfig(sb, CHAVE_ACCESS, cifrar(j.access_token))
  await gravarConfig(sb, CHAVE_EXPIRA, expira)
  // o Google às vezes manda um refresh_token novo também — se mandou, troca
  if (j.refresh_token) await gravarConfig(sb, CHAVE_REFRESH, cifrar(j.refresh_token))
  return { token: j.access_token, expira }
}

// devolve SEMPRE um access token válido: renova sob demanda se estiver
// expirado ou faltando pouco (margem de 5 min).
export async function getFreshGoogleToken(sb) {
  if (!process.env.GOOGLE_ENC_KEY) return { erro: 'servidor sem GOOGLE_ENC_KEY (defina no .env)' }
  const expira = await lerConfig(sb, CHAVE_EXPIRA)
  if (!expira) return { erro: 'sem_autorizacao', detalhe: 'Google Calendar ainda não foi autorizado — abra /api/google/auth logado no sistema.' }
  const margem = 5 * 60000
  if (new Date(expira).getTime() - Date.now() > margem) {
    const accessCif = await lerConfig(sb, CHAVE_ACCESS)
    try { return { token: decifrar(accessCif), expira } } catch (e) { /* cai pra renovar */ }
  }
  const nov = await renovar(sb)
  if (nov.token) return nov
  return { erro: nov.erro || 'falha ao renovar o token do Google' }
}

export async function estaAutorizado(sb) {
  if (!process.env.GOOGLE_ENC_KEY) return false
  const expira = await lerConfig(sb, CHAVE_EXPIRA)
  return !!expira
}

// Quem VAI para o Google Calendar. A tabela agenda_eventos guarda tudo que tem
// data — audiência, reunião, prazo fatal, tarefa do escritório, lembrete — e
// mandar tudo entope o calendário pessoal com dezenas de "verificar processo".
// Só sobem COMPROMISSOS COM HORA MARCADA E TERCEIROS: audiência, perícia,
// sessão de julgamento e reunião.
//
// Critério, por origem:
//   auto-sistema → audiência lida do andamento do processo: sempre sobe
//   crm_lead     → reunião marcada com lead: sempre sobe
//   google       → NUNCA: veio de lá, devolver criaria evento duplicado
//   protocolo    → prazo de protocolo, é tarefa: não sobe
//   sistema      → só se o TÍTULO COMEÇAR com audiência/reunião/perícia/sessão.
//                  O "começar" é o que separa "Audiência inicial" (o compromisso)
//                  de "lembrar cliente da audiência" (tarefa sobre ele).
const RE_COMPROMISSO = /^\s*(audi[êe]ncia|reuni[ãa]o|per[íi]cia|sess[ãa]o\s+de\s+julgamento)\b/i
export function ehCompromissoAgenda(ev) {
  const origem = String((ev && ev.origem) || '')
  if (origem === 'google') return false
  if (origem === 'auto-sistema' || origem === 'crm_lead') return true
  if (origem === 'protocolo') return false
  return RE_COMPROMISSO.test(String((ev && ev.titulo) || ''))
}

// ————— API do Calendar —————
function headersGoogle(token) { return { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } }

// monta {dateTime, timeZone} a partir de data (AAAA-MM-DD) + hora (HH:MM ou
// "Dia todo"/vazio). Sem hora definida, vira evento de dia inteiro (date, sem
// horário) — Google não aceita dateTime sem hora.
function partesData(data, hora, duracaoMin) {
  const tz = 'America/Fortaleza'
  const temHora = hora && hora !== 'Dia todo' && /^\d{1,2}:\d{2}/.test(hora)
  if (!temHora) return { inicio: { date: data }, fim: { date: data } }
  const [h, m] = hora.split(':').map(Number)
  const ini = new Date(data + 'T' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':00-03:00')
  const fim = new Date(ini.getTime() + (duracaoMin || 60) * 60000)
  return {
    inicio: { dateTime: ini.toISOString(), timeZone: tz },
    fim: { dateTime: fim.toISOString(), timeZone: tz },
  }
}

// cria (ou, se googleEventId vier preenchido, atualiza) um evento no calendário
// principal da conta autorizada. `comMeet` pede ao Google pra gerar o link de
// videoconferência sozinho (conferenceDataVersion=1) — só funciona em CRIAÇÃO;
// eventos já existentes mantêm o Meet que já tinham.
export async function sincronizarEvento(token, { googleEventId, titulo, data, hora, duracaoMin, descricao, local, comMeet }) {
  const { inicio, fim } = partesData(data, hora, duracaoMin)
  const body = { summary: titulo, description: descricao || '', start: inicio, end: fim }
  if (local) body.location = local
  const criando = !googleEventId
  if (criando && comMeet) {
    body.conferenceData = { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } }
  }
  const url = GOOGLE_CALENDAR_API + '/calendars/primary/events' + (criando ? '' : ('/' + encodeURIComponent(googleEventId)))
    + (comMeet && criando ? '?conferenceDataVersion=1' : '')
  let r, j
  try {
    r = await fetch(url, { method: criando ? 'POST' : 'PATCH', headers: headersGoogle(token), body: JSON.stringify(body), signal: AbortSignal.timeout(20000) })
    j = await r.json().catch(() => ({}))
  } catch (e) { return { erro: 'falha ao falar com o Google Calendar: ' + ((e && e.message) || e) } }
  if (r.status === 404 && !criando) {
    // evento apagado no Google por fora — recria do zero
    return sincronizarEvento(token, { titulo, data, hora, duracaoMin, descricao, local, comMeet })
  }
  if (!r.ok) return { erro: 'Google Calendar recusou (HTTP ' + r.status + '): ' + (j.error && j.error.message ? j.error.message : JSON.stringify(j).slice(0, 200)) }
  const meetLink = (j.conferenceData && j.conferenceData.entryPoints || []).find(e => e.entryPointType === 'video')
  return { ok: true, id: j.id, htmlLink: j.htmlLink, meetLink: meetLink ? meetLink.uri : null }
}

export async function apagarEventoGoogle(token, googleEventId) {
  if (!googleEventId) return { ok: true }
  try {
    const r = await fetch(GOOGLE_CALENDAR_API + '/calendars/primary/events/' + encodeURIComponent(googleEventId), {
      method: 'DELETE', headers: headersGoogle(token), signal: AbortSignal.timeout(15000),
    })
    if (r.ok || r.status === 404 || r.status === 410) return { ok: true }
    const j = await r.json().catch(() => ({}))
    return { erro: 'HTTP ' + r.status + ': ' + (j.error && j.error.message ? j.error.message : '') }
  } catch (e) { return { erro: (e && e.message) || String(e) } }
}
