'use client'
import { useEffect, useState } from 'react'
import { COR } from '../_componentes/tema'

const CHAVE_TOKEN = 'imoveis_admin_token'

async function chamar(acao, dados, token) {
  const r = await fetch('/api/imoveis', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify({ acao, ...dados }),
  })
  const d = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(d.erro || 'Erro na requisição.')
  return d
}

const campo = { width: '100%', padding: 10, border: `1px solid ${COR.borda}`, borderRadius: 8, boxSizing: 'border-box', fontSize: 14, fontFamily: 'inherit' }
const rotulo = { fontSize: 12, color: COR.textoSuave, display: 'block', margin: '10px 0 4px' }
const botao = { padding: '10px 16px', background: COR.escuro, color: '#fff', border: 0, borderRadius: 8, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }
const botaoSec = { ...botao, background: 'transparent', color: COR.escuro, border: `1px solid ${COR.borda}` }
const botaoPerigo = { ...botao, background: COR.erro }

export default function PainelAdmin() {
  const [token, setToken] = useState(null)
  const [pronto, setPronto] = useState(false)
  const [aba, setAba] = useState('imoveis')
  const [senha, setSenha] = useState('')
  const [erroLogin, setErroLogin] = useState('')

  useEffect(() => {
    setToken(localStorage.getItem(CHAVE_TOKEN))
    setPronto(true)
  }, [])

  async function entrar(e) {
    e.preventDefault()
    setErroLogin('')
    try {
      const d = await chamar('login', { senha })
      localStorage.setItem(CHAVE_TOKEN, d.token)
      setToken(d.token)
    } catch (e) {
      setErroLogin(e.message)
    }
  }

  function sair() {
    chamar('sair', {}, token).catch(() => {})
    localStorage.removeItem(CHAVE_TOKEN)
    setToken(null)
  }

  if (!pronto) return null

  if (!token) {
    return (
      <div style={{ minHeight: '80vh', display: 'grid', placeItems: 'center', background: COR.fundo }}>
        <form onSubmit={entrar} style={{ background: COR.branco, padding: 28, borderRadius: 12, width: 320, border: `1px solid ${COR.borda}` }}>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Painel — Djan Imóveis</div>
          <div style={{ fontSize: 12.5, color: COR.textoSuave, marginBottom: 16 }}>Acesso restrito.</div>
          <label style={rotulo}>Senha</label>
          <input style={campo} type="password" value={senha} onChange={e => setSenha(e.target.value)} required autoFocus />
          {erroLogin && <div style={{ color: COR.erro, fontSize: 13, marginTop: 8 }}>{erroLogin}</div>}
          <button type="submit" style={{ ...botao, width: '100%', marginTop: 16 }}>Entrar</button>
        </form>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '32px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {[['imoveis', 'Imóveis'], ['anuncios', 'Anúncios'], ['leads', 'Solicitações'], ['perfil', 'Perfil']].map(([v, l]) => (
            <button key={v} onClick={() => setAba(v)} style={aba === v ? botao : botaoSec}>{l}</button>
          ))}
        </div>
        <button onClick={sair} style={botaoSec}>Sair</button>
      </div>

      {aba === 'imoveis' && <AbaImoveis token={token} />}
      {aba === 'anuncios' && <AbaAnuncios token={token} />}
      {aba === 'leads' && <AbaLeads token={token} />}
      {aba === 'perfil' && <AbaPerfil token={token} />}
    </div>
  )
}

/* ================= IMÓVEIS ================= */
const IMOVEL_VAZIO = {
  tipo: 'proprio', finalidade: 'venda', titulo: '', descricao: '', categoria: '',
  preco: '', endereco: '', bairro: '', cidade: '', uf: '',
  quartos: '', banheiros: '', vagas: '', area_util: '', area_total: '',
  fotos: [], destaque: false, status: 'ativo', parceiro_nome: '', parceiro_contato: '',
}

