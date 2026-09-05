// A marca do APLICATIVO do cliente: nome, cor e ícone do atalho que fica na
// tela de início do celular. Uma fonte só, usada pelo manifesto e pelo ícone.
//
// Existe porque isso era fixo: o manifesto dizia "CMP Advogados — Portal do
// Cliente" e apontava o ícone da CMP. O cliente de um escritório que comprou o
// sistema instalava no celular um app com o nome e a marca de outra banca.

export const COR_PADRAO = '#2E3A4B'

/* sobe quando a arte do ícone muda — ver ops/gerar-icones.py */
export const VERSAO_ICONE = '?v=2'

export function hostLimpo(h) {
  return String(h || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '')
}

/** nome que aparece no atalho: o nome de marca do escritório, ou o dele mesmo */
export function nomeDaCasa(esc) {
  return (esc && ((esc.marca && esc.marca.sistema) || esc.nome)) || 'Portal do Cliente'
}
export function corDaCasa(esc) {
  return (esc && esc.marca && esc.marca.cor) || COR_PADRAO
}

/* palavras que não dizem quem é o escritório */
const FACHADA = /^(de|do|da|dos|das|e|advogados?|advocacia|sociedade|associados?|portal|escrit[óo]rio)$/i
function palavrasDoNome(nome) {
  return String(nome || '').trim().split(/\s+/).filter(p => p.length > 2 && !FACHADA.test(p))
}

/** iniciais para o ícone desenhado — ignora partículas e palavras de fachada */
export function iniciais(nome) {
  const letras = palavrasDoNome(nome).slice(0, 2).map(p => p[0]).join('')
  return (letras || String(nome || 'A').trim()[0] || 'A').toUpperCase()
}

/** O nome curto que fica ESCRITO EMBAIXO DO ÍCONE, no celular. Cabe pouca coisa
    ali — cortar o nome no 12º caractere produzia coisas como "Crispim Mend".
    Nome curto sai inteiro; nome de banca sai pelas iniciais (CMP). */
export function nomeCurto(nome) {
  const limpo = String(nome || '').trim()
  if (limpo.length <= 12) return limpo || 'Portal'
  const partes = palavrasDoNome(limpo)
  if (partes.length >= 3) return partes.slice(0, 3).map(p => p[0]).join('').toUpperCase()
  if (partes[0] && partes[0].length <= 12) return partes[0]
  return (partes.map(p => p[0]).join('') || limpo.slice(0, 12)).toUpperCase()
}

function escapaXml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** ícone desenhado na hora: quadrado na cor da marca com as iniciais */
export function svgIcone(nome, cor) {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">' +
    '<rect width="512" height="512" rx="96" fill="' + escapaXml(cor || COR_PADRAO) + '"/>' +
    '<text x="256" y="256" fill="#ffffff" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" ' +
    'font-size="230" font-weight="700" text-anchor="middle" dominant-baseline="central">' +
    escapaXml(iniciais(nome)) + '</text></svg>'
}

/** os ícones do manifesto: da casa, o dela; do escritório cliente, o logo dele
    (ou o desenho com as iniciais) — nunca o de outro escritório */
export function iconesDe(esc, host) {
  // ?v= porque navegador e celular guardam ícone por muito tempo: trocar a arte
  // sem trocar o endereço deixava todo mundo com o desenho velho
  if (esc && esc.raiz === true) {
    return [
      { src: '/icone-cmp-512.png' + VERSAO_ICONE, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/apple-touch-icon.png' + VERSAO_ICONE, sizes: '180x180', type: 'image/png', purpose: 'any' },
    ]
  }
  const logo = esc && esc.marca && esc.marca.logo
  if (logo) return [{ src: logo, sizes: '512x512', type: 'image/png', purpose: 'any' }]
  return [{ src: '/api/portal/icone.svg?host=' + encodeURIComponent(host || ''), sizes: 'any', type: 'image/svg+xml', purpose: 'any' }]
}

/** o manifesto inteiro do app deste escritório */
export function manifestoDe(esc, host) {
  const nome = nomeDaCasa(esc)
  const cor = corDaCasa(esc)
  return {
    name: nome + ' — Portal do Cliente',
    short_name: nomeCurto(nome),
    description: 'Acompanhe seus processos com ' + nome + '.',
    id: '/portal.html',
    start_url: '/portal.html?fonte=pwa',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: cor,
    theme_color: cor,
    lang: 'pt-BR',
    icons: iconesDe(esc, host),
  }
}
