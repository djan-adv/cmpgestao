import { COR } from '../_componentes/tema'
import { buscarImoveis } from '../_componentes/dados'
import CartaoImovel from '../_componentes/CartaoImovel'
import LeadForm from '../_componentes/LeadForm'

export default async function PaginaParcerias() {
  const imoveis = await buscarImoveis({ tipo: 'parceria' })

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 20px' }}>
      <h1 style={{ fontSize: 26, marginBottom: 6 }}>Parcerias</h1>
      <p style={{ color: COR.textoSuave, fontSize: 14.5, marginBottom: 28, maxWidth: 620, lineHeight: 1.6 }}>
        Trabalho em parceria com outros corretores e imobiliárias, divulgando imóveis
        em conjunto com comissão compartilhada. Se você tem um imóvel para divulgar em
        parceria ou quer propor uma parceria, entre em contato.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) minmax(280px,1fr)', gap: 32, alignItems: 'start' }}>
        <div>
          {imoveis.length === 0 ? (
            <div style={{ color: COR.textoSuave, fontSize: 14.5 }}>Nenhum imóvel de parceria publicado no momento.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 18 }}>
              {imoveis.map(im => <CartaoImovel key={im.id} imovel={im} />)}
            </div>
          )}
        </div>

        <aside style={{ background: COR.branco, border: `1px solid ${COR.borda}`, borderRadius: 12, padding: 20 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 10 }}>Propor uma parceria</div>
          <LeadForm tipo="parceria" tituloBotao="Enviar proposta" mensagemPlaceholder="Conte um pouco sobre o imóvel ou a parceria que você propõe." />
        </aside>
      </div>
    </div>
  )
}
