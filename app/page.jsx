'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'

export default function Login() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { if (data.session) router.push('/painel') })
  }, [router])

  async function entrar(e) {
    e.preventDefault()
    setErro(''); setCarregando(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
    setCarregando(false)
    if (error) setErro('E-mail ou senha inválidos.')
    else router.push('/painel')
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
      <form onSubmit={entrar} style={{ background: '#fff', padding: 32, borderRadius: 14, width: 360, boxShadow: '0 8px 30px rgba(0,0,0,.08)' }}>
        <div style={{ fontSize: 26, fontWeight: 800, color: '#1e293b' }}>CMP<span style={{ color: '#c8a24a' }}>Gestão</span></div>
        <div style={{ fontSize: 13, color: '#64748b', marginBottom: 22 }}>Acesse o painel do seu escritório</div>
        <label style={{ fontSize: 12, color: '#64748b' }}>E-mail</label>
        <input value={email} onChange={e => setEmail(e.target.value)} type="email" required
          style={{ width: '100%', padding: 10, margin: '4px 0 14px', border: '1px solid #cbd5e1', borderRadius: 8, boxSizing: 'border-box' }} />
        <label style={{ fontSize: 12, color: '#64748b' }}>Senha</label>
        <input value={senha} onChange={e => setSenha(e.target.value)} type="password" required
          style={{ width: '100%', padding: 10, margin: '4px 0 18px', border: '1px solid #cbd5e1', borderRadius: 8, boxSizing: 'border-box' }} />
        {erro && <div style={{ color: '#b91c1c', fontSize: 13, marginBottom: 12 }}>{erro}</div>}
        <button disabled={carregando} type="submit"
          style={{ width: '100%', padding: 11, background: '#1e293b', color: '#fff', border: 0, borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}>
          {carregando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}
