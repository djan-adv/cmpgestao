import Link from 'next/link'
import { COR } from './_componentes/tema'
import { buscarPerfil, buscarImoveis } from './_componentes/dados'
import CartaoImovel from './_componentes/CartaoImovel'

export default async function PaginaInicial() {
  const [perfil, destaques] = await Promise.all([
    buscarPerfil(),
    buscarImoveis({ destaque: true }),
  ])
  const zap = (perfil.whatsapp || '').replace(/\D/g, '')

  return (
    <div>
      {/* ---------- hero ---------- */}
      <section style={{ background: COR.escuro, color: COR.branco }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '64px 20px 56px', display: 'flex', gap: 40, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ flex: '1 1 420px' }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              <span style={{ background: COR.destaque, color: COR.escuro, fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 20 }}>
                CRECI {perfil.creci}
              </span>
              <span style={{ background: 'rgba(255,255,255,.12)', color: COR.branco, fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 20 }}>
                CNAI {perfil.cnai}
              </span>
            </div>
            <h1 style={{ fontSize: 34, lineHeight: 1.2, margin: '0 0 12px' }}>{perfil.nome}</h1>
            <div style={{ fontSize: 18, color: COR.destaque, fontWeight: 600, marginBottom: 16 }}>{perfil.titulo}</div>
            <p style={{ fontSize: 15.5, color: '#D9D6C9', lineHeight: 1.6, maxWidth: 520 }}>{perfil.bio}</p>
            <div style={{ display: 'flex', gap: 12, marginTop: 26, flexWrap: 'wrap' }}>
              <Link href="/corretor/imoveis" style={{ background: COR.destaque, color: COR.escuro, padding: '12px 20px', borderRadius: 8, fontWeight: 700, textDecoration: 'none', fontSize: 14.5 }}>
                Ver imóveis
              </Link>
              <Link href="/corretor/avaliacao" style={{ border: `1px solid ${COR.destaque}`, color: COR.branco, padding: '12px 20px', borderRadius: 8, fontWeight: 700, textDecoration: 'none', fontSize: 14.5 }}>
                Solicitar avaliação
              </Link>
              {zap && (
                <a href={`https://wa.me/55${zap}`} target="_blank" rel="noreferrer"
                  style={{ border: '1px solid rgba(255,255,255,.3)', color: COR.branco, padding: '12px 20px', borderRadius: 8, fontWeight: 700, textDecoration: 'none', fontSize: 14.5 }}>
                  WhatsApp
                </a>
              )}
            </div>
          </div>
          {perfil.foto_url && (
            <div style={{ flex: '0 0 220px' }}>
              <img src={perfil.foto_url} alt={perfil.nome} style={{ width: 220, height: 220, borderRadius: '50%', objectFit: 'cover', border: `4px solid ${COR.destaque}` }} />
            </div>
          )}
        </div>
      </section>

      {/* ---------- destaques ---------- */}
      {destaques.length > 0 && (
        <section style={{ maxWidth: 1100, margin: '0 auto', padding: '48px 20px' }}>
          <h2 style={{ fontSize: 22, marginBottom: 18 }}>Imóveis em destaque</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 18 }}>
            {destaques.map(im => <CartaoImovel key={im.id} imovel={im} />)}
          </div>
        </section>
      )}

      {/* ---------- serviços ---------- */}
      <section style={{ maxWidth: 1100, margin: '0 auto', padding: '48px 20px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 18 }}>
          {[
            { titulo: 'Imóveis próprios', desc: 'Imóveis à venda e para locação, com atendimento direto.', href: '/corretor/imoveis' },
            { titulo: 'Parcerias', desc: 'Divulgação em conjunto com outros corretores e imobiliárias.', href: '/corretor/parcerias' },
            { titulo: 'Anúncios de terceiros', desc: 'Espaço para anunciantes parceiros do site.', href: '/corretor/anuncios' },
            { titulo: 'Avaliação de imóveis', desc: 'Avaliação técnica por corretor avaliador (CNAI ' + perfil.cnai + ').', href: '/corretor/avaliacao' },
          ].map(c => (
            <Link key={c.href} href={c.href} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div style={{ background: COR.branco, border: `1px solid ${COR.borda}`, borderRadius: 12, padding: 20, height: '100%' }}>
                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6, color: COR.escuro }}>{c.titulo}</div>
                <div style={{ fontSize: 13.5, color: COR.textoSuave, lineHeight: 1.5 }}>{c.desc}</div>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
