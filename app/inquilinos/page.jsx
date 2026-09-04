'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'

// Painel-mãe: os escritórios que contratam o sistema.
// Só abre para quem é do escritório raiz — a própria API recusa os demais, esta
// tela só evita mostrar a porta a quem não vai conseguir entrar.

const NAVY = '#2E3A4B'
const cardStyle = { background: '#fff', border: '1px solid #e4e8ef', borderRadius: 12, padding: 16, marginBottom: 14 }
const inputStyle = { width: '100%', padding: 9, border: '1px solid #cbd5e1', borderRadius: 8, boxSizing: 'border-box', fontSize: 14 }
const rotulo = { fontSize: 12, color: '#697180', display: 'block', marginBottom: 3 }

export default function Inquilinos() {
  const [lista, setLista] = useState([])
  const [carregando, setCarregando] = useState(true)
  const [semPermissao, setSemPermissao] = useState(false)
  const [erro, setErro] = useState('')
  const [criado, setCriado] = useState(null)
  const [salvando, setSalvando] = useState(false)
  const [f, setF] = useState({
    nome: '', host: '', nome_contratante: '', email_contratante: '',
    plano: 'teste', limite_acessos: '', limite_processos: '', limite_gb: '',
  })

  const api = useCallback(async (corpo) => {
    const { data: s } = await supabase.auth.getSession()
    if (!s.session) { window.location.href = '/'; return {} }
    const r = await fetch('/api/escritorios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.session.access_token },
      body: JSON.stringify(corpo),
    })
    const d = await r.json().catch(() => ({}))
    // 401 é sessão vencida — a tela ficou aberta e o acesso caducou. Mandar de
    // volta ao login resolve; dizer "esta tela não é sua" mandaria a pessoa
    // procurar um problema que não existe.
    if (r.status === 401) { window.location.href = '/'; return {} }
    if (r.status === 403) setSemPermissao(true)
    return d
  }, [])

  const carregar = useCallback(async () => {
    setCarregando(true)
    const d = await api({ acao: 'listar' })
    if (d.escritorios) setLista(d.escritorios)
    setCarregando(false)
  }, [api])

  useEffect(() => { carregar() }, [carregar])

  async function criar(e) {
    e.preventDefault()
    setErro(''); setCriado(null); setSalvando(true)
    const corpo = {
      acao: 'criar',
      nome: f.nome, host: f.host,
      nome_contratante: f.nome_contratante, email_contratante: f.email_contratante,
      plano: f.plano,
      // vazio = sem limite. É assim que os primeiros clientes recebem o sistema
      // inteiro sem que isso vire uma exceção escrita no código.
      limite_acessos: f.limite_acessos === '' ? null : f.limite_acessos,
      limite_processos: f.limite_processos === '' ? null : f.limite_processos,
      limite_gb: f.limite_gb === '' ? null : f.limite_gb,
    }
    const d = await api(corpo)
    setSalvando(false)
    if (d.erro) { setErro(d.erro); return }
    setCriado(d)
    setF({ nome: '', host: '', nome_contratante: '', email_contratante: '', plano: 'teste', limite_acessos: '', limite_processos: '', limite_gb: '' })
    carregar()
  }

  if (semPermissao) {
    return <div style={{ padding: 40, fontFamily: 'system-ui', color: '#475569' }}>
      Esta tela é do escritório que administra o sistema.
    </div>
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 24, fontFamily: 'system-ui, Segoe UI, Arial, sans-serif', color: '#22303f' }}>
      <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 18 }}>Escritórios</div>

      <form onSubmit={criar} style={cardStyle}>
        <div style={{ fontWeight: 700, marginBottom: 12 }}>Novo escritório</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={rotulo}>Nome do escritório</label>
            <input style={inputStyle} value={f.nome} onChange={e => setF({ ...f, nome: e.target.value })} required />
          </div>
          <div>
            <label style={rotulo}>Endereço (o cliente entra por aqui)</label>
            <input style={inputStyle} value={f.host} onChange={e => setF({ ...f, host: e.target.value })}
              placeholder="jose.djan.app.br" required />
          </div>
          <div>
            <label style={rotulo}>Nome do contratante</label>
            <input style={inputStyle} value={f.nome_contratante} onChange={e => setF({ ...f, nome_contratante: e.target.value })} required />
          </div>
          <div>
            <label style={rotulo}>E-mail do contratante</label>
            <input style={inputStyle} type="email" value={f.email_contratante} onChange={e => setF({ ...f, email_contratante: e.target.value })} required />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginTop: 12 }}>
          <div>
            <label style={rotulo}>Plano</label>
            <input style={inputStyle} value={f.plano} onChange={e => setF({ ...f, plano: e.target.value })} />
          </div>
          <div>
            <label style={rotulo}>Acessos</label>
            <input style={inputStyle} type="number" min="1" value={f.limite_acessos}
              onChange={e => setF({ ...f, limite_acessos: e.target.value })} placeholder="sem limite" />
          </div>
          <div>
            <label style={rotulo}>Processos</label>
            <input style={inputStyle} type="number" min="1" value={f.limite_processos}
              onChange={e => setF({ ...f, limite_processos: e.target.value })} placeholder="sem limite" />
          </div>
          <div>
            <label style={rotulo}>Documentos (GB)</label>
            <input style={inputStyle} type="number" min="1" step="1" value={f.limite_gb}
              onChange={e => setF({ ...f, limite_gb: e.target.value })} placeholder="sem limite" />
          </div>
        </div>

        <div style={{ fontSize: 12, color: '#697180', marginTop: 10 }}>
          Campo de limite em branco = sem limite. O contratante recebe a senha provisória por e-mail
          e define a senha dele no primeiro acesso. Envio de e-mail e WhatsApp nascem desligados:
          as contas de envio são as do sistema, e nada sai em nome de terceiros até o escritório
          cadastrar as próprias.
        </div>

        {erro && <div style={{ color: '#b5342b', fontSize: 13, marginTop: 10 }}>{erro}</div>}

        <button disabled={salvando} type="submit"
          style={{ marginTop: 14, padding: '10px 18px', background: NAVY, color: '#fff', border: 0, borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>
          {salvando ? 'Criando…' : 'Criar escritório'}
        </button>
      </form>

      {criado && (
        <div style={{ ...cardStyle, borderColor: '#bfe3c6', background: '#f3fbf5' }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>{criado.escritorio.nome} criado</div>
          <div style={{ fontSize: 14 }}>Contratante: {criado.contratante.nome} · {criado.contratante.email}</div>
          <div style={{ fontSize: 14, marginTop: 8 }}>
            Senha provisória: <b style={{ fontFamily: 'ui-monospace, monospace', fontSize: 17, letterSpacing: 1 }}>{criado.senha_provisoria}</b>
          </div>
          <div style={{ fontSize: 12.5, color: '#4b6b53', marginTop: 8 }}>
            {criado.email_enviado
              ? 'A senha foi enviada por e-mail. Ela aparece aqui porque o e-mail pode demorar ou cair no spam — anote agora, esta tela não guarda a senha.'
              : 'O e-mail NÃO saiu (' + (criado.email_erro || 'motivo não informado') + '). Entregue a senha por outro meio: ela não é recuperável depois que você sair desta tela.'}
          </div>
        </div>
      )}

      <div style={cardStyle}>
        <div style={{ fontWeight: 700, marginBottom: 10 }}>{lista.length} escritório(s)</div>
        {carregando && <div style={{ color: '#94a3b8', fontSize: 14 }}>Carregando…</div>}
        {lista.map(e => (
          <div key={e.id} style={{ padding: '10px 0', borderTop: '1px solid #f1f5f9' }}>
            <div style={{ fontWeight: 600 }}>
              {e.nome} {e.raiz && <span style={{ fontSize: 11, color: '#697180', fontWeight: 400 }}>· administra o sistema</span>}
              {e.ativo === false && <span style={{ fontSize: 11, color: '#b5342b', fontWeight: 600 }}> · suspenso</span>}
            </div>
            <div style={{ fontSize: 12.5, color: '#697180' }}>
              {(e.hosts || []).join(' · ') || 'sem endereço'} · plano {e.plano}
            </div>
            <div style={{ fontSize: 12.5, color: '#475569', marginTop: 2 }}>
              acessos {e.uso ? e.uso.acessos : '—'}{e.limite_acessos ? '/' + e.limite_acessos : ' (sem limite)'}
              {' · '}
              processos {e.uso ? e.uso.processos : '—'}{e.limite_processos ? '/' + e.limite_processos : ' (sem limite)'}
              {e.limite_gb ? ' · até ' + e.limite_gb + ' GB' : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
