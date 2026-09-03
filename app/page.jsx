'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// Porta única do sistema. O endereço decide a marca: quem abre pelo domínio do
// próprio escritório vê o nome dele, não o de quem vendeu o sistema. Endereço
// desconhecido cai na marca neutra — nunca na marca de outro escritório.
const NAVY = '#2E3A4B'
const GOLD = '#C9A227'

export default function Login() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)
  const [marca, setMarca] = useState(null)      // null enquanto não sabemos de quem é o endereço
  const [trocar, setTrocar] = useState(false)   // senha provisória: precisa trocar antes de entrar
  const [nova, setNova] = useState('')
  const [nova2, setNova2] = useState('')

  // Depois do login: a pessoa é DESTE endereço? Precisa trocar a senha?
  const depoisDoLogin = useCallback(async (marcaAtual) => {
    const { data: s } = await supabase.auth.getSession()
    if (!s.session) return
    const { data: perfil } = await supabase
      .from('usuarios').select('escritorio_id,trocar_senha').eq('id', s.session.user.id).maybeSingle()

    // Entrar pela porta de outro escritório não pode dar certo nem por engano:
    // seria a pessoa de um escritório aterrissando na marca (e na expectativa)
    // de outro. Só vale quando o endereço é conhecido; endereço novo/ainda não
    // cadastrado segue funcionando como porta comum.
    if (marcaAtual && marcaAtual.conhecido && perfil && perfil.escritorio_id !== marcaAtual.escritorio_id) {
      await supabase.auth.signOut()
      setErro('Esta conta não pertence a ' + marcaAtual.host + '. Use o endereço do seu escritório.')
      return
    }
    if (marcaAtual && marcaAtual.conhecido && marcaAtual.ativo === false) {
      await supabase.auth.signOut()
      setErro('O acesso deste escritório está suspenso. Fale com o responsável pelo contrato.')
      return
    }
    if (perfil && perfil.trocar_senha) { setTrocar(true); return }
    window.location.href = '/sistema.html'
  }, [])

  useEffect(() => {
    let vivo = true
    fetch('/api/inquilino').then(r => r.json()).then(d => {
      if (!vivo) return
      const m = d && d.ok ? d : { conhecido: false }
      setMarca(m)
      supabase.auth.getSession().then(({ data }) => { if (data.session) depoisDoLogin(m) })
    }).catch(() => { if (vivo) setMarca({ conhecido: false }) })
    return () => { vivo = false }
  }, [depoisDoLogin])

  async function entrar(e) {
    e.preventDefault()
    setErro(''); setCarregando(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
    setCarregando(false)
    if (error) { setErro('E-mail ou senha inválidos.'); return }
    await depoisDoLogin(marca)
  }

  async function definirSenha(e) {
    e.preventDefault()
    setErro('')
    if (nova.length < 8) { setErro('A senha precisa de pelo menos 8 caracteres.'); return }
    if (nova !== nova2) { setErro('As duas senhas não são iguais.'); return }
    setCarregando(true)
    const { data: s } = await supabase.auth.getSession()
    const r = await fetch('/api/trocar-senha', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.session.access_token },
      body: JSON.stringify({ senha: nova }),
    })
    const d = await r.json().catch(() => ({}))
    setCarregando(false)
    if (!r.ok || d.erro) { setErro(d.erro || 'Não consegui trocar a senha.'); return }
    window.location.href = '/sistema.html'
  }

  // Marca da tela: do escritório do endereço; na dúvida, neutra.
  const ehRaiz = !!(marca && marca.raiz)
  const nomeSistema = (marca && marca.marca && marca.marca.sistema) || (ehRaiz ? 'CMPGestão' : 'Gestão')
  const nomeEscritorio = (marca && marca.conhecido && marca.nome) || ''
  const logo = (marca && marca.marca && marca.marca.logo) || (ehRaiz ? '/logo_cmp_full.png' : null)
  const cor = (marca && marca.marca && marca.marca.cor) || NAVY

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f3f5f8' }}>
      <form onSubmit={trocar ? definirSenha : entrar}
        style={{ background: '#fff', padding: 32, borderRadius: 16, width: 380, boxShadow: '0 8px 30px rgba(46,58,75,.10)', border: '1px solid #e4e8ef', textAlign: 'center' }}>

        {logo
          ? <img src={logo} alt={nomeEscritorio || nomeSistema} style={{ width: 240, maxWidth: '100%', margin: '0 auto 6px', display: 'block' }} />
          : <div style={{ fontSize: 17, fontWeight: 700, color: cor, marginBottom: 4 }}>{nomeEscritorio || ' '}</div>}

        <div style={{ fontSize: 15, fontWeight: 700, color: cor }}>
          {ehRaiz ? <>CMP<span style={{ color: GOLD }}>Gestão</span></> : nomeSistema}
        </div>

        {trocar ? (
          <>
            <div style={{ fontSize: 13, color: '#697180', margin: '6px 0 22px' }}>
              Você entrou com uma senha provisória. Defina agora a sua senha.
            </div>
            <label style={{ fontSize: 12, color: '#697180', display: 'block', textAlign: 'left' }}>Nova senha</label>
            <input value={nova} onChange={e => setNova(e.target.value)} type="password" autoComplete="new-password" required
              style={{ width: '100%', padding: 10, margin: '4px 0 14px', border: '1px solid #e4e8ef', borderRadius: 8, boxSizing: 'border-box' }} />
            <label style={{ fontSize: 12, color: '#697180', display: 'block', textAlign: 'left' }}>Repita a nova senha</label>
            <input value={nova2} onChange={e => setNova2(e.target.value)} type="password" autoComplete="new-password" required
              style={{ width: '100%', padding: 10, margin: '4px 0 18px', border: '1px solid #e4e8ef', borderRadius: 8, boxSizing: 'border-box' }} />
          </>
        ) : (
          <>
            <div style={{ fontSize: 13, color: '#697180', marginBottom: 22 }}>Acesse o painel do seu escritório</div>
            <label style={{ fontSize: 12, color: '#697180', display: 'block', textAlign: 'left' }}>E-mail</label>
            <input value={email} onChange={e => setEmail(e.target.value)} type="email" name="email" id="email" autoComplete="username" required
              style={{ width: '100%', padding: 10, margin: '4px 0 14px', border: '1px solid #e4e8ef', borderRadius: 8, boxSizing: 'border-box' }} />
            <label style={{ fontSize: 12, color: '#697180', display: 'block', textAlign: 'left' }}>Senha</label>
            <input value={senha} onChange={e => setSenha(e.target.value)} type="password" name="password" id="password" autoComplete="current-password" required
              style={{ width: '100%', padding: 10, margin: '4px 0 18px', border: '1px solid #e4e8ef', borderRadius: 8, boxSizing: 'border-box' }} />
          </>
        )}

        {erro && <div style={{ color: '#b5342b', fontSize: 13, marginBottom: 12, textAlign: 'left' }}>{erro}</div>}

        <button disabled={carregando} type="submit"
          style={{ width: '100%', padding: 12, background: cor, color: '#fff', border: 0, borderRadius: 8, fontWeight: 700, cursor: 'pointer', fontSize: 15 }}>
          {carregando ? 'Aguarde…' : (trocar ? 'Salvar e entrar' : 'Entrar')}
        </button>

        {/* O Portal do Cliente é do escritório dono do sistema. Num endereço de
            outro escritório essa porta não existe (ainda), e oferecer levaria o
            cliente dele para o portal errado. */}
        {!trocar && ehRaiz && (
          <div style={{ fontSize: 11.5, color: '#697180', marginTop: 14 }}>
            Cliente do escritório? Acompanhe seus processos no <a href="/portal.html" style={{ color: NAVY, fontWeight: 600 }}>Portal do Cliente</a>.
          </div>
        )}
      </form>
    </div>
  )
}
