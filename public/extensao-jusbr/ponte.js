/* Ponte entre a página do jus.br e a extensão. Existe porque o script que
   enxerga o fetch do portal roda no mundo da página, e o mundo da página não
   pode falar com a extensão diretamente. Só repassa o que veio com a marca
   certa e da própria janela. */
(function () {
  'use strict';
  var MARCA = '__gj_jusbr_ponte__';
  window.addEventListener('message', function (ev) {
    try {
      if (ev.source !== window) return;
      var d = ev.data;
      if (!d || d.marca !== MARCA) return;
      if (d.aprendizado) { chrome.runtime.sendMessage({ tipo: 'aprender', dados: d.aprendizado }); return; }
      if (!d.token) return;
      chrome.runtime.sendMessage({ tipo: 'token', token: d.token, refresh_token: d.refresh_token, de: d.de });
    } catch (e) {}
  }, false);
})();
