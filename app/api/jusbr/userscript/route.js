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

// v3 — PROATIVO: além de interceptar a rede, varre o armazenamento a cada minuto,
// reenvia o token periodicamente e mostra um SELO na tela do jus.br com o estado
// da sincronização (para o advogado ver na hora se está funcionando).
function scriptTexto(segredo, endpoint) {
  return `// ==UserScript==
// @name         CMPGestão — Sincronizar token jus.br (PDPJ)
// @namespace    cmpadvogados.com.br
// @version      3.1
// @description  Mantém o CMPGestão sincronizado com a sua sessão do jus.br. Envia por fetch (CORS) e só usa GM como reserva. Mostra um selo na tela com o estado.
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

  var ultimoToken = '', ultimoEnvioMs = 0, ultimoOkMs = 0, ultimaOrigem = '', ultimoErro = '';
  var REENVIO_MS = 8 * 60 * 1000;   // reenvia o mesmo token no máximo a cada 8 min

  function ehJwt(t) { return typeof t === 'string' && t.split('.').length === 3 && t.length > 60; }

  function enviar(payload, origem) {
    if (!payload || !ehJwt(payload.token)) return;
    var agora = Date.now();
    var mudou = payload.token !== ultimoToken;
    if (!mudou && (agora - ultimoEnvioMs) < REENVIO_MS) return;
    ultimoToken = payload.token; ultimoEnvioMs = agora; ultimaOrigem = origem || '';
    function ok() { ultimoOkMs = Date.now(); ultimoErro = ''; selo(); }
    function falhou(e) { ultimoErro = String(e || 'falha'); selo(); }
    var corpo = JSON.stringify(payload);
    var cab = { 'Content-Type': 'application/json', 'x-jusbr-relay': RELAY_SECRET };
    // 1ª tentativa: fetch normal (o endpoint libera CORS) — não depende de
    // permissão do Tampermonkey, que é onde costuma travar.
    var viaFetch = null;
    try { viaFetch = of.call(window, ENDPOINT, { method: 'POST', headers: cab, body: corpo, mode: 'cors', credentials: 'omit' }); } catch (e) { viaFetch = null; }
    if (viaFetch && viaFetch.then) {
      viaFetch.then(function (r) {
        if (r && r.ok) { ok(); return; }
        if (r) { falhou('HTTP ' + r.status); return; }
        viaGM();
      }).catch(function () { viaGM(); });
    } else { viaGM(); }
    // 2ª tentativa: GM_xmlhttpRequest (ignora CORS, mas pede permissão)
    function viaGM() {
      try {
        GM_xmlhttpRequest({
          method: 'POST', url: ENDPOINT, headers: cab, data: corpo,
          onload: function (r) { if (r && r.status >= 200 && r.status < 300) ok(); else falhou('HTTP ' + (r && r.status)); },
          onerror: function () { falhou('bloqueado (permita o domínio no Tampermonkey)'); }
        });
      } catch (e) { falhou('sem permissão do Tampermonkey'); }
    }
  }

  // ---------- 1) interceptação de rede ----------
  function ehEndpointToken(url) { return /\\/protocol\\/openid-connect\\/token(\\?|$)/i.test(String(url || '')); }
  function clientIdDe(body) {
    try {
      var s = null;
      if (typeof body === 'string') s = body;
      else if (body instanceof URLSearchParams) s = body.toString();
      else if (body && typeof body.toString === 'function') s = body.toString();
      if (s && s.indexOf('=') > -1) { var p = new URLSearchParams(s); return p.get('client_id') || null; }
    } catch (e) {}
    return null;
  }
  function daRespostaToken(url, reqBody, txt) {
    try {
      var j = JSON.parse(txt);
      if (!j || !j.access_token) return;
      var pl = { token: j.access_token, token_url: String(url).split('?')[0] };
      if (j.refresh_token) pl.refresh_token = j.refresh_token;
      var cid = clientIdDe(reqBody); if (cid) pl.client_id = cid;
      enviar(pl, 'login/refresh');
    } catch (e) {}
  }
  function bearerDe(h) {
    try {
      if (!h) return null;
      var v = null;
      if (typeof h.get === 'function') v = h.get('Authorization') || h.get('authorization');
      else if (typeof h === 'object') v = h.Authorization || h.authorization;
      if (v && /^Bearer\\s+/i.test(v)) return v.replace(/^Bearer\\s+/i, '').trim();
    } catch (e) {}
    return null;
  }
  var of = window.fetch;
  window.fetch = function (input, init) {
    var url = (input && input.url) || input;
    try { var t = bearerDe(init && init.headers) || bearerDe(input && input.headers); if (t) enviar({ token: t }, 'rede'); } catch (e) {}
    var p = of.apply(this, arguments);
    try {
      if (ehEndpointToken(url)) {
        var rb = init && init.body;
        p.then(function (resp) { try { resp.clone().text().then(function (tx) { daRespostaToken(url, rb, tx); }); } catch (e) {} });
      }
    } catch (e) {}
    return p;
  };
  var oOpen = XMLHttpRequest.prototype.open, oSend = XMLHttpRequest.prototype.send, oSet = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (m, u) { try { this.__cmpUrl = u; } catch (e) {} return oOpen.apply(this, arguments); };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    try { if (/^authorization$/i.test(k) && /^Bearer\\s+/i.test(v)) enviar({ token: v.replace(/^Bearer\\s+/i, '').trim() }, 'rede'); } catch (e) {}
    return oSet.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    try {
      if (ehEndpointToken(this.__cmpUrl)) {
        var self = this, rb = body;
        this.addEventListener('load', function () { try { if (self.status >= 200 && self.status < 300) daRespostaToken(self.__cmpUrl, rb, self.responseText); } catch (e) {} });
      }
    } catch (e) {}
    return oSend.apply(this, arguments);
  };

  // ---------- 2) varredura profunda do armazenamento ----------
  function achaTokens(obj, saida, prof) {
    if (!obj || prof > 4) return;
    if (typeof obj === 'string') { if (ehJwt(obj) && !saida.token) saida.token = obj; return; }
    if (typeof obj !== 'object') return;
    for (var k in obj) {
      try {
        var v = obj[k];
        if (typeof v === 'string') {
          if (/access[_-]?token|^token$|id[_-]?token/i.test(k) && ehJwt(v)) saida.token = saida.token || v;
          else if (/refresh[_-]?token/i.test(k) && v.length > 20) saida.refresh_token = saida.refresh_token || v;
          else if (ehJwt(v) && !saida.token) saida.token = v;
        } else if (v && typeof v === 'object') achaTokens(v, saida, prof + 1);
      } catch (e) {}
    }
  }
  function varrerStorage() {
    var achado = {};
    try {
      [window.localStorage, window.sessionStorage].forEach(function (st) {
        if (!st || achado.token) return;
        for (var i = 0; i < st.length; i++) {
          try {
            var chave = st.key(i), val = st.getItem(chave);
            if (!val) continue;
            if (ehJwt(val) && /token/i.test(chave)) { achado.token = achado.token || val; continue; }
            if (val.indexOf('token') > -1 && (val.charAt(0) === '{' || val.charAt(0) === '[')) {
              var o = null; try { o = JSON.parse(val); } catch (e) {}
              if (o) achaTokens(o, achado, 0);
            }
          } catch (e) {}
        }
      });
    } catch (e) {}
    if (achado.token) { var pl = { token: achado.token }; if (achado.refresh_token) pl.refresh_token = achado.refresh_token; enviar(pl, 'armazenamento'); return true; }
    return false;
  }

  // ---------- 3) selo visível na tela do jus.br ----------
  var elSelo = null;
  function hhmm(ms) { if (!ms) return '—'; var d = new Date(ms); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
  function selo() {
    try {
      if (!document.body) return;
      if (!elSelo) {
        elSelo = document.createElement('div');
        elSelo.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:2147483647;background:#fff;border:1px solid #d7dde5;border-radius:10px;box-shadow:0 4px 14px rgba(0,0,0,.14);padding:8px 11px;font:12px system-ui,Arial;color:#1e2733;max-width:260px';
        elSelo.addEventListener('click', function (ev) { if (ev.target && ev.target.getAttribute('data-cmp') === 'sync') { varrerStorage(); selo(); } });
        document.body.appendChild(elSelo);
      }
      var estado, cor;
      if (ultimoErro) { estado = 'erro: ' + ultimoErro; cor = '#b5342b'; }
      else if (ultimoOkMs) { estado = 'sincronizado ' + hhmm(ultimoOkMs); cor = '#0F6E56'; }
      else { estado = 'aguardando token…'; cor = '#8a5a00'; }
      elSelo.innerHTML = '<div style="font-weight:700;color:#2E3A4B;margin-bottom:2px">CMPGestão</div>'
        + '<div style="color:' + cor + ';font-weight:600">' + estado + '</div>'
        + (ultimaOrigem ? '<div style="color:#697180;font-size:11px">via ' + ultimaOrigem + '</div>' : '')
        + '<div style="margin-top:5px"><button data-cmp="sync" style="cursor:pointer;border:1px solid #cfe0f2;background:#eef4fb;color:#185FA5;border-radius:7px;padding:3px 8px;font-size:11px">sincronizar agora</button></div>';
    } catch (e) {}
  }

  // ---------- 4) marcha: varre já, depois a cada minuto ----------
  function ciclo() { varrerStorage(); selo(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(ciclo, 2500); });
  else setTimeout(ciclo, 2500);
  setInterval(ciclo, 60000);
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
