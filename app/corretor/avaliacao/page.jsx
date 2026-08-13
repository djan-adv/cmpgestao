import { COR } from '../_componentes/tema'
import { buscarPerfil } from '../_componentes/dados'
import LeadForm from '../_componentes/LeadForm'

export default async function PaginaAvaliacao() {
  const perfil = await buscarPerfil()

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '40px 20px' }}>
      <h1 style={{ fontSize: 26, marginBottom: 6 }}>Avaliação de Imóveis</h1>
      <p style={{ color: COR.textoSuave, fontSize: 14.5, marginBottom: 28, lineHeight: 1.6 }}>
        Avaliação técnica de imóveis por corretor avaliador (CNAI {perfil.cnai}). Preencha
        os dados abaixo com o endereço do imóvel e a finalidade da avaliação — o retorno
        é feito por telefone ou e-mail.
      </p>

      <div style={{ background: COR.branco, border: `1px solid ${COR.borda}`, borderRadius: 12, padding: 24 }}>
        <LeadForm
          tipo="avaliacao"
          tituloBotao="Solicitar avaliação"
          mensagemPlaceholder="Finalidade da avaliação (venda, financiamento, partilha, etc.) e outras informações do imóvel."
          tituloEnderecoImovel="Endereço do imóvel a avaliar"
        />
      </div>
    </div>
  )
}
