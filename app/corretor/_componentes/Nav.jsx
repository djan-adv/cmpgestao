import Link from 'next/link'
import { COR } from './tema'

const LINKS = [
  { href: '/corretor', label: 'Início' },
  { href: '/corretor/imoveis', label: 'Imóveis' },
  { href: '/corretor/parcerias', label: 'Parcerias' },
  { href: '/corretor/avaliacao', label: 'Avaliação de Imóveis' },
]

export default function Nav() {
  return (
    <header style={{ background: COR.escuro, color: COR.branco }}>
      <div style={{
        maxWidth: 1100, margin: '0 auto', padding: '14px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 12,
      }}>
        <Link href="/corretor" style={{ color: COR.branco, textDecoration: 'none', fontWeight: 700, fontSize: 19, letterSpacing: 0.3 }}>
          Djan <span style={{ color: COR.destaque }}>Imóveis</span>
        </Link>
        <nav style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'center' }}>
          {LINKS.map(l => (
            <Link key={l.href} href={l.href} style={{ color: '#E7E4DA', textDecoration: 'none', fontSize: 14.5 }}>
              {l.label}
            </Link>
          ))}
          <Link href="/corretor/anunciar" style={{
            background: COR.destaque, color: COR.escuro, textDecoration: 'none', fontSize: 13.5, fontWeight: 700,
            padding: '7px 14px', borderRadius: 20,
          }}>
            Anunciar meu imóvel
          </Link>
        </nav>
      </div>
    </header>
  )
}
