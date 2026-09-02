'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { COR } from '../_componentes/tema'

const CHAVE_TOKEN = 'imoveis_anunciante_token'

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

const campo = { width: '100%', padding: 11, border: `1px solid ${COR.borda}`, borderRadius: 8, boxSizing: 'border-box', fontSize: 14.5, fontFamily: 'inherit' }
const rotulo = { fontSize: 12.5, color: COR.textoSuave, display: 'block', margin: '10px 0 4px' }
const botao = { padding: '11px 18px', background: COR.escuro, color: '#fff', border: 0, borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer' }
const botaoSec = { ...botao, background: 'transparent', color: COR.escuro, border: `1px solid ${COR.borda}` }

const STATUS_LABEL = {
  pendente: ['Em análise', '#8A6D1D'],
  ativo: ['Publicado', COR.sucesso],
  inativo: ['Pausado', COR.textoSuave],
  rejeitado: ['Não aprovado', COR.erro],
  vendido: ['Vendido', COR.textoSuave],
  alugado: ['Alugado', COR.textoSuave],
}

export default function PaginaAnunciar() {
  const [token, setToken] = useState(null)
  const [pronto, setPronto] = useState(false)
  const [modo, setModo] = useState('login') // login | cadastro

  useEffect(() => {
    setToken(localStorage.getItem(CHAVE_TOKEN))
    setPronto(true)
  }, [])

  function aoEntrar(t) {
    localStorage.setItem(CHAVE_TOKEN, t)
    setToken(t)
  }
  function sair() {
    chamar('anunciante_sair', {}, token).catch(() => {})
    localStorage.removeItem(CHAVE_TOKEN)
    setToken(null)
  }

  if (!pronto) return null

  if (!token) {
    return (
      <div style={{ maxWidth: 420, margin: '0 auto', padding: '48px 20px' }}>
        <h1 style={{ fontSize: 24, marginBottom: 6 }}>Anuncie seu imóvel</h1>
        <p style={{ color: COR.textoSuave, fontSize: 14, lineHeight: 1.6, marginBottom: 22 }}>
          Cadastro gratuito. Publique seu imóvel autorizando o corretor (CRECI 5401) a
          intermediar a venda, com direito à comissão — e destaque o anúncio quando quiser.
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
          <button onClick={() => setModo('login')} style={modo === 'login' ? botao : botaoSec}>Entrar</button>
          <button onClick={() => setModo('cadastro')} style={modo === 'cadastro' ? botao : botaoSec}>Criar conta</button>
        </div>
        {modo === 'login' ? <FormLogin aoEntrar={aoEntrar} /> : <FormCadastro aoEntrar={aoEntrar} />}
      </div>
    )
  }

  return <PainelAnunciante token={token} sair={sair} />
}

function FormLogin({ aoEntrar }) {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)

  async function enviar(e) {
    e.preventDefault()
    setErro(''); setCarregando(true)
    try {
      const d = await chamar('anunciante_login', { email, senha })
      aoEntrar(d.token)
    } catch (e) {
      setErro(e.message)
    } finally {
      setCarregando(false)
    }
  }

  return (
    <form onSubmit={enviar}>
      <label style={rotulo}>E-mail</label>
      <input style={campo} type="email" value={email} onChange={e => setEmail(e.target.value)} required />
      <label style={rotulo}>Senha</label>
      <input style={campo} type="password" value={senha} onChange={e => setSenha(e.target.value)} required />
      {erro && <div style={{ color: COR.erro, fontSize: 13, marginTop: 8 }}>{erro}</div>}
      <button type="submit" disabled={carregando} style={{ ...botao, width: '100%', marginTop: 16 }}>
        {carregando ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  )
}

function FormCadastro({ aoEntrar }) {
  const [nome, setNome] = useState('')
  const [telefone, setTelefone] = useState('')
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [papel, setPapel] = useState('proprietario')
  const [erro, setErro] = useState('')
  const [carregando, setCarregando] = useState(false)

  async function enviar(e) {
    e.preventDefault()
    setErro(''); setCarregando(true)
    try {
      const d = await chamar('anunciante_cadastro', { nome, telefone, email, senha, papel })
      aoEntrar(d.token)
    } catch (e) {
      setErro(e.message)
    } finally {
      setCarregando(false)
    }
  }

  return (
    <form onSubmit={enviar}>
      <label style={rotulo}>Você é...</label>
      <select style={campo} value={papel} onChange={e => setPapel(e.target.value)}>
        <option value="proprietario">Proprietário do imóvel</option>
        <option value="corretor">Corretor(a) de outra imobiliária</option>
      </select>
      <label style={rotulo}>Nome</label>
      <input style={campo} value={nome} onChange={e => setNome(e.target.value)} required />
      <label style={rotulo}>Telefone / WhatsApp</label>
      <input style={campo} value={telefone} onChange={e => setTelefone(e.target.value)} />
      <label style={rotulo}>E-mail</label>
      <input style={campo} type="email" value={email} onChange={e => setEmail(e.target.value)} required />
      <label style={rotulo}>Senha (mínimo 6 caracteres)</label>
      <input style={campo} type="password" value={senha} onChange={e => setSenha(e.target.value)} required minLength={6} />
      {erro && <div style={{ color: COR.erro, fontSize: 13, marginTop: 8 }}>{erro}</div>}
      <button type="submit" disabled={carregando} style={{ ...botao, width: '100%', marginTop: 16 }}>
        {carregando ? 'Criando…' : 'Criar conta'}
      </button>
    </form>
  )
}

const IMOVEL_VAZIO = {
  finalidade: 'venda', titulo: '', descricao: '', categoria: '', preco: '',
  endereco: '', bairro: '', cidade: '', uf: '',
  quartos: '', banheiros: '', vagas: '', area_util: '', area_total: '', video_url: '',
}

function PainelAnunciante({ token, sair }) {
  const [lista, setLista] = useState(null)
  const [editando, setEditando] = useState(null)
  const [fotosTexto, setFotosTexto] = useState('')
  const [aceitouTermo, setAceitouTermo] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')

  async function carregar() {
    const d = await chamar('anunciante_meus_anuncios', {}, token)
    setLista(d.imoveis)
  }
  useEffect(() => { carregar() }, [])

  function abrirNovo() { setEditando({ ...IMOVEL_VAZIO }); setFotosTexto(''); setAceitouTermo(false) }
  function abrirEdicao(im) { setEditando({ ...im }); setFotosTexto((im.fotos || []).join('\n')); setAceitouTermo(true) }

  async function salvar(e) {
    e.preventDefault()
    if (!editando.id && !aceitouTermo) { setErro('É preciso aceitar o termo de autorização para publicar.'); return }
    setSalvando(true); setErro('')
    try {
      const fotos = fotosTexto.split('\n').map(s => s.trim()).filter(Boolean)
      await chamar('anunciante_imovel_salvar', { ...editando, fotos, termo_aceito: true }, token)
      setEditando(null)
      await carregar()
    } catch (e) {
      setErro(e.message)
    } finally {
      setSalvando(false)
    }
  }

  async function excluir(id) {
    if (!confirm('Remover este anúncio?')) return
    await chamar('anunciante_imovel_excluir', { id }, token)
    await carregar()
  }

  if (editando) {
    const c = editando
    const upd = (k, v) => setEditando({ ...c, [k]: v })
    return (
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '32px 20px' }}>
        <form onSubmit={salvar} style={{ background: COR.branco, border: `1px solid ${COR.borda}`, borderRadius: 12, padding: 20 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>{c.id ? 'Editar anúncio' : 'Novo anúncio'}</div>

          <label style={rotulo}>Título</label>
          <input style={campo} value={c.titulo} onChange={e => upd('titulo', e.target.value)} required />

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={rotulo}>Finalidade</label>
              <select style={campo} value={c.finalidade} onChange={e => upd('finalidade', e.target.value)}>
                <option value="venda">Venda</option>
                <option value="aluguel">Aluguel</option>
              </select>
            </div>
            <div>
              <label style={rotulo}>Categoria (apto, casa, terreno...)</label>
              <input style={campo} value={c.categoria || ''} onChange={e => upd('categoria', e.target.value)} />
            </div>
          </div>

          <label style={rotulo}>Descrição</label>
          <textarea style={{ ...campo, minHeight: 80 }} value={c.descricao || ''} onChange={e => upd('descricao', e.target.value)} />

          <label style={rotulo}>Preço (R$)</label>
          <input style={campo} type="number" value={c.preco} onChange={e => upd('preco', e.target.value)} />

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

          <label style={rotulo}>Vídeo (link do YouTube, opcional)</label>
          <input style={campo} value={c.video_url || ''} onChange={e => upd('video_url', e.target.value)} placeholder="https://youtube.com/watch?v=..." />

          {!c.id && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, marginTop: 14, color: COR.texto }}>
              <input type="checkbox" checked={aceitouTermo} onChange={e => setAceitouTermo(e.target.checked)} style={{ marginTop: 3 }} />
              <span>
                Li e aceito o{' '}
                <Link href="/corretor/termo" target="_blank" style={{ color: COR.destaque, fontWeight: 700 }}>
                  Termo de Autorização de Anúncio e Intermediação
                </Link>{' '}
                — autorizo o corretor (CRECI 5401) a intermediar a venda deste imóvel, com direito à comissão.
              </span>
            </label>
          )}

          <div style={{ fontSize: 12, color: COR.textoSuave, marginTop: 10 }}>
            Cadastro gratuito. Para destacar o anúncio (R$ 50/mês), fale com o corretor após publicar.
          </div>

          {erro && <div style={{ color: COR.erro, fontSize: 13, marginTop: 8 }}>{erro}</div>}
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button type="submit" disabled={salvando} style={botao}>{salvando ? 'Salvando…' : (c.id ? 'Salvar' : 'Publicar anúncio')}</button>
            <button type="button" style={botaoSec} onClick={() => setEditando(null)}>Cancelar</button>
          </div>
        </form>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ fontSize: 22, margin: 0 }}>Meus anúncios</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={abrirNovo} style={botao}>+ Novo anúncio</button>
          <button onClick={sair} style={botaoSec}>Sair</button>
        </div>
      </div>

      {!lista ? <div>Carregando…</div> : lista.length === 0 ? (
        <div style={{ color: COR.textoSuave, fontSize: 14.5 }}>Você ainda não tem anúncios. Clique em "Novo anúncio" para publicar o primeiro.</div>
      ) : (
        <div style={{ display: 'grid', gap: 10 }}>
          {lista.map(im => {
            const [rotuloStatus, cor] = STATUS_LABEL[im.status] || [im.status, COR.textoSuave]
            return (
              <div key={im.id} style={{ background: COR.branco, border: `1px solid ${COR.borda}`, borderRadius: 10, padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{im.titulo}</div>
                  <div style={{ fontSize: 12.5, color, fontWeight: 700 }}>{rotuloStatus}{im.destaque ? ' · destacado' : ''}</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={botaoSec} onClick={() => abrirEdicao(im)}>Editar</button>
                  <button style={{ ...botaoSec, color: COR.erro, borderColor: COR.erro }} onClick={() => excluir(im.id)}>Remover</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
