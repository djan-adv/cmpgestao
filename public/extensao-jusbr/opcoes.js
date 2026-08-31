/* Tela única da extensão: serve de opções e de popup do ícone. Mostra o estado
   real da última tentativa — a pessoa precisa saber se o token chegou, sem ter
   de abrir o sistema para conferir. */
const $ = (id) => document.getElementById(id);
const CORES = { verde: ['#e9f6f0', '#0f5c46'], amarelo: ['#fdf3e7', '#8a5a00'], vermelho: ['#fbeceb', '#b5342b'] };

async function pintar() {
  const o = await chrome.storage.local.get(['endpoint', 'segredo', 'estado', 'cor', 'detalhe', 'quando']);
  $('endpoint').value = o.endpoint || 'https://gestao.cmpadvogados.com.br/api/jusbr/token';
  $('segredo').value = o.segredo || '';
  const c = CORES[o.cor] || CORES.amarelo;
  const q = o.quando ? new Date(o.quando).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
  $('st').style.background = c[0]; $('st').style.color = c[1];
  $('st').innerHTML = (o.estado || 'aguardando o jus.br') + (q ? (' · ' + q) : '')
    + (o.detalhe ? ('<div class="d">' + String(o.detalhe).replace(/</g, '&lt;') + '</div>') : '')
    + (!o.segredo ? '<div class="d">Cole a chave de pareamento acima e salve.</div>' : '');
}
$('salvar').onclick = async () => {
  const endpoint = $('endpoint').value.trim(), segredo = $('segredo').value.trim();
  if (!/^https:\/\//i.test(endpoint)) { alert('O endereço precisa começar com https://'); return; }
  /* o endereço do sistema pode ser o de qualquer escritório — a permissão para
     falar com ele é pedida na hora, não embutida na extensão */
  try {
    const u = new URL(endpoint);
    const concedida = await chrome.permissions.request({ origins: [u.origin + '/*'] });
    if (!concedida) { alert('Sem permissão para falar com ' + u.host + ' — a ponte não vai funcionar.'); return; }
  } catch (e) {}
  await chrome.storage.local.set({ endpoint, segredo });
  await chrome.storage.local.set({ estado: 'pronta — entre no jus.br', cor: 'amarelo', detalhe: '', quando: Date.now() });
  pintar();
};
$('abrir').onclick = () => chrome.tabs.create({ url: 'https://portaldeservicos.pdpj.jus.br/' });
chrome.storage.onChanged.addListener(pintar);
pintar();
