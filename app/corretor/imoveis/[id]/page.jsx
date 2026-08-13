import { notFound } from 'next/navigation'
import { COR } from '../../_componentes/tema'
import { buscarImovel } from '../../_componentes/dados'
import LeadForm from '../../_componentes/LeadForm'

function precoFmt(v) {
  if (v === null || v === undefined) return null
  const n = Number(v)
  if (isNaN(n)) return null
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

const FICHA = [
  ['quartos', 'Quartos'],
  ['banheiros', 'Banheiros'],
  ['vagas', 'Vagas'],
  ['area_util', 'Área útil (m²)'],
  ['area_total', 'Área total (m²)'],
]

export default async function PaginaImovel({ params }) {
  const imovel = await buscarImovel(params.id)
  if (!imovel) notFound()

  const fotos = Array.isArray(imovel.fotos) ? imovel.fotos : []
  const preco = precoFmt(imovel.preco)
  const local = [imovel.endereco, imovel.bairro, imovel.cidade, imovel.uf].filter(Boolean).join(', ')

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '40px 20px', display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) minmax(280px,1fr)', gap: 32 }}>
      <div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: COR.destaque, textTransform: 'uppercase' }}>
            {imovel.finalidade === 'aluguel' ? 'Aluguel' : 'Venda'}
          </span>
          {imovel.tipo === 'parceria' && (
            <span style={{ fontSize: 11.5, fontWeight: 700, color: COR.textoSuave, textTransform: 'uppercase' }}>· Imóvel em parceria</span>
          )}
        </div>
        <h1 style={{ fontSize: 26, margin: '0 0 6px' }}>{imovel.titulo}</h1>
        {local && <div style={{ color: COR.textoSuave, fontSize: 14.5, marginBottom: 18 }}>{local}</div>}

        <div style={{ aspectRatio: '16 / 9', background: COR.fundoAlt, borderRadius: 12, overflow: 'hidden', marginBottom: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {fotos[0]
            ? <img src={fotos[0]} alt={imovel.titulo} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <span style={{ color: COR.textoSuave, fontSize: 13 }}>Sem foto</span>}
        </div>

        {fotos.length > 1 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 8, marginBottom: 18 }}>
            {fotos.slice(1).map((f, i) => (
              <img key={i} src={f} alt="" style={{ width: '100%', aspectRatio: '1 / 1', objectFit: 'cover', borderRadius: 8 }} />
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', padding: '16px 0', borderTop: `1px solid ${COR.borda}`, borderBottom: `1px solid ${COR.borda}`, marginBottom: 18 }}>
          {FICHA.filter(([chave]) => imovel[chave] != null).map(([chave, label]) => (
            <div key={chave}>
              <div style={{ fontSize: 18, fontWeight: 700, color: COR.escuro }}>{Number(imovel[chave])}</div>
              <div style={{ fontSize: 12, color: COR.textoSuave }}>{label}</div>
            </div>
          ))}
        </div>

        {imovel.descricao && <p style={{ fontSize: 15, lineHeight: 1.7, color: COR.texto, whiteSpace: 'pre-wrap' }}>{imovel.descricao}</p>}

        {imovel.tipo === 'parceria' && imovel.parceiro_nome && (
          <div style={{ marginTop: 18, fontSize: 13.5, color: COR.textoSuave }}>
            Imóvel em parceria com {imovel.parceiro_nome}
            {imovel.parceiro_contato ? ` (${imovel.parceiro_contato})` : ''}.
          </div>
        )}
      </div>

      <aside>
        <div style={{ background: COR.branco, border: `1px solid ${COR.borda}`, borderRadius: 12, padding: 20, position: 'sticky', top: 20 }}>
          {preco && <div style={{ fontSize: 22, fontWeight: 700, color: COR.escuro, marginBottom: 14 }}>{preco}</div>}
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 10 }}>Tenho interesse neste imóvel</div>
          <LeadForm tipo="imovel" imovelId={imovel.id} tituloBotao="Quero saber mais" mensagemPlaceholder="Gostaria de mais informações sobre este imóvel." />
        </div>
      </aside>
    </div>
  )
}
