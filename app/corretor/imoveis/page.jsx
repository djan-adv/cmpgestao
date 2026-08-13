import Link from 'next/link'
import { COR } from '../_componentes/tema'
import { buscarImoveis } from '../_componentes/dados'
import CartaoImovel from '../_componentes/CartaoImovel'

const ABAS = [
  { valor: undefined, label: 'Todos' },
  { valor: 'proprio', label: 'Próprios' },
  { valor: 'parceria', label: 'Parceria' },
  { valor: 'terceiro', label: 'Anunciantes' },
]
const TIPOS_VALIDOS = ['proprio', 'parceria', 'terceiro']

export default async function PaginaImoveis({ searchParams }) {
  const tipo = TIPOS_VALIDOS.includes(searchParams?.tipo) ? searchParams.tipo : undefined
  const imoveis = await buscarImoveis({ tipo })

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 20px' }}>
      <h1 style={{ fontSize: 26, marginBottom: 6 }}>Imóveis</h1>
      <p style={{ color: COR.textoSuave, fontSize: 14.5, marginBottom: 22 }}>Imóveis próprios e imóveis em parceria com outros corretores.</p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {ABAS.map(a => {
          const ativo = a.valor === tipo
          const href = a.valor ? `/corretor/imoveis?tipo=${a.valor}` : '/corretor/imoveis'
          return (
            <Link key={a.label} href={href}
              style={{
                textDecoration: 'none', fontSize: 13.5, fontWeight: 700, padding: '8px 16px', borderRadius: 20,
                background: ativo ? COR.escuro : COR.branco, color: ativo ? COR.branco : COR.texto,
                border: `1px solid ${ativo ? COR.escuro : COR.borda}`,
              }}>
              {a.label}
            </Link>
          )
        })}
      </div>

      {imoveis.length === 0 ? (
        <div style={{ color: COR.textoSuave, fontSize: 14.5, padding: '40px 0' }}>Nenhum imóvel cadastrado nesta categoria no momento.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 18 }}>
          {imoveis.map(im => <CartaoImovel key={im.id} imovel={im} />)}
        </div>
      )}
    </div>
  )
}
