/* Roda DENTRO da página do jus.br (mundo MAIN, com acesso ao fetch/XHR do site).
   Faz uma coisa só: reconhecer o token da sessão que o próprio portal usa e
   avisar a ponte. Não lê senha, não mexe em nada da tela, não envia nada para
   fora — quem envia é o serviço de fundo da extensão.

   É a mesma captura do userscript do Tampermonkey, com uma diferença que muda
   tudo: aqui não existe o cofre GM_setValue nem a espera pela aba do sistema
   aberta. O token sai daqui e chega ao servidor na hora. */
(function () {
  'use strict';
  var MARCA = '__cmp_jusbr_ponte__';

  function ehJwt(t) { return typeof t === 'string' && t.split('.').length === 3 && t.length > 60; }
  function corpoJwt(t) {
    try {
      var p = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      while (p.length % 4) p += '=';
      return JSON.parse(atob(p));
    } catch (e) { return null; }
  }
  /* O navegador guarda JWTs velhos e de outros emissores (gov.br, outros
     clientes do Keycloak). Mandar um deles por cima do bom derruba a sessão do
     escritório — foi um erro real do userscript antigo, e a regra ficou. */
  function valido(t) { var o = corpoJwt(t); return !!o && (!o.exp || o.exp * 1000 > Date.now() + 60000); }
  function doPje(t) { var o = corpoJwt(t); return !!(o && o.iss && /(pje|pdpj)\.jus\.br/i.test(String(o.iss))); }
  function nota(t, de) { return (doPje(t) ? 10 : 0) + (de === 'login' ? 3 : (de === 'rede' ? 2 : 1)); }

  var melhor = { token: '', n: -1 };
  function achei(payload, de) {
    if (!payload || !ehJwt(payload.token) || !valido(payload.token)) return;
    var n = nota(payload.token, de);
    if (payload.token === melhor.token) return;
    if (n < melhor.n) return;                       /* captura pior não substitui a boa */
    melhor = { token: payload.token, n: n };
    try {
      window.postMessage({
        marca: MARCA, token: payload.token,
        refresh_token: payload.refresh_token || null, de: de || '', host: location.host
      }, location.origin);
    } catch (e) {}
  }

  function ehEndpointToken(u) { return /\/protocol\/openid-connect\/token(\?|$)/i.test(String(u || '')); }
  function daResposta(txt) {
    try {
      var j = JSON.parse(txt);
      if (j && j.access_token) achei({ token: j.access_token, refresh_token: j.refresh_token }, 'login');
    } catch (e) {}
  }
  function bearerDe(h) {
    try {
      if (!h) return null;
      var v = null;
      if (typeof h.get === 'function') v = h.get('Authorization') || h.get('authorization');
      else if (typeof h === 'object') v = h.Authorization || h.authorization;
      if (v && /^Bearer\s+/i.test(v)) return v.replace(/^Bearer\s+/i, '').trim();
    } catch (e) {}
    return null;
  }

  var of = window.fetch;
  window.fetch = function (input, init) {
    var url = (input && input.url) || input;
    try { var t = bearerDe(init && init.headers) || bearerDe(input && input.headers); if (t) achei({ token: t }, 'rede'); } catch (e) {}
    var p = of.apply(this, arguments);
    try { if (ehEndpointToken(url)) p.then(function (r) { try { r.clone().text().then(daResposta); } catch (e) {} }); } catch (e) {}
    return p;
  };

  var oOpen = XMLHttpRequest.prototype.open, oSend = XMLHttpRequest.prototype.send, oSet = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (m, u) { try { this.__u = u; } catch (e) {} return oOpen.apply(this, arguments); };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    try { if (/^authorization$/i.test(k) && /^Bearer\s+/i.test(v)) achei({ token: v.replace(/^Bearer\s+/i, '').trim() }, 'rede'); } catch (e) {}
    return oSet.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (b) {
    try {
      if (ehEndpointToken(this.__u)) {
        var s = this;
        s.addEventListener('load', function () { try { if (s.status >= 200 && s.status < 300) daResposta(s.responseText); } catch (e) {} });
      }
    } catch (e) {}
    return oSend.apply(this, arguments);
  };

  /* quem já estava logado antes de instalar a extensão não faz login de novo:
     o token está no armazenamento da página, e é de lá que ele sai */
  function varrer(o, saida, prof) {
    if (!o || prof > 4 || typeof o !== 'object') return;
    for (var k in o) {
      try {
        var v = o[k];
        if (typeof v === 'string') {
          if (/access[_-]?token|^token$/i.test(k) && ehJwt(v)) saida.token = saida.token || v;
          else if (/refresh[_-]?token/i.test(k) && v.length > 20) saida.refresh_token = saida.refresh_token || v;
          else if (ehJwt(v) && !saida.token) saida.token = v;
        } else if (v && typeof v === 'object') varrer(v, saida, prof + 1);
      } catch (e) {}
    }
  }
  function varrerArmazenamento() {
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
              if (o) varrer(o, achado, 0);
            }
          } catch (e) {}
        }
      });
    } catch (e) {}
    if (achado.token) achei(achado, 'armazenamento');
  }
  setTimeout(varrerArmazenamento, 2500);
  setInterval(varrerArmazenamento, 60000);
})();
