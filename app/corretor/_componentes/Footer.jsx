import Link from 'next/link'
import { COR } from './tema'
import { buscarPerfil } from './dados'

export default async function Footer() {
  const perfil = await buscarPerfil()
  const zap = (perfil.whatsapp || '').replace(/\D/g, '')

  return (
    <footer style={{ background: COR.escuro, color: '#C9C4B5', marginTop: 48 }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 20px', display: 'flex', flexWrap: 'wrap', gap: 24, justifyContent: 'space-between' }}>
        <div style={{ maxWidth: 360 }}>
          <div style={{ color: COR.branco, fontWeight: 700, fontSize: 17, marginBottom: 6 }}>{perfil.nome} Imóveis</div>
          <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>
            {perfil.titulo} · CRECI {perfil.creci} · CNAI {perfil.cnai}
          </div>
        </div>
        <div style={{ fontSize: 13.5, lineHeight: 2 }}>
          {perfil.email && <div>{perfil.email}</div>}
          {perfil.telefone && <div>{perfil.telefone}</div>}
          {zap && <div><a href={`https://wa.me/55${zap}`} style={{ color: COR.destaque }} target="_blank" rel="noreferrer">Falar no WhatsApp</a></div>}
          {perfil.instagram && <div>{perfil.instagram}</div>}
        </div>
      </div>
      <div style={{ borderTop: '1px solid #33392F', textAlign: 'center', fontSize: 11.5, padding: '12px 20px', color: '#8A8B7E' }}>
        © {new Date().getFullYear()} {perfil.nome} — CRECI {perfil.creci} · Corretor e Avaliador de Imóveis (CNAI {perfil.cnai}) ·{' '}
        <Link href="/corretor/admin" style={{ color: '#8A8B7E' }}>painel</Link>
      </div>
    </footer>
  )
}
