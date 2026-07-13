// ==UserScript==
// @name         CMPGestão — Sincronizar token jus.br (PDPJ)
// @namespace    cmpadvogados.com.br
// @version      1.0
// @description  Captura o Bearer da sessão do PDPJ (jus.br) e envia ao CMPGestão, para o sistema puxar documentos dos processos. Roda passivo enquanto você usa o jus.br.
// @match        https://portaldeservicos.pdpj.jus.br/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @connect      gestao.cmpadvogados.com.br
// ==/UserScript==
//
// COMO USAR:
// 1) Instale o Tampermonkey (extensão do Chrome).
// 2) Crie um novo script, cole este conteúdo.
// 3) Troque RELAY_SECRET pelo mesmo valor definido em JUSBR_RELAY_SECRET no servidor.
// 4) Salve. Pronto: sempre que você usar o jus.br logado, o token é sincronizado
//    (no máximo 1x a cada 5 min). O token do PDPJ dura ~8h.
//
// Nada de senha é capturado — só o token de acesso (Bearer) da sua sessão já aberta.

(function () {
  'use strict';
  var RELAY_SECRET = 'TROCAR_PELO_SEGREDO';           // <-- igual ao JUSBR_RELAY_SECRET do servidor
  var ENDPOINT = 'https://gestao.cmpadvogados.com.br/api/jusbr/token';
  var ultimoEnvio = 0, ultimoToken = '';

  function enviar(token) {
    if (!token || token.split('.').length !== 3) return;
    var agora = Date.now();
    if (token === ultimoToken && (agora - ultimoEnvio) < 5 * 60 * 1000) return; // no máx 1x/5min
    ultimoToken = token; ultimoEnvio = agora;
    try {
      GM_xmlhttpRequest({
        method: 'POST', url: ENDPOINT,
        headers: { 'Content-Type': 'application/json', 'x-jusbr-relay': RELAY_SECRET },
        data: JSON.stringify({ token: token }),
        onload: function () {}, onerror: function () {},
      });
    } catch (e) {
      // fallback sem GM (se o @grant não pegar): fetch normal (pode dar CORS, mas tenta)
      try { fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-jusbr-relay': RELAY_SECRET }, body: JSON.stringify({ token: token }) }); } catch (e2) {}
    }
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

  // intercepta fetch
  var of = window.fetch;
  window.fetch = function (input, init) {
    try {
      var t = pegarBearer(init && init.headers) || pegarBearer(input && input.headers);
      if (t) enviar(t);
    } catch (e) {}
    return of.apply(this, arguments);
  };

  // intercepta XHR
  var os = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    try { if (/^authorization$/i.test(k) && /^Bearer\s+/i.test(v)) enviar(v.replace(/^Bearer\s+/i, '').trim()); } catch (e) {}
    return os.apply(this, arguments);
  };
})();
