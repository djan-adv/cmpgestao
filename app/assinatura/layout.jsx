'use client'
// Moldura do módulo de assinaturas: cabeçalho CMP + navegação interna.
// Exige o login do CMPGestão (mesma conta do sistema); sem sessão, volta pro login.
import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

const NAVY = '#2E3A4B'
const GOLD = '#C9A227'

export default function AssinaturaLayout({ children }) {
  const router = useRouter()
  const pathname = usePathname()
  const [pronto, setPronto] = useState(false)
  const [email, setEmail] = useState('')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { router.push('/'); return }
      setEmail(data.session.user?.email || '')
      setPronto(true)
    })
  }, [router])

  const tabs = [
    { href: '/assinatura', rotulo: '＋ Nova procuração' },
    { href: '/assinatura/avulso', rotulo: '📄 PDF avulso' },
    { href: '/assinatura/painel', rotulo: '📁 Painel' },
  ]

  if (!pronto) return <div style={{ padding: 40, textAlign: 'center', color: '#697180' }}>Carregando…</div>

  return (
    <div style={{ minHeight: '100vh', background: '#f3f5f8' }}>
      <header style={{ background: NAVY, color: '#fff', padding: '12px 22px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
        <img src="/logo_cmp_white.png" alt="CMP" style={{ height: 26 }} onError={e => { e.currentTarget.style.display = 'none' }} />
        <div style={{ fontWeight: 700, fontSize: 16 }}>CMP<span style={{ color: GOLD }}>Gestão</span> · Assinaturas</div>
        <nav style={{ display: 'flex', gap: 8, marginLeft: 10, flexWrap: 'wrap' }}>
          {tabs.map(t => (
            <a key={t.href} href={t.href} style={{
              color: '#fff', textDecoration: 'none', fontSize: 13, fontWeight: 600,
              background: pathname === t.href ? 'rgba(255,255,255,.28)' : 'rgba(255,255,255,.12)',
              padding: '6px 11px', borderRadius: 8,
            }}>{t.rotulo}</a>
          ))}
        </nav>
        <div style={{ marginLeft: 'auto', fontSize: 12, opacity: .9, display: 'flex', gap: 12, alignItems: 'center' }}>
          <span>{email}</span>
          <a href="/sistema.html" style={{ color: '#cdd9ea' }}>← voltar ao sistema</a>
        </div>
      </header>
      {children}
    </div>
  )
}
