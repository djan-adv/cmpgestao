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
  const host = new URL(endpoint).host
  return `// ==UserScript==
// @name         CMPGestão — Sincronizar token jus.br (PDPJ)
// @namespace    cmpadvogados.com.br
// @version      5.0
// @description  Ponte entre a sua sessão do jus.br e o CMPGestão. A aba do jus.br guarda o token no cofre do Tampermonkey; a aba do CMPGestão o envia (mesma origem, sem bloqueios). Selo na tela mostra o estado.
// @match        https://portaldeservicos.pdpj.jus.br/*
// @match        https://sso.cloud.pje.jus.br/*
// @match        https://${host}/*
// @run-at       document-start
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @connect      ${host}
// ==/UserScript==
(function () {
  'use strict';
  var RELAY_SECRET = '${segredo}';
  var ENDPOINT = '${endpoint}';
  var HOST_GESTAO = '${host}';
  var NO_GESTAO = (location.host === HOST_GESTAO);
  var CHAVE = 'cmp_jusbr_token';

  var estado = '', cor = '#8a5a00', origem = '', quandoOk = 0;
  function ehJwt(t) { return typeof t === 'string' && t.split('.').length === 3 && t.length > 60; }
  // validade (exp) do JWT em ms — o navegador guarda tokens VELHOS, e mandá-los
  // por cima do bom derruba a sessão do escritório. Só enviamos os válidos.
  function expDe(t) {
    try {
      var p = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      while (p.length % 4) p += '=';
      var o = JSON.parse(atob(p));
      return (o && o.exp) ? o.exp * 1000 : 0;
    } catch (e) { return 0; }
  }
  function valido(t) { var e = expDe(t); return e === 0 || e > Date.now() + 60000; }
  function hhmm(ms) { if (!ms) return '—'; var d = new Date(ms); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }

  // ---------------- LADO A: dentro do jus.br — capturar e GUARDAR ----------------
  function guardar(payload, de) {
    if (!payload || !ehJwt(payload.token)) return;
    if (!valido(payload.token)) return;               // token velho do navegador: ignora
    var atual = '';
    try { atual = GM_getValue(CHAVE, ''); } catch (e) {}
    try {
      var ja = atual ? JSON.parse(atual) : null;
      if (ja && ja.token === payload.token) return;   // já guardado
      // nunca substituir por um token que vence ANTES do que já temos
      if (ja && ja.token && expDe(ja.token) > expDe(payload.token)) return;
    } catch (e) {}
    payload.ts = Date.now();
    try { GM_setValue(CHAVE, JSON.stringify(payload)); } catch (e) { return; }
    quandoOk = Date.now(); origem = de || ''; estado = 'token capturado ' + hhmm(quandoOk); cor = '#0F6E56';
    selo();
    enviarDireto(payload);   // tenta enviar já (se o portal permitir)
  }
  // tentativa direta (pode ser barrada pelo CSP do portal — tudo bem, o CMPGestão envia)
  function enviarDireto(payload) {
    try {
      GM_xmlhttpRequest({
        method: 'POST', url: ENDPOINT,
        headers: { 'Content-Type': 'application/json', 'x-jusbr-relay': RELAY_SECRET },
        data: JSON.stringify({ token: payload.token, refresh_token: payload.refresh_token || undefined }),
        onload: function (r) { if (r && r.status >= 200 && r.status < 300) { estado = 'sincronizado ' + hhmm(Date.now()); cor = '#0F6E56'; selo(); } },
        onerror: function () {}
      });
    } catch (e) {}
  }

  function ehEndpointToken(u) { return /\\/protocol\\/openid-connect\\/token(\\?|$)/i.test(String(u || '')); }
  function daRespostaToken(txt) {
    try {
      var j = JSON.parse(txt);
      if (!j || !j.access_token) return;
      var pl = { token: j.access_token };
      if (j.refresh_token) pl.refresh_token = j.refresh_token;
      guardar(pl, 'login');
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
  function achaTokens(o, saida, prof) {
    if (!o || prof > 4 || typeof o !== 'object') return;
    for (var k in o) {
      try {
        var v = o[k];
        if (typeof v === 'string') {
          if (/access[_-]?token|^token$/i.test(k) && ehJwt(v)) saida.token = saida.token || v;
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
    if (achado.token) { guardar(achado, 'armazenamento'); return true; }
    return false;
  }

  // ---------- MODO APRENDIZADO: registra a FORMA do peticionamento ----------
  // Grava só o esqueleto (URL, nomes de cabeçalhos, chaves do JSON com valores
  // truncados). Conteúdo de arquivo vira "<arquivo N bytes>". Nada de token.
  var ENDPOINT_APRENDER = ENDPOINT.replace(/\/token$/, '/aprender');
  function ehPeticionamento(u) { return /petic|protocol|peticionamento/i.test(String(u || '')); }
  function esqueleto(v, prof) {
    prof = prof || 0;
    if (v == null) return null;
    if (typeof v === 'string') {
      if (v.length > 300) return '<texto ' + v.length + ' chars>';
      if (/^[A-Za-z0-9+/=]{200,}$/.test(v)) return '<arquivo base64 ' + v.length + ' bytes>';
      return v.length > 60 ? (v.slice(0, 60) + '…') : v;
    }
    if (typeof v === 'number' || typeof v === 'boolean') return v;
    if (prof > 5) return '…';
    if (Array.isArray(v)) return v.slice(0, 2).map(function (x) { return esqueleto(x, prof + 1); });
    if (typeof v === 'object') {
      var o = {};
      for (var k in v) { try { o[k] = esqueleto(v[k], prof + 1); } catch (e) {} }
      return o;
    }
    return String(typeof v);
  }
  function formaDoCorpo(body) {
    try {
      if (!body) return null;
      if (typeof body === 'string') { try { return esqueleto(JSON.parse(body), 0); } catch (e) { return '<texto ' + body.length + ' chars>'; } }
      if (typeof FormData !== 'undefined' && body instanceof FormData) {
        var o = {};
        body.forEach(function (val, k) {
          if (val && val.name && typeof val.size === 'number') o[k] = '<arquivo ' + val.name + ' ' + val.size + ' bytes>';
          else o[k] = esqueleto(String(val), 1);
        });
        return { _formdata: o };
      }
      if (typeof body === 'object') return esqueleto(body, 0);
    } catch (e) {}
    return null;
  }
  function aprender(metodo, url, headers, body, status, respTxt) {
    try {
      var nomes = [];
      try { if (headers && typeof headers.forEach === 'function') headers.forEach(function (v, k) { nomes.push(k); }); else if (headers) nomes = Object.keys(headers); } catch (e) {}
      var respForma = null;
      try { if (respTxt && respTxt.length < 20000) respForma = esqueleto(JSON.parse(respTxt), 0); } catch (e) {}
      var payload = { metodo: metodo, url: String(url).split('?')[0], cabecalhos: nomes, corpo_forma: formaDoCorpo(body), resposta_status: status || null, resposta_forma: respForma };
      GM_xmlhttpRequest({
        method: 'POST', url: ENDPOINT_APRENDER,
        headers: { 'Content-Type': 'application/json', 'x-jusbr-relay': RELAY_SECRET },
        data: JSON.stringify(payload), onload: function () {}, onerror: function () {}
      });
      estado = 'peticionamento observado ' + hhmm(Date.now()); cor = '#185FA5'; selo();
    } catch (e) {}
  }

  if (!NO_GESTAO) {
    var of = window.fetch;
    window.fetch = function (input, init) {
      var url = (input && input.url) || input;
      try { var t = bearerDe(init && init.headers) || bearerDe(input && input.headers); if (t) guardar({ token: t }, 'rede'); } catch (e) {}
      var p = of.apply(this, arguments);
      try { if (ehEndpointToken(url)) p.then(function (r) { try { r.clone().text().then(daRespostaToken); } catch (e) {} }); } catch (e) {}
      try {
        var mt = String((init && init.method) || 'GET').toUpperCase();
        if (mt !== 'GET' && ehPeticionamento(url)) {
          var bd = init && init.body, hd = init && init.headers;
          p.then(function (r) { try { r.clone().text().then(function (tx) { aprender(mt, url, hd, bd, r.status, tx); }); } catch (e) { aprender(mt, url, hd, bd, r.status, ''); } });
        }
      } catch (e) {}
      return p;
    };
    var oOpen = XMLHttpRequest.prototype.open, oSend = XMLHttpRequest.prototype.send, oSet = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.open = function (m, u) { try { this.__u = u; this.__m = m; } catch (e) {} return oOpen.apply(this, arguments); };
    XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
      try { if (/^authorization$/i.test(k) && /^Bearer\\s+/i.test(v)) guardar({ token: v.replace(/^Bearer\\s+/i, '').trim() }, 'rede'); } catch (e) {}
      return oSet.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function (b) {
      try {
        if (ehEndpointToken(this.__u)) { var s = this; s.addEventListener('load', function () { try { if (s.status >= 200 && s.status < 300) daRespostaToken(s.responseText); } catch (e) {} }); }
        if (ehPeticionamento(this.__u) && String(this.__m || 'GET').toUpperCase() !== 'GET') {
          var s2 = this, bd2 = b;
          s2.addEventListener('load', function () { try { aprender(String(s2.__m || 'POST').toUpperCase(), s2.__u, null, bd2, s2.status, s2.responseText); } catch (e) {} });
        }
      } catch (e) {}
      return oSend.apply(this, arguments);
    };
    estado = 'aguardando token…';
    setTimeout(function () { varrerStorage(); selo(); }, 2500);
    setInterval(function () { varrerStorage(); selo(); }, 60000);
  }

  // ------------- LADO B: dentro do CMPGestão — LER do cofre e ENVIAR -------------
  // Aqui é o nosso próprio site: fetch de mesma origem, sem CORS/CSP/permissão.
  var ultimoEnviado = '';
  function empurrar() {
    var raw = '';
    try { raw = GM_getValue(CHAVE, ''); } catch (e) { return; }
    if (!raw) { estado = 'sem token do jus.br — abra o portal'; cor = '#8a5a00'; selo(); return; }
    var o = null; try { o = JSON.parse(raw); } catch (e) { return; }
    if (!o || !ehJwt(o.token)) return;
    if (o.token === ultimoEnviado) { return; }
    var corpo = JSON.stringify({ token: o.token, refresh_token: o.refresh_token || undefined });
    fetch('/api/jusbr/token', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-jusbr-relay': RELAY_SECRET }, body: corpo })
      .then(function (r) {
        if (r.ok) { ultimoEnviado = o.token; quandoOk = Date.now(); estado = 'sincronizado ' + hhmm(quandoOk); cor = '#0F6E56'; origem = 'cofre'; }
        else { estado = 'erro HTTP ' + r.status; cor = '#b5342b'; }
        selo();
      })
      .catch(function () { estado = 'falha de rede'; cor = '#b5342b'; selo(); });
  }
  if (NO_GESTAO) {
    estado = 'verificando…';
    setTimeout(function () { empurrar(); }, 3000);
    setInterval(empurrar, 45000);
  }

  // ---------------------------- selo visível ----------------------------
  var el = null;
  function selo() {
    try {
      if (!document.body) return;
      if (!el) {
        el = document.createElement('div');
        el.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:2147483647;background:#fff;border:1px solid #d7dde5;border-radius:10px;box-shadow:0 4px 14px rgba(0,0,0,.14);padding:8px 11px;font:12px system-ui,Arial;color:#1e2733;max-width:250px';
        el.addEventListener('click', function (ev) {
          if (ev.target && ev.target.getAttribute('data-a') === 'go') { if (NO_GESTAO) { ultimoEnviado = ''; empurrar(); } else { varrerStorage(); } selo(); }
        });
        document.body.appendChild(el);
      }
      el.innerHTML = '<div style="font-weight:700;color:#2E3A4B;margin-bottom:2px">CMPGestão' + (NO_GESTAO ? '' : ' · jus.br') + '</div>'
        + '<div style="color:' + cor + ';font-weight:600">' + estado + '</div>'
        + (origem ? '<div style="color:#697180;font-size:11px">via ' + origem + '</div>' : '')
        + '<div style="margin-top:5px"><button data-a="go" style="cursor:pointer;border:1px solid #cfe0f2;background:#eef4fb;color:#185FA5;border-radius:7px;padding:3px 8px;font-size:11px">sincronizar agora</button></div>';
    } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(selo, 1500); });
  else setTimeout(selo, 1500);
})();
`
}

// Endereço PÚBLICO do sistema. NÃO usar new URL(request.url).origin: o app roda
// atrás de proxy (nginx → 127.0.0.1:3000), então request.url traz o endereço
// interno — e o userscript acabaria apontando para a máquina do próprio
// navegador (foi exatamente o que quebrou a sincronização do jus.br).
function basePublica(request) {
  const proto = (request.headers.get('x-forwarded-proto') || 'https').split(',')[0].trim()
  const host = (request.headers.get('x-forwarded-host') || request.headers.get('host') || '').split(',')[0].trim()
  if (host && !/^(127\.|localhost|0\.0\.0\.0|\[::1\])/i.test(host)) return proto + '://' + host
  return process.env.PUBLIC_BASE_URL || 'https://gestao.cmpadvogados.com.br'
}

export async function GET(request) {
  const user = await usuario(request)
  if (!user) return new Response('Faça login no sistema para gerar o userscript.', { status: 401 })
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return new Response('servidor sem service key', { status: 500 })
  const sb = admin()
  const segredo = await garantirSegredo(sb)
  const endpoint = basePublica(request) + '/api/jusbr/token'
  return new Response(scriptTexto(segredo, endpoint), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
