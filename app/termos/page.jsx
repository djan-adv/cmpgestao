// A página pública do termo.
//
// Endereço fixo e legível (/termos) porque ele precisa continuar acessível
// depois — por quem aceitou, por quem vai discutir o que aceitou, e por quem
// só quer ler antes de se cadastrar. Termo que só existe dentro de um modal na
// hora do clique é termo que ninguém consegue reler.

import { TERMO, VERSAO_TERMO, FORNECEDOR } from '../../lib/termo-uso.js'

export const metadata = {
  title: 'Termo de Uso e Tratamento de Dados — GestãoJurídica',
}

const NAVY = '#2E3A4B'
const GOLD = '#C9A227'

export default function Termos() {
  return (
    <div style={{ background: '#fff', color: '#1b2430', fontSize: 16, lineHeight: 1.65 }}>
      <header style={{ background: '#1E2A3B', color: '#fff' }}>
        <div style={{ maxWidth: 780, margin: '0 auto', padding: '18px 22px' }}>
          <a href="/" style={{ color: '#fff', textDecoration: 'none', fontWeight: 800, fontSize: 17 }}>
            Gestão<span style={{ color: GOLD }}>Jurídica</span>
          </a>
        </div>
      </header>

      <main style={{ maxWidth: 780, margin: '0 auto', padding: '34px 22px 60px' }}>
        <h1 style={{ fontSize: 27, margin: '0 0 6px', color: NAVY }}>
          Termo de Uso e de Tratamento de Dados
        </h1>
        <p style={{ color: '#697180', fontSize: 14, margin: '0 0 26px' }}>
          Versão {VERSAO_TERMO} · {FORNECEDOR.nome} — {FORNECEDOR.papel} ·{' '}
          <a href={'mailto:' + FORNECEDOR.email} style={{ color: NAVY }}>{FORNECEDOR.email}</a>
        </p>

        {TERMO.map((s) => (
          <section key={s.t} style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 17.5, color: NAVY, margin: '0 0 8px' }}>{s.t}</h2>
            {s.p.map((par, i) => (
              <p key={i} style={{ margin: '0 0 10px' }}>{par}</p>
            ))}
          </section>
        ))}

        <p style={{ color: '#697180', fontSize: 13.5, borderTop: '1px solid #e4e8ef', paddingTop: 16 }}>
          Guarde este endereço: o texto tem versão, e é esta versão que fica registrada no seu aceite.
        </p>
      </main>
    </div>
  )
}
