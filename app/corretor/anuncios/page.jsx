import { COR } from '../_componentes/tema'
import { buscarAnuncios } from '../_componentes/dados'

export default async function PaginaAnuncios() {
  const anuncios = await buscarAnuncios()

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 20px' }}>
      <h1 style={{ fontSize: 26, marginBottom: 6 }}>Anúncios</h1>
      <p style={{ color: COR.textoSuave, fontSize: 14.5, marginBottom: 28 }}>Espaço de anunciantes parceiros do site.</p>

      {anuncios.length === 0 ? (
        <div style={{ color: COR.textoSuave, fontSize: 14.5 }}>Nenhum anúncio publicado no momento.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 18 }}>
          {anuncios.map(a => (
            <a key={a.id} href={a.link_externo || '#'} target={a.link_externo ? '_blank' : undefined} rel="noreferrer"
              style={{ textDecoration: 'none', color: 'inherit' }}>
              <div style={{ background: COR.branco, border: `1px solid ${COR.borda}`, borderRadius: 12, overflow: 'hidden', height: '100%' }}>
                <div style={{ aspectRatio: '16 / 9', background: COR.fundoAlt, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {a.imagem_url
                    ? <img src={a.imagem_url} alt={a.titulo} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : <span style={{ color: COR.textoSuave, fontSize: 13 }}>Sem imagem</span>}
                </div>
                <div style={{ padding: 14 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{a.titulo}</div>
                  {a.descricao && <div style={{ fontSize: 13, color: COR.textoSuave, lineHeight: 1.5 }}>{a.descricao}</div>}
                  {a.anunciante_nome && <div style={{ fontSize: 11.5, color: COR.textoSuave, marginTop: 8 }}>Anunciante: {a.anunciante_nome}</div>}
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