function AbaImoveis({ token }) {
  const [lista, setLista] = useState(null)
  const [editando, setEditando] = useState(null) // null = fechado, {} = novo, {...} = edição
  const [fotosTexto, setFotosTexto] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function carregar() {
    const d = await chamar('imoveis_todos', {}, token)
    setLista(d.imoveis)
  }
  useEffect(() => { carregar() }, [])

  function abrirNovo() { setEditando({ ...IMOVEL_VAZIO }); setFotosTexto('') }
  function abrirEdicao(im) { setEditando({ ...im }); setFotosTexto((im.fotos || []).join('\n')) }

  async function salvar(e) {
    e.preventDefault()
    setSalvando(true); setErro('')
    try {
      const fotos = fotosTexto.split('\n').map(s => s.trim()).filter(Boolean)
      await chamar('imovel_salvar', { ...editando, fotos }, token)
      setEditando(null)
      await carregar()
    } catch (e) {
      setErro(e.message)
    } finally {
      setSalvando(false)
    }
  }

  async function excluir(id) {
    if (!confirm('Excluir este imóvel?')) return
    await chamar('imovel_excluir', { id }, token)
    await carregar()
  }

  if (editando) {
    const c = editando
    const upd = (k, v) => setEditando({ ...c, [k]: v })
    return (
      <form onSubmit={salvar} style={{ background: COR.branco, border: `1px solid ${COR.borda}`, borderRadius: 12, padding: 20, maxWidth: 640 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>{c.id ? 'Editar imóvel' : 'Novo imóvel'}</div>

        <label style={rotulo}>Título</label>
        <input style={campo} value={c.titulo} onChange={e => upd('titulo', e.target.value)} required />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={rotulo}>Tipo</label>
            <select style={campo} value={c.tipo} onChange={e => upd('tipo', e.target.value)}>
              <option value="proprio">Próprio</option>
              <option value="parceria">Parceria</option>
            </select>
          </div>
          <div>
            <label style={rotulo}>Finalidade</label>
            <select style={campo} value={c.finalidade} onChange={e => upd('finalidade', e.target.value)}>
              <option value="venda">Venda</option>
              <option value="aluguel">Aluguel</option>
            </select>
          </div>
        </div>

        <label style={rotulo}>Descrição</label>
        <textarea style={{ ...campo, minHeight: 80 }} value={c.descricao || ''} onChange={e => upd('descricao', e.target.value)} />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={rotulo}>Categoria (apto, casa, terreno...)</label>
            <input style={campo} value={c.categoria || ''} onChange={e => upd('categoria', e.target.value)} />
          </div>
          <div>
            <label style={rotulo}>Preço (R$)</label>
            <input style={campo} type="number" value={c.preco} onChange={e => upd('preco', e.target.value)} />
          </div>
        </div>

        <label style={rotulo}>Endereço</label>
        <input style={campo} value={c.endereco || ''} onChange={e => upd('endereco', e.target.value)} />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <div><label style={rotulo}>Bairro</label><input style={campo} value={c.bairro || ''} onChange={e => upd('bairro', e.target.value)} /></div>
          <div><label style={rotulo}>Cidade</label><input style={campo} value={c.cidade || ''} onChange={e => upd('cidade', e.target.value)} /></div>
          <div><label style={rotulo}>UF</label><input style={campo} value={c.uf || ''} onChange={e => upd('uf', e.target.value)} maxLength={2} /></div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          <div><label style={rotulo}>Quartos</label><input style={campo} type="number" value={c.quartos} onChange={e => upd('quartos', e.target.value)} /></div>
          <div><label style={rotulo}>Banheiros</label><input style={campo} type="number" value={c.banheiros} onChange={e => upd('banheiros', e.target.value)} /></div>
          <div><label style={rotulo}>Vagas</label><input style={campo} type="number" value={c.vagas} onChange={e => upd('vagas', e.target.value)} /></div>
          <div><label style={rotulo}>Área útil</label><input style={campo} type="number" value={c.area_util} onChange={e => upd('area_util', e.target.value)} /></div>
          <div><label style={rotulo}>Área total</label><input style={campo} type="number" value={c.area_total} onChange={e => upd('area_total', e.target.value)} /></div>
        </div>

        <label style={rotulo}>Fotos (uma URL por linha — a primeira é a capa)</label>
        <textarea style={{ ...campo, minHeight: 70 }} value={fotosTexto} onChange={e => setFotosTexto(e.target.value)} placeholder="https://..." />

        {c.tipo === 'parceria' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div><label style={rotulo}>Nome do parceiro</label><input style={campo} value={c.parceiro_nome || ''} onChange={e => upd('parceiro_nome', e.target.value)} /></div>
            <div><label style={rotulo}>Contato do parceiro</label><input style={campo} value={c.parceiro_contato || ''} onChange={e => upd('parceiro_contato', e.target.value)} /></div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={rotulo}>Status</label>
            <select style={campo} value={c.status} onChange={e => upd('status', e.target.value)}>
              <option value="ativo">Ativo</option>
              <option value="inativo">Inativo</option>
              <option value="vendido">Vendido</option>
              <option value="alugado">Alugado</option>
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 10 }}>
            <label style={{ fontSize: 13.5, display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={!!c.destaque} onChange={e => upd('destaque', e.target.checked)} />
              Destacar na página inicial
            </label>
          </div>
        </div>

        {erro && <div style={{ color: COR.erro, fontSize: 13, marginTop: 8 }}>{erro}</div>}
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button type="submit" disabled={salvando} style={botao}>{salvando ? 'Salvando…' : 'Salvar'}</button>
          <button type="button" style={botaoSec} onClick={() => setEditando(null)}>Cancelar</button>
        </div>
      </form>
    )
  }

  return (
    <div>
      <button style={{ ...botao, marginBottom: 16 }} onClick={abrirNovo}>+ Novo imóvel</button>
      {!lista ? <div>Carregando…</div> : lista.length === 0 ? <div style={{ color: COR.textoSuave }}>Nenhum imóvel cadastrado.</div> : (
        <div style={{ display: 'grid', gap: 10 }}>
          {lista.map(im => (
            <div key={im.id} style={{ background: COR.branco, border: `1px solid ${COR.borda}`, borderRadius: 10, padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <div>
                <div style={{ fontWeight: 700 }}>{im.titulo}</div>
                <div style={{ fontSize: 12.5, color: COR.textoSuave }}>{im.tipo} · {im.finalidade} · {im.status}</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={botaoSec} onClick={() => abrirEdicao(im)}>Editar</button>
                <button style={botaoPerigo} onClick={() => excluir(im.id)}>Excluir</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ================= ANÚNCIOS ================= */
const ANUNCIO_VAZIO = { titulo: '', descricao: '', link_externo: '', imagem_url: '', anunciante_nome: '', anunciante_contato: '', ativo: true }

function AbaAnuncios({ token }) {
  const [lista, setLista] = useState(null)
  const [editando, setEditando] = useState(null)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function carregar() {
    const r = await fetch('/api/imoveis?secao=anuncios')
    const d = await r.json()
    setLista(d.anuncios || [])
  }
  useEffect(() => { carregar() }, [])

  async function salvar(e) {
    e.preventDefault()
    setSalvando(true); setErro('')
    try {
      await chamar('anuncio_salvar', editando, token)
      setEditando(null)
      await carregar()
    } catch (e) {
      setErro(e.message)
    } finally {
      setSalvando(false)
    }
  }

  async function excluir(id) {
    if (!confirm('Excluir este anúncio?')) return
    await chamar('anuncio_excluir', { id }, token)
    await carregar()
  }

  if (editando) {
    const c = editando
    const upd = (k, v) => setEditando({ ...c, [k]: v })
    return (
      <form onSubmit={salvar} style={{ background: COR.branco, border: `1px solid ${COR.borda}`, borderRadius: 12, padding: 20, maxWidth: 520 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>{c.id ? 'Editar anúncio' : 'Novo anúncio'}</div>
        <label style={rotulo}>Título</label>
        <input style={campo} value={c.titulo} onChange={e => upd('titulo', e.target.value)} required />
        <label style={rotulo}>Descrição</label>
        <textarea style={{ ...campo, minHeight: 70 }} value={c.descricao || ''} onChange={e => upd('descricao', e.target.value)} />
        <label style={rotulo}>Link externo</label>
        <input style={campo} value={c.link_externo || ''} onChange={e => upd('link_externo', e.target.value)} placeholder="https://..." />
        <label style={rotulo}>Imagem (URL)</label>
        <input style={campo} value={c.imagem_url || ''} onChange={e => upd('imagem_url', e.target.value)} placeholder="https://..." />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div><label style={rotulo}>Anunciante</label><input style={campo} value={c.anunciante_nome || ''} onChange={e => upd('anunciante_nome', e.target.value)} /></div>
          <div><label style={rotulo}>Contato do anunciante</label><input style={campo} value={c.anunciante_contato || ''} onChange={e => upd('anunciante_contato', e.target.value)} /></div>
        </div>
        <label style={{ fontSize: 13.5, display: 'flex', gap: 6, alignItems: 'center', marginTop: 10 }}>
          <input type="checkbox" checked={!!c.ativo} onChange={e => upd('ativo', e.target.checked)} /> Ativo
        </label>
        {erro && <div style={{ color: COR.erro, fontSize: 13, marginTop: 8 }}>{erro}</div>}
        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button type="submit" disabled={salvando} style={botao}>{salvando ? 'Salvando…' : 'Salvar'}</button>
          <button type="button" style={botaoSec} onClick={() => setEditando(null)}>Cancelar</button>
        </div>
      </form>
    )
  }

  return (
    <div>
      <button style={{ ...botao, marginBottom: 16 }} onClick={() => setEditando({ ...ANUNCIO_VAZIO })}>+ Novo anúncio</button>
      {!lista ? <div>Carregando…</div> : lista.length === 0 ? <div style={{ color: COR.textoSuave }}>Nenhum anúncio cadastrado.</div> : (
        <div style={{ display: 'grid', gap: 10 }}>
          {lista.map(a => (
            <div key={a.id} style={{ background: COR.branco, border: `1px solid ${COR.borda}`, borderRadius: 10, padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <div>
                <div style={{ fontWeight: 700 }}>{a.titulo}</div>
                <div style={{ fontSize: 12.5, color: COR.textoSuave }}>{a.anunciante_nome || '—'} · {a.ativo ? 'ativo' : 'inativo'}</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={botaoSec} onClick={() => setEditando(a)}>Editar</button>
                <button style={botaoPerigo} onClick={() => excluir(a.id)}>Excluir</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ================= LEADS (solicitações) ================= */
const TIPO_LABEL = { avaliacao: 'Avaliação', imovel: 'Interesse em imóvel', parceria: 'Parceria', contato: 'Contato' }

function AbaLeads({ token }) {
  const [lista, setLista] = useState(null)

  async function carregar() {
    const d = await chamar('leads', {}, token)
    setLista(d.leads)
  }
  useEffect(() => { carregar() }, [])

  async function mudarStatus(id, status) {
    await chamar('lead_status', { id, status }, token)
    await carregar()
  }

  if (!lista) return <div>Carregando…</div>
  if (lista.length === 0) return <div style={{ color: COR.textoSuave }}>Nenhuma solicitação recebida ainda.</div>

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {lista.map(l => (
        <div key={l.id} style={{ background: COR.branco, border: `1px solid ${COR.borda}`, borderRadius: 10, padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div style={{ fontWeight: 700 }}>{l.nome} <span style={{ fontWeight: 400, color: COR.textoSuave, fontSize: 12.5 }}>· {TIPO_LABEL[l.tipo] || l.tipo}</span></div>
              <div style={{ fontSize: 12.5, color: COR.textoSuave }}>{[l.telefone, l.email].filter(Boolean).join(' · ')}</div>
            </div>
            <select value={l.status} onChange={e => mudarStatus(l.id, e.target.value)} style={{ ...campo, width: 'auto' }}>
              <option value="novo">Novo</option>
              <option value="em_andamento">Em andamento</option>
              <option value="concluido">Concluído</option>
            </select>
          </div>
          {l.endereco_imovel && <div style={{ fontSize: 13, marginTop: 8 }}>Imóvel: {l.endereco_imovel}</div>}
          {l.mensagem && <div style={{ fontSize: 13, marginTop: 6, color: COR.texto }}>{l.mensagem}</div>}
          <div style={{ fontSize: 11, color: COR.textoSuave, marginTop: 8 }}>{new Date(l.criado_em).toLocaleString('pt-BR')}</div>
        </div>
      ))}
    </div>
  )
}

/* ================= PERFIL ================= */
function AbaPerfil({ token }) {
  const [c, setC] = useState(null)
  const [salvando, setSalvando] = useState(false)
  const [ok, setOk] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    fetch('/api/imoveis?secao=perfil').then(r => r.json()).then(d => setC(d.perfil))
  }, [])

  async function salvar(e) {
    e.preventDefault()
    setSalvando(true); setErro(''); setOk(false)
    try {
      await chamar('perfil_salvar', c, token)
      setOk(true)
    } catch (e) {
      setErro(e.message)
    } finally {
      setSalvando(false)
    }
  }

  if (!c) return <div>Carregando…</div>
  const upd = (k, v) => setC({ ...c, [k]: v })

  return (
    <form onSubmit={salvar} style={{ background: COR.branco, border: `1px solid ${COR.borda}`, borderRadius: 12, padding: 20, maxWidth: 560 }}>
      <label style={rotulo}>Nome</label>
      <input style={campo} value={c.nome || ''} onChange={e => upd('nome', e.target.value)} />
      <label style={rotulo}>Título profissional</label>
      <input style={campo} value={c.titulo || ''} onChange={e => upd('titulo', e.target.value)} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div><label style={rotulo}>CRECI</label><input style={campo} value={c.creci || ''} onChange={e => upd('creci', e.target.value)} /></div>
        <div><label style={rotulo}>CNAI</label><input style={campo} value={c.cnai || ''} onChange={e => upd('cnai', e.target.value)} /></div>
      </div>
      <label style={rotulo}>Bio</label>
      <textarea style={{ ...campo, minHeight: 90 }} value={c.bio || ''} onChange={e => upd('bio', e.target.value)} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div><label style={rotulo}>Telefone</label><input style={campo} value={c.telefone || ''} onChange={e => upd('telefone', e.target.value)} /></div>
        <div><label style={rotulo}>WhatsApp (só números, com DDD)</label><input style={campo} value={c.whatsapp || ''} onChange={e => upd('whatsapp', e.target.value)} /></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div><label style={rotulo}>E-mail</label><input style={campo} value={c.email || ''} onChange={e => upd('email', e.target.value)} /></div>
        <div><label style={rotulo}>Instagram</label><input style={campo} value={c.instagram || ''} onChange={e => upd('instagram', e.target.value)} /></div>
      </div>
      <label style={rotulo}>Foto (URL)</label>
      <input style={campo} value={c.foto_url || ''} onChange={e => upd('foto_url', e.target.value)} placeholder="https://..." />

      {erro && <div style={{ color: COR.erro, fontSize: 13, marginTop: 8 }}>{erro}</div>}
      {ok && <div style={{ color: COR.sucesso, fontSize: 13, marginTop: 8 }}>Salvo.</div>}
      <button type="submit" disabled={salvando} style={{ ...botao, marginTop: 16 }}>{salvando ? 'Salvando…' : 'Salvar'}</button>
    </form>
  )
}
