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
  const [planos, setPlanos] = useState([])
  const [aberto, setAberto] = useState(null)      // escritório com o painel comercial aberto
  const [faturas, setFaturas] = useState([])
  const [msg, setMsg] = useState('')
  const [f, setF] = useState({
    nome: '', host: '', nome_contratante: '', email_contratante: '',
    plano_codigo: 'full', mensalidade: '',
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
    if (d.planos) setPlanos(d.planos)
    setCarregando(false)
  }, [api])

  useEffect(() => { carregar() }, [carregar])

  async function criar(e) {
    e.preventDefault()
    setErro(''); setCriado(null); setSalvando(true)
    const p = planos.find(x => x.codigo === f.plano_codigo)
    const corpo = {
      acao: 'criar',
      nome: f.nome, host: f.host,
      nome_contratante: f.nome_contratante, email_contratante: f.email_contratante,
      plano: f.plano_codigo, plano_codigo: f.plano_codigo,
      mensalidade: f.mensalidade,
      // os limites do degrau são copiados agora: o plano pode mudar de conteúdo
      // depois sem alterar quem já assinou
      limite_acessos: p ? p.limite_acessos : null,
      limite_processos: p ? p.limite_processos : null,
      limite_gb: p ? p.limite_gb : null,
    }
    const d = await api(corpo)
    setSalvando(false)
    if (d.erro) { setErro(d.erro); return }
    setCriado(d)
    setF({ nome: '', host: '', nome_contratante: '', email_contratante: '', plano_codigo: 'full', mensalidade: '' })
    carregar()
  }

  async function acao(corpo, confirmar) {
    if (confirmar && !window.confirm(confirmar)) return
    setMsg('')
    const d = await api(corpo)
    if (d.erro) { setMsg(d.erro); return }
    if (corpo.acao === 'faturas') { setFaturas(d.faturas || []); return }
    await carregar()
    if (aberto) await acao({ acao: 'faturas', id: aberto })
  }

  async function abrirGestao(id) {
    if (aberto === id) { setAberto(null); setFaturas([]); return }
    setAberto(id); setMsg(''); setFaturas([])
    const d = await api({ acao: 'faturas', id })
    setFaturas(d.faturas || [])
  }

  const ativos = lista.filter(e => e.ativo !== false)
  const suspensos = lista.filter(e => e.ativo === false)
  const brl = (v) => v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

  function Linha({ e }) {
    const abertoAqui = aberto === e.id
    return (
      <div style={{ padding: '10px 0', borderTop: '1px solid #f1f5f9' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 600 }}>{e.nome}</div>
          {e.raiz && <span style={{ fontSize: 11, color: '#697180' }}>administra o sistema</span>}
          {e.ativo === false && <span style={{ fontSize: 11, color: '#b5342b', fontWeight: 600 }}>suspenso</span>}
          {e.pausa_ate && <span style={{ fontSize: 11, color: '#8a6d00' }}>cobrança pausada até {e.pausa_ate}</span>}
          {!e.raiz && (
            <button onClick={() => abrirGestao(e.id)}
              style={{ marginLeft: 'auto', fontSize: 12, background: 'none', border: '1px solid #cbd5e1', borderRadius: 7, padding: '3px 10px', cursor: 'pointer' }}>
              {abertoAqui ? 'fechar' : 'gerir'}
            </button>
          )}
        </div>
        <div style={{ fontSize: 12.5, color: '#697180' }}>
          {(e.hosts || []).join(' · ') || 'sem endereço'} · plano {e.plano_codigo || e.plano} · {brl(e.mensalidade)}/mês
          {e.desconto ? ' (desconto ' + brl(e.desconto) + ')' : ''}
        </div>
        <div style={{ fontSize: 12.5, color: '#475569', marginTop: 2 }}>
          acessos {e.uso ? e.uso.acessos : '—'}{e.limite_acessos ? '/' + e.limite_acessos : ' (sem limite)'}
          {' · '}
          processos {e.uso ? e.uso.processos : '—'}{e.limite_processos ? '/' + e.limite_processos : ' (sem limite)'}
          {e.limite_gb ? ' · até ' + e.limite_gb + ' GB' : ''}
        </div>
        {abertoAqui && <PainelGestao e={e} />}
      </div>
    )
  }

  function PainelGestao({ e }) {
    const [c, setC] = useState({
      plano_codigo: e.plano_codigo || '', mensalidade: e.mensalidade ?? '',
      desconto: e.desconto ?? '', pausa_ate: e.pausa_ate || '', observacoes: e.observacoes || '',
    })
    const [comp, setComp] = useState(new Date().toISOString().slice(0, 7))
    return (
      <div style={{ marginTop: 10, padding: 12, background: '#f7f9fc', border: '1px solid #e4e8ef', borderRadius: 10 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10 }}>
          <div>
            <label style={rotulo}>Plano</label>
            <select style={inputStyle} value={c.plano_codigo} onChange={ev => setC({ ...c, plano_codigo: ev.target.value })}>
              <option value="">manter</option>
              {planos.map(p => <option key={p.codigo} value={p.codigo}>{p.nome}</option>)}
            </select>
          </div>
          <div>
            <label style={rotulo}>Mensalidade</label>
            <input style={inputStyle} type="number" step="0.01" value={c.mensalidade}
              onChange={ev => setC({ ...c, mensalidade: ev.target.value })} />
          </div>
          <div>
            <label style={rotulo}>Desconto fixo</label>
            <input style={inputStyle} type="number" step="0.01" value={c.desconto}
              onChange={ev => setC({ ...c, desconto: ev.target.value })} />
          </div>
          <div>
            <label style={rotulo}>Pausar cobrança até</label>
            <input style={inputStyle} type="date" value={c.pausa_ate}
              onChange={ev => setC({ ...c, pausa_ate: ev.target.value })} />
          </div>
        </div>
        <div style={{ marginTop: 8 }}>
          <label style={rotulo}>Anotações do contrato</label>
          <input style={inputStyle} value={c.observacoes} onChange={ev => setC({ ...c, observacoes: ev.target.value })} />
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <button onClick={() => acao({ acao: 'comercial', id: e.id, ...c })}
            style={{ padding: '7px 14px', background: NAVY, color: '#fff', border: 0, borderRadius: 7, fontWeight: 600, cursor: 'pointer' }}>
            Salvar
          </button>
          {e.ativo !== false
            ? <button onClick={() => acao({ acao: 'suspender', id: e.id, motivo: c.observacoes },
                'Suspender ' + e.nome + '?\n\nNinguém do escritório consegue entrar até você reativar. O acervo fica intacto.')}
                style={{ padding: '7px 14px', background: '#fff', color: '#b5342b', border: '1px solid #e6c6c0', borderRadius: 7, cursor: 'pointer' }}>
                Suspender
              </button>
            : <button onClick={() => acao({ acao: 'reativar', id: e.id })}
                style={{ padding: '7px 14px', background: '#0F6E56', color: '#fff', border: 0, borderRadius: 7, fontWeight: 600, cursor: 'pointer' }}>
                Reativar
              </button>}
          <button onClick={() => acao({ acao: 'excluir', id: e.id },
            'Excluir ' + e.nome + ' definitivamente?\n\nSó funciona se o escritório não tiver nenhum processo. Não há como desfazer.')}
            style={{ padding: '7px 14px', background: 'none', color: '#8a8f98', border: '1px solid #e4e8ef', borderRadius: 7, cursor: 'pointer' }}>
            Excluir
          </button>
        </div>

        <div style={{ marginTop: 14, borderTop: '1px solid #e4e8ef', paddingTop: 10 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Faturas</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 8 }}>
            <div>
              <label style={rotulo}>Competência</label>
              <input style={{ ...inputStyle, width: 130 }} value={comp} onChange={ev => setComp(ev.target.value)} placeholder="2026-09" />
            </div>
            <button onClick={() => acao({ acao: 'fatura_criar', id: e.id, competencia: comp })}
              style={{ padding: '8px 14px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 7, cursor: 'pointer' }}>
              Gerar fatura
            </button>
          </div>
          {faturas.length === 0 && <div style={{ fontSize: 12.5, color: '#94a3b8' }}>Nenhuma fatura ainda.</div>}
          {faturas.map(ft => (
            <div key={ft.id} style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13, padding: '5px 0', borderTop: '1px solid #eef2f7' }}>
              <span style={{ fontFamily: 'ui-monospace, monospace' }}>{ft.competencia}</span>
              <span>{brl(ft.valor)}</span>
              <span style={{ color: '#697180' }}>vence {ft.vencimento}</span>
              <span style={{ color: ft.status === 'paga' ? '#0F6E56' : (ft.status === 'aberta' ? '#8a6d00' : '#8a8f98'), fontWeight: 600 }}>{ft.status}</span>
              {ft.status !== 'paga' && (
                <button onClick={() => acao({ acao: 'fatura_status', fatura_id: ft.id, status: 'paga' })}
                  style={{ marginLeft: 'auto', fontSize: 12, background: 'none', border: '1px solid #cbd5e1', borderRadius: 6, padding: '2px 9px', cursor: 'pointer' }}>
                  marcar paga
                </button>
              )}
            </div>
          ))}
        </div>

        {msg && <div style={{ color: '#b5342b', fontSize: 13, marginTop: 10 }}>{msg}</div>}
      </div>
    )
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

        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginTop: 12 }}>
          <div>
            <label style={rotulo}>Plano</label>
            <select style={inputStyle} value={f.plano_codigo} onChange={e => setF({ ...f, plano_codigo: e.target.value })}>
              {planos.map(p => (
                <option key={p.codigo} value={p.codigo}>
                  {p.nome} — {p.limite_processos.toLocaleString('pt-BR')} processos · {p.limite_acessos} acessos · {p.limite_gb} GB
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={rotulo}>Mensalidade (R$)</label>
            <input style={inputStyle} type="number" min="0" step="0.01" value={f.mensalidade}
              onChange={e => setF({ ...f, mensalidade: e.target.value })} placeholder="a combinar" />
          </div>
        </div>

        <div style={{ fontSize: 12, color: '#697180', marginTop: 10 }}>
          Os limites do plano são gravados no escritório agora: mudar o conteúdo de um plano depois
          não mexe em quem já assinou. O contratante recebe a senha provisória por e-mail
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
        {ativos.map(e => <Linha key={e.id} e={e} />)}
      </div>

      {/* Suspensos ficam separados, não sumidos: escritório suspenso continua
          com o acervo inteiro e volta com um clique. É a pasta que você pediu
          no lugar de excluir. */}
      {suspensos.length > 0 && (
        <div style={{ ...cardStyle, background: '#fbf7f5', borderColor: '#e8d5cf' }}>
          <div style={{ fontWeight: 700, marginBottom: 10, color: '#8a3b2b' }}>
            Suspensos ({suspensos.length})
          </div>
          {suspensos.map(e => <Linha key={e.id} e={e} />)}
        </div>
      )}
    </div>
  )
}
