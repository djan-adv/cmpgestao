/* Serviço de fundo: é ele que fala com o CMPGestão.
   Aqui está o ganho real sobre o Tampermonkey: o portal do jus.br bloqueia, por
   CSP, qualquer envio saindo da página dele — por isso o userscript precisava
   guardar o token num cofre e esperar a aba do sistema estar aberta para
   entregá-lo. A extensão não tem esse limite: a requisição sai daqui, do
   próprio navegador, no instante da captura. O sistema pode estar fechado. */
try { importScripts('padrao.js'); } catch (e) {}
const PADRAO_ENDPOINT = (self.CMP_PADRAO && self.CMP_PADRAO.endpoint) || 'https://gestao.cmpadvogados.com.br/api/jusbr/token';
let ultimoToken = '';
let ultimoEnvio = 0;

async function cfg() {
  const o = await chrome.storage.local.get(['endpoint', 'segredo']);
  return { endpoint: (o.endpoint || PADRAO_ENDPOINT).trim(), segredo: (o.segredo || '').trim() };
}
async function situacao(estado, cor, detalhe) {
  await chrome.storage.local.set({ estado, cor, detalhe: detalhe || '', quando: Date.now() });
  try {
    await chrome.action.setBadgeText({ text: cor === 'verde' ? 'ok' : (cor === 'vermelho' ? '!' : '…') });
    await chrome.action.setBadgeBackgroundColor({ color: cor === 'verde' ? '#127a53' : (cor === 'vermelho' ? '#b5342b' : '#8a5a00') });
  } catch (e) {}
}

async function enviar(msg) {
  const { endpoint, segredo } = await cfg();
  if (!segredo) return situacao('falta o segredo — abra as opções da extensão', 'vermelho');
  /* o mesmo token não precisa ir de novo a cada requisição do portal */
  if (msg.token === ultimoToken && (Date.now() - ultimoEnvio) < 5 * 60 * 1000) return;
  ultimoToken = msg.token; ultimoEnvio = Date.now();
  try {
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-jusbr-relay': segredo },
      body: JSON.stringify({ token: msg.token, refresh_token: msg.refresh_token || undefined }),
    });
    let res = null; try { res = await r.json(); } catch (e) {}
    /* o servidor responde 200 e IGNORA quando o PDPJ recusa o token: sem ler o
       corpo, o selo mentiria (já mentiu, no userscript) */
    if (res && res.ignorado === 'recusado_pelo_pdpj') {
      ultimoToken = '';
      return situacao('o jus.br recusou este token — entre no portal de novo', 'vermelho');
    }
    if (res && res.ignorado) return situacao('ignorado: ' + res.ignorado, 'amarelo');
    if (!r.ok) return situacao('erro HTTP ' + r.status, 'vermelho', (res && res.erro) || '');
    /* a validade vem em UTC; mostrada crua, aparecia 3 horas à frente do relógio
       de quem lê (20:23 para um token que vence às 17:23 aqui) */
    let ate = ''
    try { if (res && res.expira) ate = 'vale até ' + new Date(res.expira).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) } catch (e) {}
    return situacao('sincronizado', 'verde', ate);
  } catch (e) {
    ultimoToken = '';
    return situacao('falha de rede ao falar com o sistema', 'vermelho', String((e && e.message) || e));
  }
}

chrome.runtime.onMessage.addListener((msg, remetente, responder) => {
  if (!msg) return;
  if (msg.tipo === 'token') { enviar(msg); return; }
  if (msg.tipo === 'testar') { ultimoToken = ''; enviar({ token: msg.token || '', refresh_token: null }).then(() => responder({ ok: true })); return true; }
});
/* baixada pelo próprio sistema, a extensão já vem pareada: nada a colar */
async function semear() {
  const p = self.CMP_PADRAO || {};
  if (!p.segredo) return;
  const o = await chrome.storage.local.get(['endpoint', 'segredo']);
  if (o.segredo) return;                       /* já configurada: não sobrescreve */
  await chrome.storage.local.set({ endpoint: p.endpoint || PADRAO_ENDPOINT, segredo: p.segredo });
}
chrome.runtime.onInstalled.addListener(async () => { await semear(); situacao('aguardando o jus.br', 'amarelo'); });
chrome.runtime.onStartup && chrome.runtime.onStartup.addListener(semear);
