'use client'
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

// Identidade CMP (Crispim Mendonça e Pinheiro Advogados)
// navy #2E3A4B · dourado #C9A227 · fundo #f3f5f8
const NAVY = '#2E3A4B'
const GOLD = '#C9A227'

// Marca por instância (white-label): a instância de venda define NEXT_PUBLIC_BRAND_NAME
// (e opcionalmente NEXT_PUBLIC_BRAND_LOGO) no .env.local dela; sem nada definido,
// esta tela continua exatamente a da CMP.
const BRAND_NAME = process.env.NEXT_PUBLIC_BRAND_NAME || 'CMPGestão'
const EH_CMP = BRAND_NAME === 'CMPGestão'
const BRAND_LOGO = process.env.NEXT_PUBLIC_BRAND_LOGO || (EH_CMP ? '/logo_cmp_full.png' : '')
const MOSTRA_PORTAL = EH_CMP && process.env.NEXT_PUBLIC_MOSTRAR_PORTAL !== 'nao'

export default function Login() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { if (data.session) window.location.href = '/sistema.html' })
  }, [])

  async function entrar(e) {
    e.preventDefault()
    setErro(''); setCarregando(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
    setCarregando(false)
    if (error) setErro('E-mail ou senha inválidos.')
    else window.location.href = '/sistema.html'
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f3f5f8' }}>
      <form onSubmit={entrar} style={{ background: '#fff', padding: 32, borderRadius: 16, width: 380, boxShadow: '0 8px 30px rgba(46,58,75,.10)', border: '1px solid #e4e8ef', textAlign: 'center' }}>
        {BRAND_LOGO && <img src={BRAND_LOGO} alt={BRAND_NAME} style={{ width: 240, maxWidth: '100%', margin: '0 auto 6px', display: 'block' }} />}
        {EH_CMP
          ? <div style={{ fontSize: 15, fontWeight: 700, color: NAVY }}>CMP<span style={{ color: GOLD }}>Gestão</span></div>
          : <div style={{ fontSize: 26, fontWeight: 800, color: NAVY, letterSpacing: '.3px', marginBottom: 4 }}>{BRAND_NAME}</div>}
        <div style={{ fontSize: 13, color: '#697180', marginBottom: 22 }}>Acesse o painel do seu escritório</div>
        <label style={{ fontSize: 12, color: '#697180', display: 'block', textAlign: 'left' }}>E-mail</label>
        <input value={email} onChange={e => setEmail(e.target.value)} type="email" required
          style={{ width: '100%', padding: 10, margin: '4px 0 14px', border: '1px solid #e4e8ef', borderRadius: 8, boxSizing: 'border-box' }} />
        <label style={{ fontSize: 12, color: '#697180', display: 'block', textAlign: 'left' }}>Senha</label>
        <input value={senha} onChange={e => setSenha(e.target.value)} type="password" required
          style={{ width: '100%', padding: 10, margin: '4px 0 18px', border: '1px solid #e4e8ef', borderRadius: 8, boxSizing: 'border-box' }} />
        {erro && <div style={{ color: '#b5342b', fontSize: 13, marginBottom: 12, textAlign: 'left' }}>{erro}</div>}
        <button disabled={carregando} type="submit"
          style={{ width: '100%', padding: 12, background: NAVY, color: '#fff', border: 0, borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontSize: 15 }}>
          {carregando ? 'Entrando…' : 'Entrar'}
        </button>
        {MOSTRA_PORTAL && <div style={{ fontSize: 11.5, color: '#697180', marginTop: 14 }}>
          Cliente do escritório? Acompanhe seus processos no <a href="/portal.html" style={{ color: NAVY, fontWeight: 600 }}>Portal do Cliente</a>.
        </div>}
      </form>
    </div>
  )
}
