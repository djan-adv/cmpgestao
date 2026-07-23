// ==UserScript==
// @name         CMPGestão — Sincronizar token jus.br (PDPJ)
// @namespace    cmpadvogados.com.br
// @version      2.0
// @description  Captura o Bearer E o refresh_token da sessão do PDPJ (jus.br) e envia ao CMPGestão. Com o refresh, o sistema renova o acesso sozinho — você loga só uma vez. Roda passivo enquanto você usa o jus.br.
// @match        https://portaldeservicos.pdpj.jus.br/*
// @match        https://sso.cloud.pje.jus.br/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @connect      gestao.cmpadvogados.com.br
// ==/UserScript==
//
// COMO USAR:
// 1) Instale o Tampermonkey (extensão do Chrome).
// 2) Crie um novo script, cole este conteúdo.
// 3) Troque RELAY_SECRET pelo mesmo valor definido em JUSBR_RELAY_SECRET no servidor.
// 4) Salve e faça login no jus.br UMA vez. A partir daí o sistema renova sozinho.
//
// Nada de senha é capturado — só os tokens (acesso + renovação) da sua sessão já aberta.

(function () {
  'use strict';
  var RELAY_SECRET = 'TROCAR_PELO_SEGREDO';           // <-- igual ao JUSBR_RELAY_SECRET do servidor
  var ENDPOINT = 'https://gestao.cmpadvogados.com.br/api/jusbr/token';
  var ultimoEnvio = 0, ultimoToken = '', ultimoRefresh = '';

  // envia access token (e, quando disponível, o refresh + client_id + endpoint)
  function enviar(payload) {
    if (!payload || !payload.token || payload.token.split('.').length !== 3) return;
    var agora = Date.now();
    // reenvio: no máx 1x/5min PARA O MESMO token, salvo se agora temos refresh e antes não tínhamos
    var ganhouRefresh = payload.refresh_token && payload.refresh_token !== ultimoRefresh;
    if (payload.token === ultimoToken && !ganhouRefresh && (agora - ultimoEnvio) < 5 * 60 * 1000) return;
    ultimoToken = payload.token; ultimoEnvio = agora;
    if (payload.refresh_token) ultimoRefresh = payload.refresh_token;
    try {
      GM_xmlhttpRequest({
        method: 'POST', url: ENDPOINT,
        headers: { 'Content-Type': 'application/json', 'x-jusbr-relay': RELAY_SECRET },
        data: JSON.stringify(payload),
        onload: function () {}, onerror: function () {},
      });
    } catch (e) {
      try { fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-jusbr-relay': RELAY_SECRET }, body: JSON.stringify(payload) }); } catch (e2) {}
    }
  }

  function ehEndpointToken(url) { return /\/protocol\/openid-connect\/token(\?|$)/i.test(String(url || '')); }

  // lê client_id/refresh de um corpo de requisição (x-www-form-urlencoded ou objeto)
  function lerForm(body) {
    var out = {};
    try {
      if (!body) return out;
      var s = null;
      if (typeof body === 'string') s = body;
      else if (body instanceof URLSearchParams) s = body.toString();
      else if (typeof body.toString === 'function') s = body.toString();
      if (s && /=/.test(s)) {
        var p = new URLSearchParams(s);
        if (p.get('client_id')) out.client_id = p.get('client_id');
      }
    } catch (e) {}
    return out;
  }

  // a partir da RESPOSTA do endpoint de token: pega access + refresh; junta client_id/url
  function daRespostaToken(url, reqBody, jsonTxt) {
    try {
      var j = JSON.parse(jsonTxt);
      if (!j || !j.access_token) return;
      var pl = { token: j.access_token, token_url: String(url).split('?')[0] };
      if (j.refresh_token) pl.refresh_token = j.refresh_token;
      var f = lerForm(reqBody);
      if (f.client_id) pl.client_id = f.client_id;
      enviar(pl);
    } catch (e) {}
  }

  function pegarBearer(h) {
    try {
      if (!h) return null;
      var v = null;
      if (typeof h.get === 'function') v = h.get('Authorization') || h.get('authorization');
      else if (typeof h === 'object') v = h.Authorization || h.authorization;
      if (v && /^Bearer\s+/i.test(v)) return v.replace(/^Bearer\s+/i, '').trim();
    } catch (e) {}
    return null;
  }

  // intercepta fetch (request: Bearer; response: tokens do endpoint de token)
  var of = window.fetch;
  window.fetch = function (input, init) {
    var url = (input && input.url) || input;
    try {
      var t = pegarBearer(init && init.headers) || pegarBearer(input && input.headers);
      if (t) enviar({ token: t });
    } catch (e) {}
    var p = of.apply(this, arguments);
    try {
      if (ehEndpointToken(url)) {
        var reqBody = init && init.body;
        p.then(function (resp) { try { resp.clone().text().then(function (txt) { daRespostaToken(url, reqBody, txt); }); } catch (e) {} });
      }
    } catch (e) {}
    return p;
  };

  // intercepta XHR (o adaptador Keycloak usa XHR): guarda url/body e lê a resposta
  var oOpen = XMLHttpRequest.prototype.open;
  var oSend = XMLHttpRequest.prototype.send;
  var oSet = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (m, u) { try { this.__cmpUrl = u; } catch (e) {} return oOpen.apply(this, arguments); };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    try { if (/^authorization$/i.test(k) && /^Bearer\s+/i.test(v)) enviar({ token: v.replace(/^Bearer\s+/i, '').trim() }); } catch (e) {}
    return oSet.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    try {
      if (ehEndpointToken(this.__cmpUrl)) {
        var self = this, reqBody = body;
        this.addEventListener('load', function () {
          try { if (self.status >= 200 && self.status < 300) daRespostaToken(self.__cmpUrl, reqBody, self.responseText); } catch (e) {}
        });
      }
    } catch (e) {}
    return oSend.apply(this, arguments);
  };
})();
