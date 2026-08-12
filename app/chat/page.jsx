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
const PALETA_CORES = ['#8a3b8f', '#1f7a44', '#185FA5', '#b5342b', '#6d4aa8', '#0b7285', '#7a4b00', '#c2185b']

// Tudo que é TEXTO DE CONVERSA cresce 50% (pedido de quem lê no celular, de pé,
// entre uma audiência e outra). A barra do topo fica de fora: são quatro botões
// numa linha só, e ampliá-los junto empurraria o "Sair" para fora da tela.
const F = 1.5
const fs = n => Math.round(n * F * 10) / 10

// Última conversa aberta, por pessoa: quem usa o chat volta ao ponto onde
// parou, em vez de cair sempre em "Todos".
const CHAVE_ALVO = id => 'cmp_chat_alvo_' + id
function alvoSalvo(id) {
  try { const v = localStorage.getItem(CHAVE_ALVO(id)); return v ? JSON.parse(v) : null } catch (e) { return null }
}
function salvarAlvo(id, alvo) {
  try { alvo ? localStorage.setItem(CHAVE_ALVO(id), JSON.stringify(alvo)) : localStorage.removeItem(CHAVE_ALVO(id)) } catch (e) {}
}

// VAPID public key vem em base64url — o Push API exige Uint8Array
function chaveVapidParaBytes(base64url) {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4)
  const base64 = (base64url + pad).replace(/-/g, '+').replace(/_/g, '/')
  const bruto = atob(base64)
  const bytes = new Uint8Array(bruto.length)
  for (let i = 0; i < bruto.length; i++) bytes[i] = bruto.charCodeAt(i)
  return bytes
}
async function chamarPush(acao, extra) {
  try {
    const { data } = await supabase.auth.getSession()
    const token = data && data.session && data.session.access_token
    if (!token) return null
    const r = await fetch('/api/chat/push', {
      method: acao === 'get' ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: acao === 'get' ? undefined : JSON.stringify({ acao, ...extra }),
    })
    return await r.json()
  } catch (e) { return null }
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
  const [seletorCor, setSeletorCor] = useState(false)
  const [pushEstado, setPushEstado] = useState('verificando') // verificando | indisponivel | desativado | ativando | ativado
  const [imgToken, setImgToken] = useState('') // p/ mostrar os prints (imagens) via /api/anexo
  const fileInputRef = useRef(null)
  const procNomesRef = useRef({})
  const [procTick, setProcTick] = useState(0) // só para forçar repintar quando um nome chega
  const scrollRef = useRef(null)
  const inputRef = useRef(null)
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

  // ---------- mantém a sessão viva mesmo com o app em segundo plano ----------
  // No celular (instalado na tela de início), o sistema operacional "congela" a
  // aba quando você troca de app ou bloqueia a tela — o timer de renovação do
  // token do Supabase para junto. Sem isso, ao reabrir horas depois o token
  // pode já estar vencido demais para renovar sozinho, e o app pede login de
  // novo. startAutoRefresh()/stopAutoRefresh() é a recomendação oficial do
  // Supabase para apps mobile: renova assim que a tela volta a ficar visível.
  useEffect(() => {
    function aoMudarVisibilidade() {
      if (document.visibilityState === 'visible') supabase.auth.startAutoRefresh()
      else supabase.auth.stopAutoRefresh()
    }
    aoMudarVisibilidade()
    document.addEventListener('visibilitychange', aoMudarVisibilidade)
    return () => document.removeEventListener('visibilitychange', aoMudarVisibilidade)
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
    supabase.from('usuarios').select('id,nome,cor_chat').order('nome').then(({ data }) => {
      const todos = data || []
      const mapa = {}; todos.forEach(u => { mapa[u.id] = u })
      setPorId(mapa)
      setPessoas(todos.filter(u => u.id !== euId))
    })
  }, [euId])
  const nomeDe = useCallback((id) => (porId[id] && porId[id].nome) || '', [porId])
  const corDe = useCallback((id) => {
    if (porId[id] && porId[id].cor_chat) return porId[id].cor_chat
    let s = 0; const str = String(id || ''); for (let i = 0; i < str.length; i++) s = (s + str.charCodeAt(i)) % 99999
    return PALETA_CORES[s % PALETA_CORES.length]
  }, [porId])
  async function escolherCor(cor) {
    setPorId(m => ({ ...m, [euId]: { ...(m[euId] || {}), cor_chat: cor } }))
    setSeletorCor(false)
    try { await supabase.from('usuarios').update({ cor_chat: cor }).eq('id', euId) } catch { }
  }

  // ---------- alarme (push notification) ----------
  useEffect(() => {
    if (!euId) return
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) { setPushEstado('indisponivel'); return }
    navigator.serviceWorker.register('/chat-sw.js', { scope: '/' }).then(async (reg) => {
      const sub = await reg.pushManager.getSubscription()
      setPushEstado(sub ? 'ativado' : 'desativado')
    }).catch(() => setPushEstado('indisponivel'))
  }, [euId])

  async function ativarAlarme() {
    if (pushEstado === 'ativado') return
    setPushEstado('ativando')
    try {
      const permissao = await Notification.requestPermission()
      if (permissao !== 'granted') { setPushEstado('desativado'); alert('Permissão negada. Pra ativar depois, habilite notificações deste site nas configurações do navegador.'); return }
      const chave = await chamarPush('get')
      if (!chave || !chave.publicKey) { setPushEstado('indisponivel'); return }
      const reg = await navigator.serviceWorker.register('/chat-sw.js', { scope: '/' })
      await navigator.serviceWorker.ready
      let sub = await reg.pushManager.getSubscription()
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chaveVapidParaBytes(chave.publicKey) })
      await chamarPush('subscribe', { subscription: sub.toJSON() })
      setPushEstado('ativado')
    } catch (e) { setPushEstado('desativado'); alert('Não deu pra ativar o alarme: ' + (e && e.message || e)) }
  }

  async function notificarEnvio(payload) {
    // dispara e esquece — não deve travar/atrasar o envio da mensagem
    // origem_endpoint: a inscrição DESTE aparelho, para o alarme tocar nos outros
    // aparelhos da pessoa (o computador, por exemplo) mas não neste
    let origem = ''
    try {
      const reg = await navigator.serviceWorker.getRegistration()
      const sub = reg && await reg.pushManager.getSubscription()
      origem = (sub && sub.endpoint) || ''
    } catch (e) {}
    chamarPush('notificar', { autor_id: euId, autor_nome: payload.autor_nome, texto: payload.texto, para_id: payload.para_id, origem_endpoint: origem })
  }

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

  // Abre na última conversa que ESTA pessoa usou. Espera a lista de colegas
  // chegar: se o contato salvo não existe mais (saiu do escritório), cai em
  // "Todos" em vez de abrir numa conversa fantasma. Roda uma vez por sessão —
  // depois disso, quem manda é o clique.
  const restaurouRef = useRef(false)
  useEffect(() => {
    if (!euId || restaurouRef.current || !pessoas.length) return
    restaurouRef.current = true
    const salvo = alvoSalvo(euId)
    if (salvo && salvo.id && pessoas.some(p => p.id === salvo.id)) setAlvo(salvo)
  }, [euId, pessoas])

  const trocarAlvo = useCallback(a => { setAlvo(a); if (euId) salvarAlvo(euId, a) }, [euId])

  // token p/ exibir os prints (imagens) via /api/anexo — atualizado periodicamente
  useEffect(() => {
    if (!euId) return
    let ativo = true
    async function atualiza() {
      const { data } = await supabase.auth.getSession()
      const t = data && data.session && data.session.access_token
      if (ativo && t) setImgToken(t)
    }
    atualiza()
    const iv = setInterval(atualiza, 4 * 60000)
    return () => { ativo = false; clearInterval(iv) }
  }, [euId])

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

  // ——— rolagem ———
  // O "volta sozinho" vinha de fixar a rolagem no fim ANTES de os prints
  // carregarem: a imagem chega, a altura da lista cresce e a última mensagem
  // some para baixo. E o polling de 20s empurrava de volta quem tinha subido
  // para ler algo antigo. Agora: 'irAoFim' repete o ajuste nos quadros
  // seguintes (pegando imagem e layout), e o auto-scroll das mensagens novas só
  // acontece se você JÁ estava no fim.
  const pertoDoFimRef = useRef(true)
  const irAoFim = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const fim = () => { el.scrollTop = el.scrollHeight }
    fim()
    requestAnimationFrame(fim)
    setTimeout(fim, 120)
    setTimeout(fim, 400)   // prints e fontes já carregados
    pertoDoFimRef.current = true
  }, [])
  const aoRolar = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    pertoDoFimRef.current = (el.scrollHeight - el.scrollTop - el.clientHeight) < 90
  }, [])
  // abrir e trocar de conversa: sempre na mensagem mais recente
  useEffect(() => { irAoFim() }, [alvo, irAoFim])
  // mensagem nova: só desce se a pessoa estava acompanhando o fim
  useEffect(() => { if (pertoDoFimRef.current) irAoFim() }, [msgs, irAoFim])

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

  // vai direto pro campo de digitar — nada se abre por cima roubando o foco/tela.
  // Quem quiser vincular a um processo toca em "🔍 processo" por conta própria.
  function responderA(m) {
    setRespondendoA({ id: m.id, texto: m.texto, autor: m.autor_id === euId ? 'você' : (nomeDe(m.autor_id) || 'colega') })
    if (inputRef.current) inputRef.current.focus()
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
    notificarEnvio(payload)
  }

  // envia um "print" (screenshot): sobe a imagem à parte (não vai pro
  // chat_mensagens, que ficaria pesado) e grava a mensagem com texto curto
  async function enviarPrint(file) {
    if (!file) return
    if (file.size > 8 * 1024 * 1024) { alert('Esse print tem mais de 8 MB — reduza e tente de novo.'); return }
    try {
      const b64 = await new Promise((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result || '').split(',')[1] || '')
        r.onerror = reject
        r.readAsDataURL(file)
      })
      const { data } = await supabase.auth.getSession()
      const token = data && data.session && data.session.access_token
      const up = await fetch('/api/chat/print', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ nome: file.name || 'print.png', tipo: file.type || 'image/png', b64 }),
      })
      const j = await up.json().catch(() => ({}))
      if (!up.ok || j.erro) { alert('Não deu pra enviar o print: ' + (j.erro || ('HTTP ' + up.status))); return }
      const payload = {
        texto: '📷 print enviado',
        para_id: alvo ? alvo.id : null,
        autor_nome: (porId[euId] && porId[euId].nome) || (user.email || '').split('@')[0],
        respondendo_a: respondendoA ? respondendoA.id : null,
        processo_id: pin ? pin.id : null,
        imagem_anexo_id: j.id,
      }
      setRespondendoA(null)
      const r = await supabase.from('chat_mensagens').insert(payload).select('*').single()
      if (r.error) { alert('Não enviou: ' + r.error.message); return }
      setMsgs(cur => cur.some(m => m.id === r.data.id) ? cur : [...cur, r.data])
      if (r.data.id > ultimoIdRef.current) ultimoIdRef.current = r.data.id
      notificarEnvio(payload)
    } catch (e) { alert('Erro ao enviar o print: ' + (e && e.message || e)) }
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
        {pushEstado !== 'indisponivel' && (
          <button onClick={ativarAlarme} disabled={pushEstado === 'ativando' || pushEstado === 'verificando'} title={pushEstado === 'ativado' ? 'Alarme ativado — você recebe notificação mesmo com o app fechado' : 'Ativar alarme (notificação no celular)'}
            style={{ background: pushEstado === 'ativado' ? 'rgba(255,255,255,.3)' : 'rgba(255,255,255,.15)', border: 0, color: '#fff', borderRadius: 8, padding: '6px 10px', fontSize: 13, cursor: pushEstado === 'ativando' ? 'default' : 'pointer' }}>
            {pushEstado === 'ativado' ? '🔔 ativado' : pushEstado === 'ativando' ? '🔔 …' : '🔕 ativar alarme'}
          </button>
        )}
        <button onClick={() => setSeletorCor(s => !s)} title="Escolher minha cor" style={{ background: 'rgba(255,255,255,.15)', border: 0, color: '#fff', borderRadius: 8, padding: '6px 10px', fontSize: 13, cursor: 'pointer' }}>🎨</button>
        <button onClick={sair} title="Sair" style={{ background: 'rgba(255,255,255,.15)', border: 0, color: '#fff', borderRadius: 8, padding: '6px 10px', fontSize: 13, cursor: 'pointer' }}>Sair</button>
      </div>

      {seletorCor && (
        <div style={{ background: '#fff', borderBottom: '1px solid #ddd', padding: '10px 12px', flexShrink: 0 }}>
          <div style={{ fontSize: 12.5, color: '#556', marginBottom: 6 }}>Sua cor no chat (as outras pessoas veem assim):</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {PALETA_CORES.map(c => (
              <span key={c} onClick={() => escolherCor(c)} style={{ width: 28, height: 28, borderRadius: '50%', background: c, cursor: 'pointer', display: 'inline-block', border: (porId[euId] && porId[euId].cor_chat) === c ? '3px solid #222' : '2px solid #fff', boxShadow: '0 0 0 1px #ccc' }} />
            ))}
          </div>
        </div>
      )}

      {/* seletor de conversa (Todos / colegas) */}
      <div style={{ display: 'flex', gap: 6, padding: '8px 10px', overflowX: 'auto', background: '#fff', borderBottom: '1px solid #ddd', flexShrink: 0 }}>
        <button onClick={() => trocarAlvo(null)} style={{ flexShrink: 0, border: !alvo ? '1.5px solid ' + VERDE : '1px solid #ddd', background: !alvo ? '#e7f7f2' : '#fff', color: '#222', borderRadius: 16, padding: '8px 14px', fontSize: fs(12.5), fontWeight: 600, cursor: 'pointer' }}>👥 Todos</button>
        {pessoas.map(p => (
          <button key={p.id} onClick={() => trocarAlvo({ id: p.id, nome: p.nome })} style={{ flexShrink: 0, border: alvo && alvo.id === p.id ? '1.5px solid ' + VERDE : '1px solid #ddd', background: alvo && alvo.id === p.id ? '#e7f7f2' : '#fff', color: '#222', borderRadius: 16, padding: '8px 14px', fontSize: fs(12.5), fontWeight: 600, cursor: 'pointer' }}>🔒 {(p.nome || '').split(' ')[0]}</button>
        ))}
      </div>

      {/* pin de processo */}
      {pin && (
        <div style={{ background: '#fff3b0', borderBottom: '1px solid #d9b64c', padding: '7px 12px', fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: fs(12.5) }}>📌 <b>{pin.rotulo}</b> — mensagens ficam marcadas a este processo</span>
          <button onClick={() => setPin(null)} style={{ marginLeft: 'auto', background: 'none', border: 0, color: '#7a5b00', fontWeight: 700, cursor: 'pointer' }}>✕</button>
        </div>
      )}

      {/* mensagens */}
      <div ref={scrollRef} onScroll={aoRolar} style={{ flex: 1, overflowY: 'auto', padding: '12px 10px', overflowAnchor: 'none' }}>
        {!visiveis.length && <div style={{ textAlign: 'center', color: '#8a9', fontSize: fs(13), marginTop: 30 }}>Nenhuma mensagem ainda.</div>}
        {visiveis.map(m => {
          const meu = m.autor_id === euId
          const cit = m.respondendo_a ? msgs.find(x => x.id === m.respondendo_a) : null
          const corAutor = corDe(m.autor_id)
          return (
            <div key={m.id} style={{ display: 'flex', justifyContent: meu ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
              <div style={{ maxWidth: '82%', background: meu ? BOLHA_MINHA : '#fff', borderLeft: '4px solid ' + corAutor, borderRadius: 9, padding: '7px 9px', boxShadow: '0 1px 1px rgba(0,0,0,.08)', position: 'relative' }}>
                {!meu && <div style={{ fontSize: fs(11.5), fontWeight: 700, color: corAutor, marginBottom: 2 }}>{nomeDe(m.autor_id) || 'colega'}</div>}
                {cit && (
                  <div style={{ borderLeft: '3px solid ' + VERDE, background: 'rgba(0,0,0,.04)', borderRadius: 4, padding: '5px 8px', marginBottom: 4, fontSize: fs(12), color: '#556' }}>
                    <b>{cit.autor_id === euId ? 'você' : (nomeDe(cit.autor_id) || 'colega')}</b><br />{cit.texto.slice(0, 120)}
                  </div>
                )}
                <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: fs(14.5), lineHeight: 1.4, color: '#1b1b1b' }}>{m.texto}</div>
                {m.imagem_anexo_id && imgToken && (
                  <img src={'/api/anexo?id=' + encodeURIComponent(m.imagem_anexo_id) + '&jwt=' + encodeURIComponent(imgToken)}
                    onClick={e => window.open(e.currentTarget.src, '_blank')}
                    onLoad={() => { if (pertoDoFimRef.current) irAoFim() }}
                    style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 6, marginTop: 4, display: 'block', cursor: 'pointer' }} />
                )}
                {m.processo_id && <div style={{ fontSize: fs(10.5), color: '#7a5b00', marginTop: 3 }}>🔗 {procNomesRef.current[m.processo_id] === '…' ? 'processo vinculado' : (procNomesRef.current[m.processo_id] || 'processo vinculado')}</div>}
                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6, marginTop: 2 }}>
                  <span onClick={() => responderA(m)} style={{ fontSize: fs(11), color: '#8a93a2', cursor: 'pointer' }}>↩ responder</span>
                  <span style={{ fontSize: fs(10.5), color: '#8a93a2' }}>{horaCurta(m.criado_em)}</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* resposta citada em andamento */}
      {respondendoA && (
        <div style={{ background: '#fff', borderTop: '1px solid #ddd', padding: '7px 10px', display: 'flex', gap: 8, alignItems: 'flex-start', flexShrink: 0 }}>
          <div style={{ flex: 1, borderLeft: '3px solid ' + VERDE, paddingLeft: 8, fontSize: fs(12.5), color: '#556' }}><b>{respondendoA.autor}</b><br />{respondendoA.texto.slice(0, 140)}</div>
          <button onClick={() => setRespondendoA(null)} style={{ background: 'none', border: 0, color: '#8a93a2', fontWeight: 700, cursor: 'pointer' }}>✕</button>
        </div>
      )}

      {/* campo de digitar */}
      <form onSubmit={enviar} style={{ display: 'flex', gap: 8, padding: '8px 10px', background: '#fff', borderTop: '1px solid #ddd', flexShrink: 0, paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }}>
        <input type="file" accept="image/*" ref={fileInputRef} style={{ display: 'none' }}
          onChange={e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) enviarPrint(f) }} />
        <button type="button" onClick={() => fileInputRef.current && fileInputRef.current.click()} title="Enviar print"
          style={{ width: 40, height: 40, borderRadius: '50%', border: '1px solid #ddd', background: '#fff', fontSize: 17, cursor: 'pointer', flexShrink: 0 }}>📷</button>
        <input ref={inputRef} value={texto} onChange={e => setTexto(e.target.value)} placeholder="Mensagem ou cole um print"
          autoComplete="off" onPaste={e => {
            const f = Array.prototype.find.call(e.clipboardData.files || [], f => /^image\//.test(f.type))
            if (f) { e.preventDefault(); enviarPrint(f) }
          }}
          style={{ flex: 1, border: '1px solid #ddd', borderRadius: 20, padding: '12px 15px', fontSize: fs(15) }} />
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
