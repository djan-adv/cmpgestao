import Nav from './_componentes/Nav'
import Footer from './_componentes/Footer'
import { COR } from './_componentes/tema'

// Metadados próprios — não herdam nome/ícone da CMPGestão (ver app/layout.jsx).
// Sem qualquer menção a advocacia: CRECI veta a mistura de atividades no material
// de divulgação do corretor (ver ops/PROJETO-CORRETOR-IMOVEIS.md).
export const metadata = {
  title: 'Djan | Corretor e Avaliador de Imóveis — CRECI 5401',
  description: 'Corretor de imóveis e avaliador (CRECI 5401 · CNAI 8514). Imóveis próprios, imóveis em parceria, anúncios e avaliação de imóveis.',
  icons: { icon: '/favicon-corretor.svg' },
}

export default function LayoutCorretor({ children }) {
  return (
    <div style={{ minHeight: '100vh', background: COR.fundo, color: COR.texto, fontFamily: 'system-ui, Arial, sans-serif' }}>
      <Nav />
      <main>{children}</main>
      <Footer />
    </div>
  )
}
