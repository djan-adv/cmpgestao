// Gera o userscript do Tampermonkey JÁ COM O SEGREDO embutido — assim o
// advogado só cola no Tampermonkey, sem configurar nada. O segredo (relay) é
// criado e guardado sozinho em produtividade_config (chave jusbr_relay_secret);
// o /api/jusbr/token aceita esse mesmo segredo. Requer login no sistema.

import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

const ESCRITORIO_CMP = '908f77fc-19f5-4d86-9576-f5590af09e0a'

async function usuario(request) {
  const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const u = await sb.auth.getUser(jwt)
  return (u && u.data && u.data.user) || null
}
function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }) }

// pega o segredo do banco; cria se ainda não existir
export async function garantirSegredo(sb) {
  const { data } = await sb.from('produtividade_config').select('valor').eq('escritorio_id', ESCRITORIO_CMP).eq('chave', 'jusbr_relay_secret').maybeSingle()
  if (data && data.valor) return data.valor
  const seg = 'rly_' + crypto.randomBytes(24).toString('hex')
  await sb.from('produtividade_config').upsert({ escritorio_id: ESCRITORIO_CMP, chave: 'jusbr_relay_secret', valor: seg }, { onConflict: 'escritorio_id,chave' })
  return seg
}

function scriptTexto(segredo, endpoint) {
  return `// ==UserScript==
// @name         CMPGestão — Sincronizar token jus.br (PDPJ)
// @namespace    cmpadvogados.com.br
// @version      2.1
// @description  Captura o Bearer e o refresh_token da sessão do PDPJ e envia ao CMPGestão (renovação automática). Segredo já embutido.
// @match        https://portaldeservicos.pdpj.jus.br/*
// @match        https://sso.cloud.pje.jus.br/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @connect      ${new URL(endpoint).host}
// ==/UserScript==
(function () {
  'use strict';
  var RELAY_SECRET = '${segredo}';
  var ENDPOINT = '${endpoint}';
  var ultimoEnvio = 0, ultimoToken = '', ultimoRefresh = '';
  function enviar(payload) {
    if (!payload || !payload.token || payload.token.split('.').length !== 3) return;
    var agora = Date.now();
    var ganhouRefresh = payload.refresh_token && payload.refresh_token !== ultimoRefresh;
    if (payload.token === ultimoToken && !ganhouRefresh && (agora - ultimoEnvio) < 5 * 60 * 1000) return;
    ultimoToken = payload.token; ultimoEnvio = agora;
    if (payload.refresh_token) ultimoRefresh = payload.refresh_token;
    try {
      GM_xmlhttpRequest({ method: 'POST', url: ENDPOINT, headers: { 'Content-Type': 'application/json', 'x-jusbr-relay': RELAY_SECRET }, data: JSON.stringify(payload), onload: function () {}, onerror: function () {} });
    } catch (e) {
      try { fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-jusbr-relay': RELAY_SECRET }, body: JSON.stringify(payload) }); } catch (e2) {}
    }
  }
  function ehEndpointToken(url) { return /\\/protocol\\/openid-connect\\/token(\\?|$)/i.test(String(url || '')); }
  function lerForm(body) {
    var out = {};
    try {
      var s = null;
      if (typeof body === 'string') s = body;
      else if (body instanceof URLSearchParams) s = body.toString();
      else if (body && typeof body.toString === 'function') s = body.toString();
      if (s && /=/.test(s)) { var p = new URLSearchParams(s); if (p.get('client_id')) out.client_id = p.get('client_id'); }
    } catch (e) {}
    return out;
  }
  function daRespostaToken(url, reqBody, jsonTxt) {
    try {
      var j = JSON.parse(jsonTxt);
      if (!j || !j.access_token) return;
      var pl = { token: j.access_token, token_url: String(url).split('?')[0] };
      if (j.refresh_token) pl.refresh_token = j.refresh_token;
      var f = lerForm(reqBody); if (f.client_id) pl.client_id = f.client_id;
      enviar(pl);
    } catch (e) {}
  }
  function pegarBearer(h) {
    try {
      if (!h) return null; var v = null;
      if (typeof h.get === 'function') v = h.get('Authorization') || h.get('authorization');
      else if (typeof h === 'object') v = h.Authorization || h.authorization;
      if (v && /^Bearer\\s+/i.test(v)) return v.replace(/^Bearer\\s+/i, '').trim();
    } catch (e) {}
    return null;
  }
  var of = window.fetch;
  window.fetch = function (input, init) {
    var url = (input && input.url) || input;
    try { var t = pegarBearer(init && init.headers) || pegarBearer(input && input.headers); if (t) enviar({ token: t }); } catch (e) {}
    var p = of.apply(this, arguments);
    try { if (ehEndpointToken(url)) { var reqBody = init && init.body; p.then(function (resp) { try { resp.clone().text().then(function (txt) { daRespostaToken(url, reqBody, txt); }); } catch (e) {} }); } } catch (e) {}
    return p;
  };
  var oOpen = XMLHttpRequest.prototype.open, oSend = XMLHttpRequest.prototype.send, oSet = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (m, u) { try { this.__cmpUrl = u; } catch (e) {} return oOpen.apply(this, arguments); };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) { try { if (/^authorization$/i.test(k) && /^Bearer\\s+/i.test(v)) enviar({ token: v.replace(/^Bearer\\s+/i, '').trim() }); } catch (e) {} return oSet.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function (body) {
    try { if (ehEndpointToken(this.__cmpUrl)) { var self = this, reqBody = body; this.addEventListener('load', function () { try { if (self.status >= 200 && self.status < 300) daRespostaToken(self.__cmpUrl, reqBody, self.responseText); } catch (e) {} }); } } catch (e) {}
    return oSend.apply(this, arguments);
  };
})();
`
}

export async function GET(request) {
  const user = await usuario(request)
  if (!user) return new Response('Faça login no sistema para gerar o userscript.', { status: 401 })
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return new Response('servidor sem service key', { status: 500 })
  const sb = admin()
  const segredo = await garantirSegredo(sb)
  const endpoint = new URL(request.url).origin + '/api/jusbr/token'
  return new Response(scriptTexto(segredo, endpoint), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
