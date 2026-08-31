// Roteamento por domínio: a mesma raiz (um processo Next, um PM2, uma VPS) serve o
// CMPGestão E o site do corretor, sem misturar marca — quem responde por
// corretor.djan.net.br (ou djan.net.br) é redirecionado por dentro para as rotas em
// app/corretor/*.
//
// `corretor.djan.net.br` é o domínio definitivo escolhido pelo Djan (subdomínio do
// djan.net.br dele, na Hostinger). `corretor.djan.app.br` continua como subdomínio de
// testes (mesmo padrão do inove.djan.app.br — ver ops/PROJETO-INOVE.md), e djan.net.br
// puro/www seguem valendo como alternativa caso ele prefira usar o domínio raiz. O
// nginx da VPS ainda precisa de um server block novo por domínio (proxy_pass genérico
// para 127.0.0.1:3000) e o DNS da Hostinger precisa apontar o subdomínio pra VPS —
// isso fica fora do repositório. Ver ops/PROJETO-CORRETOR-IMOVEIS.md.

import { NextResponse } from 'next/server'

const HOSTS_CORRETOR = new Set([
  'corretor.djan.net.br',
  'djan.net.br',
  'www.djan.net.br',
  'corretor.djan.app.br',
])

export function middleware(request) {
  const host = (request.headers.get('host') || '').split(':')[0].toLowerCase()
  if (!HOSTS_CORRETOR.has(host)) return NextResponse.next()

  const { pathname } = request.nextUrl
  if (pathname.startsWith('/corretor')) return NextResponse.next()

  const url = request.nextUrl.clone()
  url.pathname = '/corretor' + (pathname === '/' ? '' : pathname)
  return NextResponse.rewrite(url)
}

export const config = {
  // deixa passar direto: rotas de API (não precisam de prefixo — o mesmo
  // /api/imoveis atende qualquer domínio), assets internos do Next e arquivos
  // estáticos (contêm um ponto no nome: .png, .ico, .css...).
  matcher: ['/((?!api|_next|.*\\..*).*)'],
}
