'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

export default function Painel() {
  const router = useRouter()
  const [processos, setProcessos] = useState([])
  const [numero, setNumero] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const carregar = useCallback(async () => {
    const { data } = await supabase.from('processos').select('*').order('ultima_movimentacao', { ascending: false })
    setProcessos(data || [])
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) { router.push('/'); return }
      carregar()
    })
  }, [router, carregar])

  async function cadastrarPorNumero(e) {
    e.preventDefault()
    if (!numero.trim()) return
    setBusy(true); setMsg('Consultando o DataJud…')
    try {
      const r = await fetch('/api/processo?numero=' + encodeURIComponent(numero.trim()))
      const d = await r.json()
      if (d.erro) { setMsg('Não deu para preencher automático: ' + d.erro + ' — cadastrado mesmo assim.') }
      const { data: userData } = await supabase.auth.getUser()
      const { data: perfil } = await supabase.from('usuarios').select('escritorio_id').eq('id', userData.user.id).single()
      const { error } = await supabase.from('processos').insert({
        escritorio_id: perfil?.escritorio_id,
        numero: numero.trim(),
        classe: d.classe || null,
        assunto: d.assunto || null,
        orgao: d.orgao || null,
        ultima_movimentacao: d.andamentos?.[0]?.data ? d.andamentos[0].data.slice(0, 10) : null,
        fonte: 'datajud',
      })
      if (error) { setMsg('Erro ao salvar: ' + error.message) }
      else { setMsg(d.erro ? 'Cadastrado (andamentos virão depois).' : 'Cadastrado! ' + d.totalAndamentos + ' andamentos encontrados.'); setNumero(''); carregar() }
    } catch (err) {
      setMsg('Falha: ' + err.message)
    }
    setBusy(false)
  }

  async function sair() { await supabase.auth.signOut(); router.push('/') }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 22, fontWeight: 800 }}>CMP<span style={{ color: '#c8a24a' }}>Gestão</span> · Processos</div>
        <button onClick={sair} style={{ border: '1px solid #cbd5e1', background: '#fff', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>Sair</button>
      </div>

      <form onSubmit={cadastrarPorNumero} style={{ display: 'flex', gap: 8, margin: '18px 0', background: '#fff', padding: 14, borderRadius: 12 }}>
        <input value={numero} onChange={e => setNumero(e.target.value)} placeholder="Cadastrar por número (ex.: 0816640-57.2026.8.15.2001)"
          style={{ flex: 1, padding: 10, border: '1px solid #cbd5e1', borderRadius: 8 }} />
        <button disabled={busy} type="submit" style={{ padding: '10px 16px', background: '#1e293b', color: '#fff', border: 0, borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}>
          {busy ? 'Buscando…' : '+ Cadastrar'}
        </button>
      </form>
      {msg && <div style={{ fontSize: 13, color: '#475569', marginBottom: 12 }}>{msg}</div>}

      <div style={{ background: '#fff', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ fontSize: 13, color: '#64748b', padding: '10px 14px', borderBottom: '1px solid #eef2f7' }}>{processos.length} processos</div>
        {processos.map(p => (
          <div key={p.id} style={{ padding: '12px 14px', borderBottom: '1px solid #f1f5f9' }}>
            <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#64748b' }}>{p.numero}</div>
            <div style={{ fontWeight: 600 }}>{p.cliente_nome || 'Cliente a confirmar'} <span style={{ color: '#94a3b8', fontWeight: 400 }}>× {p.oponente || '—'}</span></div>
            <div style={{ fontSize: 13, color: '#475569' }}>{p.assunto || p.classe || '—'} · {p.orgao || ''}</div>
          </div>
        ))}
        {processos.length === 0 && <div style={{ padding: 20, color: '#94a3b8' }}>Nenhum processo ainda. Cadastre pelo número acima.</div>}
      </div>
    </div>
  )
}
