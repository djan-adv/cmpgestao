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
// Nome curto para o chip da conversa. Só o primeiro nome bastava até existirem
// duas Marias — aí a tela mostrava "Maria" e "Maria" e não dava para saber com
// quem se estava falando. Quando o primeiro nome se repete, vira "M. Rita" e
// "M. Eduarda"; repetindo os dois, cai no nome completo.
function nomesCurtos(pessoas) {
  const partes = p => String(p.nome || '').trim().split(/\s+/).filter(Boolean)
  const conta = {}
  pessoas.forEach(p => { const n = (partes(p)[0] || '?'); conta[n] = (conta[n] || 0) + 1 })
  const out = {}
  const usados = {}
  pessoas.forEach(p => {
    const ps = partes(p)
    const primeiro = ps[0] || '?'
    let rot = primeiro
    if (conta[primeiro] > 1) rot = ps[1] ? (primeiro.charAt(0) + '. ' + ps[1]) : primeiro
    if (usados[rot]) rot = ps.join(' ')
    usados[rot] = true
    out[p.id] = rot
  })
  return out
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
  const [emFerias, setEmFerias] = useState({})     // id -> true (não recebe chat)
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

  // ——— chamada de voz/vídeo (mesmo protocolo do chat do sistema, então dá
  // para ligar do computador para o celular e vice-versa) ———
  const [chamada, setChamada] = useState(null)   // {nome, video, estado, mudo, semCam}
  const pcCallRef = useRef(null), streamCallRef = useRef(null), remotoStreamRef = useRef(null)
  const canalCallRef = useRef(null), comQuemRef = useRef(null), timeoutCallRef = useRef(null)
  const canaisCallRef = useRef({})

  const euId = user && user.id
  const rotulos = nomesCurtos(pessoas)

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

  // Quem está de férias não recebe chat (nem privado nem do grupo) — a regra
  // vale de verdade no servidor, que não dispara o alarme. Aqui é só o aviso na
  // tela: o chip fica cinza para ninguém mandar recado achando que chegou.
  const marcarFerias = useCallback(async (contas) => {
    try {
      const { data } = await supabase.from('produtividade_config').select('valor').eq('chave', 'assentos').maybeSingle()
      if (!data || !data.valor) return
      const assentos = JSON.parse(data.valor)
      if (!Array.isArray(assentos)) return
      const hoje = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10)
      const fora = assentos.filter(a => { const f = a && a.ferias; return f && f.fim && (!f.ini || hoje >= f.ini) && hoje <= f.fim })
      if (!fora.length) return
      const porNome = {}
      fora.forEach(a => { const n = normaliza(a.nome); if (n) porNome[n] = a.ferias })
      const mapa = {}
      ;(contas || []).forEach(c => { const f = porNome[normaliza(c.nome)]; if (f) mapa[c.id] = f })
      setEmFerias(mapa)
    } catch (e) { /* sem a config, ninguém fica marcado */ }
  }, [])

  // ---------- pessoas (nomes reais — nunca confiar em autor_nome da mensagem) ----------
  useEffect(() => {
    if (!euId) return
    supabase.from('usuarios').select('id,nome,cor_chat').order('nome').then(({ data }) => {
      const todos = data || []
      const mapa = {}; todos.forEach(u => { mapa[u.id] = u })
      setPorId(mapa)
      setPessoas(todos.filter(u => u.id !== euId))
      marcarFerias(todos)
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

  // iPhone só entrega notificação para site INSTALADO na tela de início. Em vez
  // de esconder o botão, explicamos o caminho — em duas frases, com o passo a
  // passo do próprio aparelho.
  function explicarAlarmeIndisponivel() {
    const ua = navigator.userAgent || ''
    const ehIOS = /iPhone|iPad|iPod/i.test(ua)
    const naTelaDeInicio = window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches
    if (ehIOS && !naTelaDeInicio) {
      alert('Para receber o alarme no iPhone, o chat precisa estar instalado na tela de início:\n\n'
        + '1. toque no botão Compartilhar (o quadrado com a seta para cima);\n'
        + '2. escolha "Adicionar à Tela de Início";\n'
        + '3. abra o CMP Chat por esse ícone e toque no sino de novo.')
      return
    }
    if (Notification && Notification.permission === 'denied') {
      alert('As notificações deste site estão bloqueadas no aparelho.\n\nAbra os ajustes do navegador, permita notificações para este site e toque no sino de novo.')
      return
    }
    alert('Este navegador não permite alarme. Abra o chat pelo Chrome (Android/computador) ou instale o site na tela de início, no iPhone.')
  }

  async function ativarAlarme() {
    if (pushEstado === 'indisponivel') { explicarAlarmeIndisponivel(); return }
    if (pushEstado === 'ativado') {
      // alarme já ligado: o clique vira o teste — confere o caminho inteiro sem
      // depender de outra pessoa mandar mensagem
      if (!confirm('🔔 O alarme está LIGADO.\n\nEnviar um teste agora? A notificação deve tocar neste aparelho em alguns segundos.')) return
      const j = await chamarPush('testar', {})
      if (j && j.ok && j.enviados) alert('Teste enviado. Se não tocar em alguns segundos, confira o modo silencioso / Não Perturbe do aparelho.')
      else alert('Não saiu: ' + ((j && (j.erro || j.motivo)) || 'erro desconhecido'))
      return
    }
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

  // canais de chamada: um por colega, abertos o tempo todo — é o que permite
  // RECEBER ligação, não só fazer
  useEffect(() => {
    if (!euId || !pessoas.length) return
    pessoas.forEach(p => {
      const nome = nomeCanalChamada(euId, p.id)
      if (canaisCallRef.current[nome]) return
      const c = supabase.channel(nome, { config: { broadcast: { self: false } } })
      c.on('broadcast', { event: 'sinal' }, m => { sinalChamada(m.payload, c, p) })
      c.subscribe()
      canaisCallRef.current[nome] = c
    })
  }, [euId, pessoas])   // eslint-disable-line react-hooks/exhaustive-deps

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
  // ——— apagar mensagem: para todos (só o autor) ou só da minha tela ———
  async function apagarMsg(m) {
    if (!confirm('Apagar esta mensagem?')) return
    if (m.autor_id === euId) {
      const paraTodos = confirm('Apagar para quem?\n\nOK = para TODOS (some para o escritório inteiro).\nCancelar = só para MIM (os outros continuam vendo).')
      if (paraTodos) {
        const r = await supabase.from('chat_mensagens').delete().eq('id', m.id)
        if (r.error) { alert('Não consegui apagar: ' + r.error.message); return }
        setMsgs(cur => cur.filter(x => x.id !== m.id)); return
      }
    } else if (!confirm('Ela some só da SUA tela — quem já recebeu continua vendo. Continuar?')) return
    const rp = await supabase.rpc('chat_ocultar_para_mim', { msg_id: m.id })
    if (rp.error) { alert('Não consegui apagar: ' + rp.error.message); return }
    setMsgs(cur => cur.filter(x => x.id !== m.id))
  }

  // ——— chamada 1:1 ———
  // A conversa vai direto entre os dois aparelhos (WebRTC); o canal do Supabase
  // só combina o encontro. O nome do canal é o MESMO do chat do sistema, por
  // isso computador liga para celular e vice-versa.
  const ICE_CALL = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] }
  // Campainha agendada inteira na linha do tempo do áudio: o confirm() congela o
  // JavaScript, mas o áudio roda em outra thread e segue tocando enquanto a
  // pergunta 'Atender?' está na tela. O contexto é destravado no primeiro toque.
  const audioCtxRef = useRef(null)
  useEffect(() => {
    const destravar = () => {
      try {
        const AC = window.AudioContext || window.webkitAudioContext
        if (!AC) return
        if (!audioCtxRef.current) audioCtxRef.current = new AC()
        if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume()
      } catch (e) {}
    }
    document.addEventListener('touchend', destravar, true)
    document.addEventListener('click', destravar, true)
    return () => { document.removeEventListener('touchend', destravar, true); document.removeEventListener('click', destravar, true) }
  }, [])
  function campainha() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext
      if (!AC) return null
      if (!audioCtxRef.current) audioCtxRef.current = new AC()
      const ctx = audioCtxRef.current
      try { ctx.resume() } catch (e) {}
      const master = ctx.createGain(); master.gain.value = 1; master.connect(ctx.destination)
      const t0 = ctx.currentTime + 0.05
      for (let c = 0; c < 15; c++) {
        for (const off of [0, 0.55]) {
          const t = t0 + c * 2 + off
          const o = ctx.createOscillator(), g = ctx.createGain()
          o.type = 'sine'; o.frequency.value = 880
          g.gain.setValueAtTime(0.0001, t)
          g.gain.exponentialRampToValueAtTime(0.25, t + 0.04)
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5)
          o.connect(g); g.connect(master)
          o.start(t); o.stop(t + 0.55)
        }
      }
      return { stop: () => { try { master.gain.value = 0; master.disconnect() } catch (e) {} } }
    } catch (e) { return null }
  }
  function nomeCanalChamada(a, b) { const x = [String(a), String(b)].sort(); return 'chamada:' + x[0] + ':' + x[1] }
  function limparChamada() {
    try { pcCallRef.current && pcCallRef.current.close() } catch (e) {}
    try { streamCallRef.current && streamCallRef.current.getTracks().forEach(t => t.stop()) } catch (e) {}
    if (timeoutCallRef.current) { clearTimeout(timeoutCallRef.current); timeoutCallRef.current = null }
    pcCallRef.current = null; streamCallRef.current = null; remotoStreamRef.current = null; comQuemRef.current = null
    setChamada(null)
  }
  function desligarChamada() {
    try { if (canalCallRef.current && comQuemRef.current) canalCallRef.current.send({ type: 'broadcast', event: 'sinal', payload: { de: euId, para: comQuemRef.current, tipo: 'fim' } }) } catch (e) {}
    limparChamada()
  }
  function novoPCChamada(canal, comQuem) {
    const pc = new RTCPeerConnection(ICE_CALL)
    pc.onicecandidate = ev => { if (ev.candidate) canal.send({ type: 'broadcast', event: 'sinal', payload: { de: euId, para: comQuem, tipo: 'ice', cand: ev.candidate } }) }
    pc.ontrack = ev => { remotoStreamRef.current = ev.streams[0]; setChamada(c => c ? { ...c, estado: '' } : c) }
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState
      if (st === 'connected') { setChamada(c => c ? { ...c, estado: '' } : c); if (timeoutCallRef.current) { clearTimeout(timeoutCallRef.current); timeoutCallRef.current = null } }
      if (st === 'failed') { alert('A conexão não fechou — isso costuma ser a rede móvel bloqueando ligação direta. Tente no Wi-Fi.'); limparChamada() }
      if (st === 'disconnected' || st === 'closed') limparChamada()
    }
    return pc
  }
  async function ligarChamada(comVideo) {
    if (!alvo) { alert('Abra uma conversa privada (toque no nome da pessoa) para ligar.'); return }
    if (pcCallRef.current) { alert('Já existe uma chamada em andamento.'); return }
    let stream
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: comVideo ? { facingMode: 'user' } : false }) }
    catch (e) { alert('Preciso da permissão do microfone' + (comVideo ? ' e da câmera' : '') + ' para ligar.'); return }
    const canal = canaisCallRef.current[nomeCanalChamada(euId, alvo.id)]
    if (!canal) { alert('Canal da chamada ainda não abriu — tente de novo em alguns segundos.'); stream.getTracks().forEach(t => t.stop()); return }
    streamCallRef.current = stream; canalCallRef.current = canal; comQuemRef.current = alvo.id
    setChamada({ nome: alvo.nome, video: !!comVideo, estado: 'chamando…', mudo: false, semCam: false })
    const pc = novoPCChamada(canal, alvo.id)
    pcCallRef.current = pc
    stream.getTracks().forEach(t => pc.addTrack(t, stream))
    const of = await pc.createOffer(); await pc.setLocalDescription(of)
    canal.send({ type: 'broadcast', event: 'sinal', payload: { de: euId, para: alvo.id, tipo: 'oferta', sdp: of, video: !!comVideo } })
    // o alarme (push) toca no celular mesmo com o app fechado — a pessoa abre o
    // chat e a oferta ainda está de pé
    chamarPush('notificar', { autor_id: euId, autor_nome: (porId[euId] && porId[euId].nome) || '', texto: '📞 Chamada de ' + (comVideo ? 'vídeo' : 'voz') + ' — abra o chat para atender', para_id: alvo.id })
    timeoutCallRef.current = setTimeout(() => { if (!remotoStreamRef.current) { alert('Sem resposta.'); desligarChamada() } }, 45000)
  }
  async function atenderChamada(sinal, canal, quem) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: sinal.video ? { facingMode: 'user' } : false })
    streamCallRef.current = stream; canalCallRef.current = canal; comQuemRef.current = sinal.de
    setChamada({ nome: quem, video: !!sinal.video, estado: 'conectando…', mudo: false, semCam: false })
    const pc = novoPCChamada(canal, sinal.de)
    pcCallRef.current = pc
    stream.getTracks().forEach(t => pc.addTrack(t, stream))
    await pc.setRemoteDescription(sinal.sdp)
    const ans = await pc.createAnswer(); await pc.setLocalDescription(ans)
    canal.send({ type: 'broadcast', event: 'sinal', payload: { de: euId, para: sinal.de, tipo: 'resposta', sdp: ans } })
  }
  async function sinalChamada(sig, canal, pessoa) {
    if (!sig || sig.para !== euId) return
    if (sig.tipo === 'fim') { if (pcCallRef.current) alert('Chamada encerrada.'); limparChamada(); return }
    if (sig.tipo === 'recusou') { setChamada(c => c ? { ...c, estado: 'recusada' } : c); setTimeout(limparChamada, 1200); return }
    if (sig.tipo === 'oferta') {
      if (pcCallRef.current) { canal.send({ type: 'broadcast', event: 'sinal', payload: { de: euId, para: sig.de, tipo: 'recusou' } }); return }
      const quem = (porId[sig.de] && porId[sig.de].nome) || pessoa.nome || 'colega'
      const camp = campainha()
      try { if (navigator.vibrate) navigator.vibrate([400, 180, 400, 180, 600]) } catch (e) {}
      const atende = confirm('📞 ' + quem + ' está chamando' + (sig.video ? ' em vídeo' : '') + '.\n\nAtender?')
      if (camp) camp.stop()
      if (!atende) {
        canal.send({ type: 'broadcast', event: 'sinal', payload: { de: euId, para: sig.de, tipo: 'recusou' } }); return
      }
      try { await atenderChamada(sig, canal, quem) } catch (e) { alert('Não consegui atender: ' + ((e && e.message) || e)); limparChamada() }
      return
    }
    if (sig.tipo === 'resposta' && pcCallRef.current) { try { await pcCallRef.current.setRemoteDescription(sig.sdp) } catch (e) {} return }
    if (sig.tipo === 'ice' && pcCallRef.current) { try { await pcCallRef.current.addIceCandidate(sig.cand) } catch (e) {} }
  }
  function chamadaMic() {
    const t = streamCallRef.current && streamCallRef.current.getAudioTracks()[0]
    if (t) { t.enabled = !t.enabled; setChamada(c => c ? { ...c, mudo: !t.enabled } : c) }
  }
  function chamadaCam() {
    const t = streamCallRef.current && streamCallRef.current.getVideoTracks()[0]
    if (!t) { alert('Esta chamada é só de voz.'); return }
    t.enabled = !t.enabled; setChamada(c => c ? { ...c, semCam: !t.enabled } : c)
  }

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
        {alvo && !emFerias[alvo.id] && (
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button onClick={() => ligarChamada(true)} title={'Chamada de VÍDEO com ' + alvo.nome} style={{ border: 0, background: 'rgba(255,255,255,.22)', color: '#fff', borderRadius: '50%', width: 38, height: 38, fontSize: 17, cursor: 'pointer' }}>📹</button>
            <button onClick={() => ligarChamada(false)} title={'Chamada de VOZ com ' + alvo.nome} style={{ border: 0, background: 'rgba(255,255,255,.22)', color: '#fff', borderRadius: '50%', width: 38, height: 38, fontSize: 17, cursor: 'pointer' }}>📞</button>
          </span>
        )}
        <button onClick={() => { setBuscaAberta(true); buscarProcessos('') }} title="Falar sobre um processo" style={{ marginLeft: alvo && !emFerias[alvo.id] ? 0 : 'auto', background: 'rgba(255,255,255,.15)', border: 0, color: '#fff', borderRadius: 8, padding: '6px 10px', fontSize: 13, cursor: 'pointer' }}>🔍 processo</button>
        {/* O sino SEMPRE aparece. Antes ele sumia quando o navegador não tinha
            Push — que no iPhone é o caso normal enquanto o site não estiver
            instalado na tela de início. Quem mais precisa do alarme era
            justamente quem não via o botão nem descobria o porquê. */}
        <button onClick={ativarAlarme} disabled={pushEstado === 'ativando' || pushEstado === 'verificando'}
          title={pushEstado === 'ativado' ? 'Alarme ligado — você recebe notificação mesmo com o app fechado'
            : pushEstado === 'indisponivel' ? 'Alarme indisponível neste navegador — toque para ver como resolver'
            : 'Ativar alarme (notificação no celular)'}
          style={{ background: pushEstado === 'ativado' ? 'rgba(255,255,255,.3)' : 'rgba(255,255,255,.15)', border: 0, color: '#fff', borderRadius: 8, padding: '6px 10px', fontSize: 13, cursor: pushEstado === 'ativando' ? 'default' : 'pointer' }}>
          {pushEstado === 'ativado' ? '🔔 ativado' : pushEstado === 'ativando' ? '🔔 …' : pushEstado === 'indisponivel' ? '🔕 alarme' : '🔕 ativar alarme'}
        </button>
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
          <button key={p.id} title={emFerias[p.id] ? 'De férias — não recebe mensagem' : ''}
            onClick={() => trocarAlvo({ id: p.id, nome: p.nome })}
            style={{ flexShrink: 0, border: alvo && alvo.id === p.id ? '1.5px solid ' + VERDE : '1px solid #ddd', background: emFerias[p.id] ? '#f2f2f2' : (alvo && alvo.id === p.id ? '#e7f7f2' : '#fff'), color: emFerias[p.id] ? '#9aa' : '#222', borderRadius: 16, padding: '8px 14px', fontSize: fs(12.5), fontWeight: 600, cursor: 'pointer' }}>
            {emFerias[p.id] ? '🏖' : '🔒'} {rotulos[p.id] || (p.nome || '').split(' ')[0]}</button>
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
                  <span onClick={() => apagarMsg(m)} title="Apagar" style={{ fontSize: fs(11), color: '#b09a86', cursor: 'pointer' }}>✕</span>
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

      {/* Conversa com quem está de férias: a caixa de texto dá lugar ao aviso.
          Antes o chip só ficava cinza — e quem não reparasse escreveria uma
          mensagem que ninguém iria ler. */}
      {alvo && emFerias[alvo.id] && (
        <div style={{ background: '#fff8e6', borderTop: '1px solid #e6d9a8', padding: '12px 14px', flexShrink: 0, textAlign: 'center' }}>
          <div style={{ fontSize: fs(13), color: '#7a5b00', fontWeight: 700 }}>
            🏖 {(alvo.nome || '').split(' ')[0]} está de férias{emFerias[alvo.id] && emFerias[alvo.id].fim ? (' até ' + String(emFerias[alvo.id].fim).split('-').reverse().join('/')) : ''}.
          </div>
          <div style={{ fontSize: fs(12), color: '#8a7a50', marginTop: 3 }}>
            Mensagens para ela não são entregues — nem aqui, nem no alarme do celular.
          </div>
        </div>
      )}

      {/* campo de digitar */}
      {!(alvo && emFerias[alvo.id]) && (
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
      )}

      {/* chamada em andamento — tela cheia, com os controles do WhatsApp */}
      {chamada && (
        <div style={{ position: 'fixed', inset: 0, background: '#0d1420', zIndex: 60, display: 'flex', flexDirection: 'column', color: '#fff' }}>
          <div style={{ padding: '12px 14px', background: 'rgba(0,0,0,.35)', display: 'flex', gap: 10, alignItems: 'center' }}>
            <b style={{ fontSize: 16 }}>{chamada.nome}</b>
            <span style={{ fontSize: 13, opacity: .8 }}>{chamada.estado}</span>
          </div>
          <div style={{ flex: 1, position: 'relative', background: '#000', minHeight: 0 }}>
            <video autoPlay playsInline ref={el => { if (el && remotoStreamRef.current && el.srcObject !== remotoStreamRef.current) el.srcObject = remotoStreamRef.current }}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <video autoPlay playsInline muted ref={el => { if (el && streamCallRef.current && el.srcObject !== streamCallRef.current) el.srcObject = streamCallRef.current }}
              style={{ position: 'absolute', right: 12, bottom: 12, width: '28vw', maxWidth: 150, borderRadius: 10, border: '2px solid rgba(255,255,255,.6)', objectFit: 'cover' }} />
            {!chamada.video && (
              /* chamada só de voz: a logo fica de marca d'água no lugar do vídeo */
              <img src="/logo_cmp_white.png" alt="" style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', width: '55%', maxWidth: 230, opacity: .35, pointerEvents: 'none' }} />
            )}
          </div>
          <div style={{ padding: 14, display: 'flex', gap: 12, justifyContent: 'center', background: 'rgba(0,0,0,.35)', paddingBottom: 'calc(14px + env(safe-area-inset-bottom))' }}>
            <button onClick={chamadaMic} style={{ border: 0, borderRadius: '50%', width: 56, height: 56, fontSize: 22, background: chamada.mudo ? '#7a2f2f' : '#2b3a4d', color: '#fff', cursor: 'pointer' }}>{chamada.mudo ? '🔇' : '🎙'}</button>
            <button onClick={chamadaCam} style={{ border: 0, borderRadius: '50%', width: 56, height: 56, fontSize: 22, background: chamada.semCam ? '#7a2f2f' : '#2b3a4d', color: '#fff', cursor: 'pointer' }}>{chamada.semCam ? '📷' : '🎥'}</button>
            <button onClick={desligarChamada} style={{ border: 0, borderRadius: '50%', width: 56, height: 56, fontSize: 22, background: '#b5342b', color: '#fff', cursor: 'pointer' }}>✕</button>
          </div>
        </div>
      )}

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
