import { COR } from '../_componentes/tema'
import LeadForm from '../_componentes/LeadForm'

export const metadata = { title: 'Certidão do Imóvel — Djan Imóveis' }

export default function PaginaCertidao() {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '40px 20px' }}>
      <h1 style={{ fontSize: 26, marginBottom: 6 }}>Certidão do Imóvel</h1>
      <p style={{ color: COR.textoSuave, fontSize: 14.5, marginBottom: 10, lineHeight: 1.6 }}>
        Solicite a certidão do imóvel (matrícula/ônus reais) direto com o corretor.
        Preencha o endereço abaixo — o retorno com o valor a pagar e o prazo é feito
        por telefone ou e-mail antes de qualquer cobrança.
      </p>
      <div style={{
        display: 'inline-block', background: COR.destaqueClaro, border: `1px solid ${COR.destaque}`,
        borderRadius: 20, padding: '6px 14px', fontSize: 13, fontWeight: 700, color: COR.escuro, marginBottom: 22,
      }}>
        R$ 360,00 — cobrança combinada direto com o corretor
      </div>

      <div style={{ background: COR.branco, border: `1px solid ${COR.borda}`, borderRadius: 12, padding: 24 }}>
        <LeadForm
          tipo="certidao"
          tituloBotao="Solicitar certidão"
          mensagemPlaceholder="Alguma informação adicional sobre o imóvel ou a finalidade da certidão."
          tituloEnderecoImovel="Endereço do imóvel"
        />
      </div>
    </div>
  )
}
