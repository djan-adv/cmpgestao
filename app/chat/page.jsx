'use client'
// Chat da equipe — ACESSO EXTERNO para celular (mesmo login/senha do CMPGestão).
// Visual e uso parecidos com WhatsApp. Propositalmente NÃO participa do
// controle de "acesso único por login" do sistema principal (sistema.html):
// não lê nem grava a tabela `sessao_unica`. Assim, quem está no computador
// pode abrir esta página no celular sem ser deslogado, e vice-versa — os
// dois ficam ativos ao mesmo tempo (o pedido era exatamente esse).
import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase } from '../../lib/supabase'

const VERDE = '#128C7E'
const VERDE_ESCURO = '#075E54'
const BOLHA_MINHA = '#DCF8C6'
const FUNDO = '#ECE5DD'

function normaliza(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()
}
function horaCurta(iso) {
  try { const d = new Date(iso); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') } catch { return '' }
}
function rotuloProcesso(p) {
  return (p.cliente_nome || p.numero || 'processo') + (p.numero ? (' — ' + p.numero) : '')
}

export default function ChatMobile() {
  const [carregando, setCarregando] = useState(true)
  const [user, setUser] = useState(null)
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erroLogin, setErroLogin] = useState('')
  const [entrando, setEntrando] = useState(false)

  const [pessoas, setPessoas] = useState([])       // colegas (id, nome)
  const [porId, setPorId] = useState({})
  const [alvo, setAlvo] = useState(null)           // null = Todos; ou {id,nome} = privado
  const [msgs, setMsgs] = useState([])
  const [texto, setTexto] = useState('')
  const [respondendoA, setRespondendoA] = useState(null) // {id,texto,autor}
  const [pin, setPin] = useState(null)             // {id, rotulo}
  const [buscaAberta, setBuscaAberta] = useState(false)
  const [buscaTxt, setBuscaTxt] = useState('')
  const [buscaResultados, setBuscaResultados] = useState([])
  const procNomesRef = useRef({})
  const [procTick, setProcTick] = useState(0) // só para forçar repintar quando um nome chega
  const scrollRef = useRef(null)
  const ultimoIdRef = useRef(0)

  const euId = user && user.id

  // ---------- sessão ----------
  useEffect(() => {
    let ativo = true
    supabase.auth.getSession().then(({ data }) => {
      if (!ativo) return
      setUser((data && data.session && data.session.user) || null)
      setCarregando(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_ev, s) => { setUser((s && s.user) || null) })
    return () => { ativo = false; sub && sub.subscription && sub.subscription.unsubscribe() }
  }, [])

  async function entrar(e) {
    e && e.preventDefault()
    setErroLogin(''); setEntrando(true)
    const r = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha })
    setEntrando(false)
    if (r.error) { setErroLogin('E-mail ou senha inválidos.'); return }
  }
  function sair() { supabase.auth.signOut() }

  // ---------- pessoas (nomes reais — nunca confiar em autor_nome da mensagem) ----------
  useEffect(() => {
    if (!euId) return
    supabase.from('usuarios').select('id,nome').order('nome').then(({ data }) => {
      const todos = data || []
      const mapa = {}; todos.forEach(u => { mapa[u.id] = u })
      setPorId(mapa)
      setPessoas(todos.filter(u => u.id !== euId))
    })
  }, [euId])
  const nomeDe = useCallback((id) => (porId[id] && porId[id].nome) || '', [porId])

  // ---------- mensagens ----------
  const carregar = useCallback(async () => {
    if (!euId) return
    const q = await supabase.from('chat_mensagens').select('*').order('id', { ascending: false }).limit(200)
    if (q.error) return
    const lista = (q.data || []).slice().reverse()
    setMsgs(lista)
    if (lista.length) ultimoIdRef.current = lista[lista.length - 1].id
  }, [euId])
  useEffect(() => { carregar() }, [carregar])

  useEffect(() => {
    if (!euId) return
    const canal = supabase.channel('chat-cmp-mobile')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_mensagens' }, (p) => {
        setMsgs(cur => cur.some(m => m.id === p.new.id) ? cur : [...cur, p.new].slice(-300))
        if (p.new.id > ultimoIdRef.current) ultimoIdRef.current = p.new.id
      })
      .subscribe()
    const varre = setInterval(async () => {
      const q = await supabase.from('chat_mensagens').select('*').gt('id', ultimoIdRef.current).order('id')
      const novas = q.data || []
      if (novas.length) {
        setMsgs(cur => { const ids = new Set(cur.map(m => m.id)); return [...cur, ...novas.filter(n => !ids.has(n.id))] })
        ultimoIdRef.current = novas[novas.length - 1].id
      }
    }, 20000)
    return () => { supabase.removeChannel(canal); clearInterval(varre) }
  }, [euId])

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight }, [msgs, alvo])

  // resolve nome de um processo vinculado (cache em ref — não dispara loop de render)
  const buscarNomeProcesso = useCallback(async (id) => {
    if (!id || procNomesRef.current[id]) return
    procNomesRef.current[id] = '…'
    const { data } = await supabase.from('processos').select('id,numero,cliente_nome').eq('id', id).maybeSingle()
    if (data) { procNomesRef.current[id] = rotuloProcesso(data); setProcTick(t => t + 1) }
  }, [])
  useEffect(() => { msgs.forEach(m => { if (m.processo_id) buscarNomeProcesso(m.processo_id) }) }, [msgs, buscarNomeProcesso])

  // ---------- filtro por thread (Todos / privado com alguém) ----------
  const visiveis = msgs.filter(m => {
    if (alvo) return (m.autor_id === euId && m.para_id === alvo.id) || (m.autor_id === alvo.id && m.para_id === euId)
    return !m.para_id
  })

  // ---------- buscar processo ----------
  async function buscarProcessos(q) {
    setBuscaTxt(q)
    const termo = q.trim()
    if (termo.length < 2) { setBuscaResultados([]); return }
    const dig = termo.replace(/\D/g, '')
    let query = supabase.from('processos').select('id,numero,cliente_nome').limit(8)
    query = dig.length >= 4 ? query.ilike('numero', '%' + dig + '%') : query.ilike('cliente_nome', '%' + termo + '%')
    const { data } = await query
    setBuscaResultados(data || [])
  }
  function fixarProcesso(p) { setPin({ id: p.id, rotulo: rotuloProcesso(p) }); setBuscaAberta(false); setBuscaTxt(''); setBuscaResultados([]) }

  function _detectaCNJ(txt) {
    const m = String(txt || '').match(/\d{7}-?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{4}/)
    return m ? m[0] : ''
  }
  function responderA(m) {
    setRespondendoA({ id: m.id, texto: m.texto, autor: m.autor_id === euId ? 'você' : (nomeDe(m.autor_id) || 'colega') })
    if (!pin) { setBuscaAberta(true); buscarProcessos(_detectaCNJ(m.texto)) }
  }

  async function enviar(e) {
    e && e.preventDefault()
    const t = texto.trim(); if (!t) return
    setTexto('')
    const payload = {
      texto: t,
      para_id: alvo ? alvo.id : null,
      autor_nome: (porId[euId] && porId[euId].nome) || (user.email || '').split('@')[0],
      respondendo_a: respondendoA ? respondendoA.id : null,
      processo_id: pin ? pin.id : null,
    }
    setRespondendoA(null)
    const r = await supabase.from('chat_mensagens').insert(payload).select('*').single()
    if (r.error) { alert('Não enviou: ' + r.error.message); setTexto(t); return }
    setMsgs(cur => cur.some(m => m.id === r.data.id) ? cur : [...cur, r.data])
    if (r.data.id > ultimoIdRef.current) ultimoIdRef.current = r.data.id
  }

  // ---------------- telas ----------------
  if (carregando) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#667', fontFamily: 'system-ui' }}>Carregando…</div>

  if (!user) {
    return (
      <div style={{ minHeight: '100vh', background: VERDE_ESCURO, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: 'system-ui,Arial,sans-serif' }}>
        <form onSubmit={entrar} style={{ background: '#fff', borderRadius: 14, padding: 26, width: '100%', maxWidth: 360, boxShadow: '0 10px 40px rgba(0,0,0,.25)' }}>
          <div style={{ textAlign: 'center', marginBottom: 18 }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: VERDE_ESCURO }}>💬 Chat CMPGestão</div>
            <div style={{ fontSize: 13, color: '#667', marginTop: 4 }}>Entre com o mesmo login do sistema</div>
          </div>
          <label style={{ fontSize: 12.5, fontWeight: 600, color: '#556', display: 'block', marginBottom: 4 }}>E-mail</label>
          <input value={email} onChange={e => setEmail(e.target.value)} type="email" autoComplete="username" required
            style={{ width: '100%', padding: '11px 12px', border: '1px solid #d9dde3', borderRadius: 9, fontSize: 15, marginBottom: 12, boxSizing: 'border-box' }} />
          <label style={{ fontSize: 12.5, fontWeight: 600, color: '#556', display: 'block', marginBottom: 4 }}>Senha</label>
          <input value={senha} onChange={e => setSenha(e.target.value)} type="password" autoComplete="current-password" required
            style={{ width: '100%', padding: '11px 12px', border: '1px solid #d9dde3', borderRadius: 9, fontSize: 15, marginBottom: 16, boxSizing: 'border-box' }} />
          {erroLogin && <div style={{ color: '#b3261e', fontSize: 13, marginBottom: 12 }}>{erroLogin}</div>}
          <button type="submit" disabled={entrando} style={{ width: '100%', padding: '12px', border: 0, borderRadius: 9, background: entrando ? '#8fc7bd' : VERDE, color: '#fff', fontWeight: 700, fontSize: 15, cursor: entrando ? 'default' : 'pointer' }}>
            {entrando ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', fontFamily: 'system-ui,Arial,sans-serif', background: FUNDO, overflow: 'hidden' }}>
      {/* topo */}
      <div style={{ background: VERDE_ESCURO, color: '#fff', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 16 }}>{alvo ? alvo.nome : '👥 Todos (equipe)'}</div>
        <button onClick={() => { setBuscaAberta(true); buscarProcessos('') }} title="Falar sobre um processo" style={{ marginLeft: 'auto', background: 'rgba(255,255,255,.15)', border: 0, color: '#fff', borderRadius: 8, padding: '6px 10px', fontSize: 13, cursor: 'pointer' }}>🔍 processo</button>
        <button onClick={sair} title="Sair" style={{ background: 'rgba(255,255,255,.15)', border: 0, color: '#fff', borderRadius: 8, padding: '6px 10px', fontSize: 13, cursor: 'pointer' }}>Sair</button>
      </div>

      {/* seletor de conversa (Todos / colegas) */}
      <div style={{ display: 'flex', gap: 6, padding: '8px 10px', overflowX: 'auto', background: '#fff', borderBottom: '1px solid #ddd', flexShrink: 0 }}>
        <button onClick={() => setAlvo(null)} style={{ flexShrink: 0, border: !alvo ? '1.5px solid ' + VERDE : '1px solid #ddd', background: !alvo ? '#e7f7f2' : '#fff', color: '#222', borderRadius: 16, padding: '6px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>👥 Todos</button>
        {pessoas.map(p => (
          <button key={p.id} onClick={() => setAlvo({ id: p.id, nome: p.nome })} style={{ flexShrink: 0, border: alvo && alvo.id === p.id ? '1.5px solid ' + VERDE : '1px solid #ddd', background: alvo && alvo.id === p.id ? '#e7f7f2' : '#fff', color: '#222', borderRadius: 16, padding: '6px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>🔒 {(p.nome || '').split(' ')[0]}</button>
        ))}
      </div>

      {/* pin de processo */}
      {pin && (
        <div style={{ background: '#fff3b0', borderBottom: '1px solid #d9b64c', padding: '7px 12px', fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span>📌 <b>{pin.rotulo}</b> — mensagens ficam marcadas a este processo</span>
          <button onClick={() => setPin(null)} style={{ marginLeft: 'auto', background: 'none', border: 0, color: '#7a5b00', fontWeight: 700, cursor: 'pointer' }}>✕</button>
        </div>
      )}

      {/* mensagens */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 10px' }}>
        {!visiveis.length && <div style={{ textAlign: 'center', color: '#8a9', fontSize: 13, marginTop: 30 }}>Nenhuma mensagem ainda.</div>}
        {visiveis.map(m => {
          const meu = m.autor_id === euId
          const cit = m.respondendo_a ? msgs.find(x => x.id === m.respondendo_a) : null
          return (
            <div key={m.id} style={{ display: 'flex', justifyContent: meu ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
              <div style={{ maxWidth: '82%', background: meu ? BOLHA_MINHA : '#fff', borderRadius: 9, padding: '7px 9px', boxShadow: '0 1px 1px rgba(0,0,0,.08)', position: 'relative' }}>
                {!meu && <div style={{ fontSize: 11.5, fontWeight: 700, color: VERDE_ESCURO, marginBottom: 2 }}>{nomeDe(m.autor_id) || 'colega'}</div>}
                {cit && (
                  <div style={{ borderLeft: '3px solid ' + VERDE, background: 'rgba(0,0,0,.04)', borderRadius: 4, padding: '4px 7px', marginBottom: 4, fontSize: 12, color: '#556' }}>
                    <b>{cit.autor_id === euId ? 'você' : (nomeDe(cit.autor_id) || 'colega')}</b><br />{cit.texto.slice(0, 120)}
                  </div>
                )}
                <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 14.5, color: '#1b1b1b' }}>{m.texto}</div>
                {m.processo_id && <div style={{ fontSize: 10.5, color: '#7a5b00', marginTop: 3 }}>🔗 {procNomesRef.current[m.processo_id] === '…' ? 'processo vinculado' : (procNomesRef.current[m.processo_id] || 'processo vinculado')}</div>}
                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6, marginTop: 2 }}>
                  <span onClick={() => responderA(m)} style={{ fontSize: 11, color: '#8a93a2', cursor: 'pointer' }}>↩ responder</span>
                  <span style={{ fontSize: 10.5, color: '#8a93a2' }}>{horaCurta(m.criado_em)}</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* resposta citada em andamento */}
      {respondendoA && (
        <div style={{ background: '#fff', borderTop: '1px solid #ddd', padding: '7px 10px', display: 'flex', gap: 8, alignItems: 'flex-start', flexShrink: 0 }}>
          <div style={{ flex: 1, borderLeft: '3px solid ' + VERDE, paddingLeft: 8, fontSize: 12.5, color: '#556' }}><b>{respondendoA.autor}</b><br />{respondendoA.texto.slice(0, 140)}</div>
          <button onClick={() => setRespondendoA(null)} style={{ background: 'none', border: 0, color: '#8a93a2', fontWeight: 700, cursor: 'pointer' }}>✕</button>
        </div>
      )}

      {/* campo de digitar */}
      <form onSubmit={enviar} style={{ display: 'flex', gap: 8, padding: '8px 10px', background: '#fff', borderTop: '1px solid #ddd', flexShrink: 0, paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }}>
        <input value={texto} onChange={e => setTexto(e.target.value)} placeholder="Mensagem" autoComplete="off"
          style={{ flex: 1, border: '1px solid #ddd', borderRadius: 20, padding: '11px 14px', fontSize: 15 }} />
        <button type="submit" style={{ width: 44, height: 44, borderRadius: '50%', border: 0, background: VERDE, color: '#fff', fontSize: 18, cursor: 'pointer', flexShrink: 0 }}>➤</button>
      </form>

      {/* busca de processo (tela cheia) */}
      {buscaAberta && (
        <div style={{ position: 'fixed', inset: 0, background: '#fff', zIndex: 50, display: 'flex', flexDirection: 'column' }}>
          <div style={{ background: VERDE_ESCURO, color: '#fff', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <b>Falar sobre um processo</b>
            <button onClick={() => setBuscaAberta(false)} style={{ marginLeft: 'auto', background: 'rgba(255,255,255,.15)', border: 0, color: '#fff', borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}>fechar</button>
          </div>
          <div style={{ padding: 12 }}>
            <input autoFocus value={buscaTxt} onChange={e => buscarProcessos(e.target.value)} placeholder="Nome do cliente ou nº do processo…"
              style={{ width: '100%', padding: '11px 12px', border: '1px solid #ddd', borderRadius: 9, fontSize: 15, boxSizing: 'border-box' }} />
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px' }}>
            {buscaResultados.map(p => (
              <div key={p.id} onClick={() => fixarProcesso(p)} style={{ padding: '12px 8px', borderBottom: '1px solid #eee', cursor: 'pointer' }}>
                <div style={{ fontWeight: 600 }}>{p.cliente_nome || '(sem nome)'}</div>
                <div style={{ fontSize: 12.5, color: '#667' }}>{p.numero || ''}</div>
              </div>
            ))}
            {!buscaResultados.length && buscaTxt.trim().length >= 2 && <div style={{ color: '#8a9', fontSize: 13, padding: 20, textAlign: 'center' }}>Nenhum processo encontrado.</div>}
          </div>
        </div>
      )}
    </div>
  )
}
