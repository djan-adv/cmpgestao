import { COR } from '../_componentes/tema'
import { buscarTermo } from '../_componentes/dados'

export const metadata = { title: 'Termo de Autorização de Anúncio — Djan Imóveis' }

export default async function PaginaTermo() {
  const termo = await buscarTermo()

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '40px 20px' }}>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>Termo de Autorização de Anúncio e Intermediação</h1>
      <div style={{ fontSize: 12.5, color: COR.textoSuave, marginBottom: 24 }}>
        Versão {termo?.versao || 'v1'}
        {termo?.atualizado_em && ' · atualizado em ' + new Date(termo.atualizado_em).toLocaleDateString('pt-BR')}
      </div>
      {termo?.texto ? (
        <div style={{ fontSize: 14.5, lineHeight: 1.75, color: COR.texto, whiteSpace: 'pre-wrap' }}>{termo.texto}</div>
      ) : (
        <div style={{ color: COR.textoSuave, fontSize: 14.5 }}>
          O texto do termo ainda não foi cadastrado. Ele aparece aqui assim que for definido no painel administrativo.
        </div>
      )}
    </div>
  )
}
