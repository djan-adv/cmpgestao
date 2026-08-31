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

  /* ===== Modo aprendizado: como o portal protocola =====
     Registra só o ESQUELETO das requisições de escrita (endereço, nomes de
     cabeçalhos, chaves do JSON com valores curtos, formato da resposta). O
     conteúdo do arquivo vira "<arquivo N bytes>"; token nenhum é gravado.

     Diferença para o que o userscript coletava: lá o filtro exigia "/api/" em
     domínio do PDPJ, e por isso o passo que MANDA os bytes do PDF ficou de fora
     das dez capturas — provavelmente um PUT para outro endereço. Aqui o filtro
     pega qualquer requisição de escrita disparada pelas páginas do portal, e a
     resposta traz também os cabeçalhos que interessam (é neles que costuma vir
     o endereço de upload). Sem esse passo não há como protocolar de fora. */
  function ehEscritaDoPortal(u, metodo) {
    u = String(u || '');
    if (!u) return false;
    if (ehEndpointToken(u)) return false;                                  /* login/refresh não interessa */
    if (/\.(js|css|png|jpe?g|gif|svg|woff2?|ico|map)(\?|$)/i.test(u)) return false;
    if (/google-analytics|googletagmanager|hotjar|clarity|sentry|newrelic/i.test(u)) return false;
    if (String(metodo || 'GET').toUpperCase() !== 'GET') return true;      /* escrita: sempre interessa */
    /* LEITURA (GET) entra em dois casos, e só neles — senão a fila enche com o
       carregamento normal das telas:
         a) estando na tela de peticionamento, onde o portal busca as listas que
            o formulário precisa (tipos de documento, dados do processo);
         b) o comprovante/recibo do protocolo, em qualquer tela — é o arquivo
            que o dono quer que o sistema guarde na pasta sozinho. */
    var api = /portaldeservicos\.pdpj\.jus\.br\/api\//i.test(u) || u.charAt(0) === '/';
    if (!api) return false;
    if (/recibo|comprovante|protocolo/i.test(u)) return true;
    try { if (/^\/peticao/i.test(location.pathname)) return true; } catch (e) {}
    return false;
  }
  /* o mesmo endereço não precisa ser mandado duas vezes na mesma visita */
  var jaVistos = {};
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
    if (typeof Blob !== 'undefined' && v instanceof Blob) return '<arquivo ' + (v.name || 'sem nome') + ' ' + v.size + ' bytes ' + (v.type || '') + '>';
    if (typeof ArrayBuffer !== 'undefined' && (v instanceof ArrayBuffer || ArrayBuffer.isView(v))) return '<binário ' + (v.byteLength || 0) + ' bytes>';
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
      return esqueleto(body, 0);
    } catch (e) {}
    return null;
  }
  /* cabeçalhos da RESPOSTA que podem carregar o endereço de upload */
  var CAB_INTERESSA = /^(location|content-type|content-disposition|x-|etag)/i;
  function cabsDaResposta(r) {
    var out = [];
    try { r.headers.forEach(function (v, k) { if (CAB_INTERESSA.test(k)) out.push(k + ': ' + String(v).slice(0, 200)); }); } catch (e) {}
    return out;
  }
  function aprender(metodo, url, cabs, body, status, respTxt) {
    try {
      var chave = String(metodo) + ' ' + String(url).split('?')[0];
      if (String(metodo).toUpperCase() === 'GET') { if (jaVistos[chave]) return; jaVistos[chave] = 1; }
      var respForma = null;
      try { if (respTxt && respTxt.length < 20000) respForma = esqueleto(JSON.parse(respTxt), 0); } catch (e) { if (respTxt) respForma = '<texto ' + respTxt.length + ' chars>'; }
      window.postMessage({
        marca: MARCA, aprendizado: {
          metodo: metodo, url: String(url).split('?')[0], cabecalhos: cabs || [],
          corpo_forma: formaDoCorpo(body), resposta_status: status || null, resposta_forma: respForma,
        }
      }, location.origin);
    } catch (e) {}
  }
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
    try {
      var mt = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      if (ehEscritaDoPortal(url, mt)) {
        var bd = (init && init.body) || (input && input.body);
        p.then(function (r) {
          var cabs = cabsDaResposta(r);
          try { r.clone().text().then(function (tx) { aprender(mt, url, cabs, bd, r.status, tx); }); }
          catch (e) { aprender(mt, url, cabs, bd, r.status, ''); }
        });
      }
    } catch (e) {}
    return p;
  };

  var oOpen = XMLHttpRequest.prototype.open, oSend = XMLHttpRequest.prototype.send, oSet = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (m, u) { try { this.__u = u; this.__m = m; } catch (e) {} return oOpen.apply(this, arguments); };
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
      if (ehEscritaDoPortal(this.__u, this.__m)) {
        var s2 = this, bd2 = b;
        s2.addEventListener('load', function () {
          var cabs = [];
          try {
            String(s2.getAllResponseHeaders() || '').split(/\r?\n/).forEach(function (l) { if (l && CAB_INTERESSA.test(l.split(':')[0])) cabs.push(l.slice(0, 220)); });
          } catch (e) {}
          try { aprender(String(s2.__m || 'POST').toUpperCase(), s2.__u, cabs, bd2, s2.status, s2.responseText); } catch (e) {}
        });
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
