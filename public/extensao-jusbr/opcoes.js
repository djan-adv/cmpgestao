/* Tela única da extensão: serve de opções e de popup do ícone. Mostra o estado
   real da última tentativa — a pessoa precisa saber se o token chegou, sem ter
   de abrir o sistema para conferir. */
const $ = (id) => document.getElementById(id);

/* Abrir este arquivo com dois cliques (file:///…/opcoes.html) não instala nada:
   é uma página solta, sem acesso ao armazenamento da extensão. Aconteceu no
   primeiro teste, e a tela aparecia vazia sem explicar por quê. */
if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
  document.body.innerHTML =
    '<h1>Esta tela é da extensão</h1>'
    + '<p class="n">Você abriu o arquivo <b>opcoes.html</b> direto da pasta. Assim ele é só uma página — a extensão não está instalada, e por isso os campos aparecem vazios.</p>'
    + '<p class="n"><b>Para instalar:</b><br>1. Abra <b>chrome://extensions</b> (no Edge: <b>edge://extensions</b>).<br>'
    + '2. Ligue o <b>Modo do desenvolvedor</b>.<br>'
    + '3. Clique em <b>Carregar sem compactação</b> (Edge: <b>Carregar descompactado</b>) e escolha a pasta <b>cmpgestao-jusbr</b> inteira — a pasta, não um arquivo.<br>'
    + '4. Depois clique no ícone da extensão (quebra-cabeça na barra do navegador).</p>'
    + '<p class="n">Baixando o .zip pelo sistema (Robôs → jus.br), a chave já vem dentro: não há nada para colar.</p>';
  throw new Error('fora da extensão');
}
const CORES = { verde: ['#e9f6f0', '#0f5c46'], amarelo: ['#fdf3e7', '#8a5a00'], vermelho: ['#fbeceb', '#b5342b'] };

async function pintar() {
  const o = await chrome.storage.local.get(['endpoint', 'segredo', 'estado', 'cor', 'detalhe', 'quando', 'aprendidos']);
  $('endpoint').value = o.endpoint || 'https://gestao.cmpadvogados.com.br/api/jusbr/token';
  $('segredo').value = o.segredo || '';
  const c = CORES[o.cor] || CORES.amarelo;
  const q = o.quando ? new Date(o.quando).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
  $('st').style.background = c[0]; $('st').style.color = c[1];
  $('st').innerHTML = (o.estado || 'aguardando o jus.br') + (q ? (' · ' + q) : '')
    + (o.detalhe ? ('<div class="d">' + String(o.detalhe).replace(/</g, '&lt;') + '</div>') : '')
    + (!o.segredo ? '<div class="d">Cole a chave de pareamento acima e salve.</div>' : '')
    + (o.aprendidos ? ('<div class="d">' + o.aprendidos + ' observação(ões) de peticionamento enviadas</div>') : '');
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
