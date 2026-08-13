import Link from 'next/link'
import { COR } from './tema'

function precoFmt(v) {
  if (v === null || v === undefined) return null
  const n = Number(v)
  if (isNaN(n)) return null
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

export default function CartaoImovel({ imovel }) {
  const foto = Array.isArray(imovel.fotos) && imovel.fotos.length ? imovel.fotos[0] : null
  const preco = precoFmt(imovel.preco)
  const local = [imovel.bairro, imovel.cidade].filter(Boolean).join(', ')

  return (
    <Link href={`/corretor/imoveis/${imovel.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
      <div style={{ background: COR.branco, border: `1px solid ${COR.borda}`, borderRadius: 12, overflow: 'hidden', height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ aspectRatio: '4 / 3', background: COR.fundoAlt, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          {foto
            ? <img src={foto} alt={imovel.titulo} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <span style={{ color: COR.textoSuave, fontSize: 13 }}>Sem foto</span>}
        </div>
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: COR.destaque, textTransform: 'uppercase', letterSpacing: 0.4 }}>
              {imovel.finalidade === 'aluguel' ? 'Aluguel' : 'Venda'}
            </span>
            {imovel.tipo === 'parceria' && (
              <span style={{ fontSize: 11, fontWeight: 700, color: COR.textoSuave, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                · Parceria
              </span>
            )}
          </div>
          <div style={{ fontWeight: 700, fontSize: 15.5, color: COR.texto }}>{imovel.titulo}</div>
          {local && <div style={{ fontSize: 13, color: COR.textoSuave }}>{local}</div>}
          <div style={{ fontSize: 12.5, color: COR.textoSuave, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {imovel.quartos != null && <span>{imovel.quartos} qto(s)</span>}
            {imovel.vagas != null && <span>{imovel.vagas} vaga(s)</span>}
            {imovel.area_util != null && <span>{Number(imovel.area_util)} m²</span>}
          </div>
          {preco && <div style={{ marginTop: 'auto', fontWeight: 700, fontSize: 16, color: COR.escuro }}>{preco}</div>}
        </div>
      </div>
    </Link>
  )
}
