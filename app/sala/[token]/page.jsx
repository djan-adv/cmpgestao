'use client'
// Sala de reunião por vídeo — a MESMA página serve o escritório e o cliente.
//
// O cliente entra pelo link, escreve o nome e pronto: sem instalar aplicativo,
// sem cadastro, sem senha. Quem autoriza é o token que está na URL.
//
// Áudio e vídeo vão DIRETO de um navegador ao outro (WebRTC). O canal do
// Supabase Realtime carrega só a combinação inicial — oferta, resposta e
// candidatos de rede — e as frases da transcrição. Nada de mídia passa por
// servidor nosso, e a gravação da conversa não é guardada em lugar nenhum: o
// que fica é o texto, transcrito no próprio aparelho de cada participante.
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabase'

const VERDE = '#0F6E56'
const ICE = { iceServers: [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  // TURN do PRÓPRIO VPS (ops/turn/setup.sh): quando a rede esconde o aparelho e
  // a ligação direta não fecha, a mídia passa cifrada pelo nosso servidor.
  { urls: ['turn:gestao.cmpadvogados.com.br:3478?transport=udp', 'turn:gestao.cmpadvogados.com.br:3478?transport=tcp'], username: 'cmp', credential: 'e933e7efb6e977b645ba39a5dc6be4a2d5213f7fc30e596a' },
  // reserva comunitária (Open Relay), caso o coturn do VPS esteja fora
  { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' },
] }

export default function Sala({ params }) {
  const token = params.token
  const [fase, setFase] = useState('carregando')   // carregando | erro | entrada | chamada
  const [erro, setErro] = useState('')
  const [info, setInfo] = useState(null)
  const [nome, setNome] = useState('')
  const [souEscritorio, setSouEscritorio] = useState(false)
  const [estado, setEstado] = useState('esperando a outra pessoa…')
  const [comVideo, setComVideo] = useState(true)
  const [mudo, setMudo] = useState(false)
  const [semCam, setSemCam] = useState(false)
  const [falas, setFalas] = useState([])
  const [transcrevendo, setTranscrevendo] = useState(false)

  const [remotos, setRemotos] = useState([])   // [{id, nome}] — quem mais está na sala
  const localRef = useRef(null)
  const canalRef = useRef(null), streamRef = useRef(null)
  const recRef = useRef(null), euRef = useRef(''), euIdRef = useRef('')
  const nomeEscritorioRef = useRef('')
  // um RTCPeerConnection por participante (mesh completo) — até uns 5 na sala
  // isso aguenta numa boa; o gargalo seria o navegador, não a lógica
  const peersRef = useRef({})   // { [id]: {pc, stream, nome, el} }

  useEffect(() => {
    let vivo = true
    fetch('/api/sala', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'entrar', token, somenteLer: true }) })
      .then(r => r.json()).then(j => {
        if (!vivo) return
        if (!j || !j.ok) { setErro((j && j.erro) || 'Não consegui abrir a sala.'); setFase('erro'); return }
        setInfo(j)
        // quem é do escritório entra com o nome do cadastro; quem chega pelo
        // link (cliente, ou qualquer outro convidado) escreve o PRÓPRIO nome —
        // pré-preencher com o nome da cliente saía errado quando quem entrava
        // era outra pessoa (advogado da parte contrária, testemunha etc.)
        setNome(prev => nomeEscritorioRef.current || prev || '')
        setFase('entrada')
      }).catch(() => { if (vivo) { setErro('Sem conexão.'); setFase('erro') } })
    // quem já está logado no sistema é do escritório: rótulo do lado + nome real
    supabase.auth.getSession().then(async ({ data }) => {
      if (!vivo || !data || !data.session) return
      setSouEscritorio(true)
      try {
        const { data: u } = await supabase.from('usuarios').select('nome').eq('id', data.session.user.id).maybeSingle()
        const n = (u && u.nome) || ''
        if (n && vivo) { nomeEscritorioRef.current = n; setNome(n) }
      } catch (e) {}
    })
    return () => { vivo = false }
  }, [token])

  // ——— transcrição: cada aparelho transcreve o PRÓPRIO microfone ———
  // Assim não existe gravação circulando: o texto nasce local e só ele é
  // enviado. Onde o navegador não tiver reconhecimento de voz (Firefox, alguns
  // Android), a chamada funciona igual — sem transcrição, e a tela avisa.
  const registrarFala = useCallback((texto) => {
    const linha = { quem: euRef.current || 'eu', texto, meu: true }
    setFalas(f => [...f, linha])
    try { canalRef.current && canalRef.current.send({ type: 'broadcast', event: 'fala', payload: { quem: euRef.current, texto } }) } catch (e) {}
    fetch('/api/sala', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acao: 'fala', token, quem: euRef.current, lado: souEscritorio ? 'escritorio' : 'cliente', texto }),
    }).catch(() => {})
  }, [token, souEscritorio])

  const ligarTranscricao = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return false
    try {
      const r = new SR()
      r.lang = 'pt-BR'; r.continuous = true; r.interimResults = false
      r.onresult = (ev) => {
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          if (ev.results[i].isFinal) {
            const t = String(ev.results[i][0].transcript || '').trim()
            if (t) registrarFala(t)
          }
        }
      }
      // o reconhecimento cai sozinho depois de um tempo de silêncio: religar é o
      // que mantém a transcrição viva durante a reunião inteira
      r.onend = () => { try { if (recRef.current === r) r.start() } catch (e) {} }
      r.start()
      recRef.current = r
      setTranscrevendo(true)
      return true
    } catch (e) { return false }
  }, [registrarFala])

  function pararTudo() {
    try { const r = recRef.current; recRef.current = null; if (r) r.stop() } catch (e) {}
    Object.keys(peersRef.current).forEach(id => { try { peersRef.current[id].pc && peersRef.current[id].pc.close() } catch (e) {} })
    peersRef.current = {}
    try { streamRef.current && streamRef.current.getTracks().forEach(t => t.stop()) } catch (e) {}
    streamRef.current = null
  }

  function adicionarParticipante(id, nomeRemoto) {
    setRemotos(prev => prev.find(p => p.id === id)
      ? (nomeRemoto ? prev.map(p => p.id === id ? { ...p, nome: nomeRemoto } : p) : prev)
      : [...prev, { id, nome: nomeRemoto || 'participante' }])
  }
  function removerParticipante(id) {
    try { peersRef.current[id] && peersRef.current[id].pc && peersRef.current[id].pc.close() } catch (e) {}
    delete peersRef.current[id]
    setRemotos(prev => prev.filter(p => p.id !== id))
  }
  // um <video> por participante; o ref liga o elemento à stream assim que os
  // dois existirem (a stream pode chegar antes ou depois do <video> montar)
  function refDoVideo(id) {
    return el => {
      const p = peersRef.current[id] = peersRef.current[id] || {}
      p.el = el
      if (el && p.stream) el.srcObject = p.stream
    }
  }
  // uma ligação (RTCPeerConnection) por participante — quem entra manda
  // oferta pra todo mundo que já está na sala, e vice-versa, então o grupo
  // inteiro fecha o mesh sozinho, sem precisar de servidor de mídia
  function garantirPC(id, nomeRemoto) {
    const existente = peersRef.current[id]
    if (existente && existente.pc) { if (nomeRemoto) existente.nome = nomeRemoto; return existente.pc }
    const pc = new RTCPeerConnection(ICE)
    pc.onicecandidate = ev => {
      if (ev.candidate && canalRef.current) canalRef.current.send({ type: 'broadcast', event: 'sinal', payload: { tipo: 'ice', cand: ev.candidate, de: euIdRef.current, para: id } })
    }
    pc.ontrack = ev => {
      const p = peersRef.current[id]; if (!p) return
      p.stream = ev.streams[0]
      if (p.el) p.el.srcObject = p.stream
      setEstado('')
    }
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState
      if (st === 'connected') setEstado('')
      if (st === 'failed') { setEstado('não consegui conectar com ' + ((peersRef.current[id] && peersRef.current[id].nome) || 'alguém') + ' — tente pelo Wi-Fi'); removerParticipante(id) }
      if (st === 'disconnected' || st === 'closed') removerParticipante(id)
    }
    if (streamRef.current) streamRef.current.getTracks().forEach(t => pc.addTrack(t, streamRef.current))
    peersRef.current[id] = { ...(peersRef.current[id] || {}), pc, nome: nomeRemoto || (peersRef.current[id] && peersRef.current[id].nome) || 'participante' }
    return pc
  }

  async function entrar() {
    const meu = (nome || '').trim()
    if (meu.length < 2) { alert('Escreva seu nome para entrar.'); return }
    euRef.current = meu
    euIdRef.current = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : (Date.now() + '-' + Math.random())
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: comVideo ? { facingMode: 'user' } : false })
    } catch (e) {
      alert('Preciso da permissão do microfone' + (comVideo ? ' e da câmera' : '') + ' para entrar na reunião.')
      return
    }
    streamRef.current = stream
    setFase('chamada')
    fetch('/api/sala', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'entrar', token }) }).catch(() => {})

    const canal = supabase.channel('sala:' + token, { config: { broadcast: { self: false } } })
    canalRef.current = canal

    canal.on('broadcast', { event: 'fala' }, m => {
      const p = m.payload || {}
      if (p.texto) setFalas(f => [...f, { quem: p.quem || 'participante', texto: p.texto, meu: false }])
    })
    canal.on('broadcast', { event: 'sinal' }, async m => {
      const s = m.payload || {}
      try {
        if (s.tipo === 'cheguei') {
          // quem já estava na sala convida quem acabou de chegar — se já
          // tinha ligação com essa pessoa, não manda oferta de novo
          adicionarParticipante(s.de, s.nome)
          if (peersRef.current[s.de] && peersRef.current[s.de].pc) return
          const pc = garantirPC(s.de, s.nome)
          const of = await pc.createOffer()
          await pc.setLocalDescription(of)
          canal.send({ type: 'broadcast', event: 'sinal', payload: { tipo: 'oferta', sdp: of, de: euIdRef.current, para: s.de, nome: euRef.current } })
          setEstado('conectando…')
        } else if (s.tipo === 'oferta' && s.para === euIdRef.current) {
          adicionarParticipante(s.de, s.nome)
          const pc = garantirPC(s.de, s.nome)
          await pc.setRemoteDescription(s.sdp)
          const ans = await pc.createAnswer()
          await pc.setLocalDescription(ans)
          canal.send({ type: 'broadcast', event: 'sinal', payload: { tipo: 'resposta', sdp: ans, de: euIdRef.current, para: s.de } })
          setEstado('conectando…')
        } else if (s.tipo === 'resposta' && s.para === euIdRef.current) {
          const p = peersRef.current[s.de]
          if (p && p.pc) await p.pc.setRemoteDescription(s.sdp)
        } else if (s.tipo === 'ice' && s.para === euIdRef.current) {
          const p = peersRef.current[s.de]
          if (p && p.pc) await p.pc.addIceCandidate(s.cand)
        } else if (s.tipo === 'saiu') {
          const nomeSaiu = (peersRef.current[s.de] && peersRef.current[s.de].nome) || 'a outra pessoa'
          removerParticipante(s.de)
          setEstado(nomeSaiu + ' saiu')
        }
      } catch (e) { /* sinal fora de ordem não derruba a chamada */ }
    })
    canal.subscribe(st => {
      if (st === 'SUBSCRIBED') canal.send({ type: 'broadcast', event: 'sinal', payload: { tipo: 'cheguei', de: euIdRef.current, nome: euRef.current } })
    })
    ligarTranscricao()
  }

  // ref por função, não useEffect: o <video> do vídeo local existe em DOIS
  // pontos do JSX (layout de 2 pessoas vs. grade de 3+) — trocar de um pro
  // outro desmonta o elemento antigo e monta um novo, e um efeito preso a
  // `fase` só rodava a primeira vez, deixando o vídeo novo sem imagem depois
  // que uma terceira pessoa entrava. A função roda toda vez que o nó (re)monta.
  function refLocal(el) {
    localRef.current = el
    if (el && streamRef.current) el.srcObject = streamRef.current
  }

  async function sair() {
    try { canalRef.current && canalRef.current.send({ type: 'broadcast', event: 'sinal', payload: { tipo: 'saiu', de: euIdRef.current } }) } catch (e) {}
    pararTudo()
    if (souEscritorio) {
      // encerrar é do escritório: fecha a sala e guarda a transcrição no processo
      try {
        const r = await fetch('/api/sala', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'encerrar', token }) })
        const j = await r.json()
        alert(j && j.ok ? ('Reunião encerrada. ' + (j.falas || 0) + ' fala(s) transcritas' + (j.no_historico ? ' e guardadas no histórico do processo.' : '.')) : 'Reunião encerrada.')
      } catch (e) {}
    }
    setFase('entrada'); setFalas([]); setRemotos([]); setEstado('esperando a outra pessoa…')
  }

  useEffect(() => () => pararTudo(), [])

  if (fase === 'carregando') return <Centro><p>Abrindo a sala…</p></Centro>
  if (fase === 'erro') return <Centro><h2 style={{ margin: '0 0 8px' }}>Não deu para entrar</h2><p style={{ color: '#5b6572' }}>{erro}</p></Centro>

  if (fase === 'entrada') {
    return (
      <Centro>
        <div style={{ maxWidth: 380, width: '100%' }}>
          <h2 style={{ margin: '0 0 4px', color: '#2E3A4B' }}>{(info && info.titulo) || 'Reunião'}</h2>
          <p style={{ color: '#5b6572', fontSize: 14, margin: '0 0 16px' }}>
            Crispim, Mendonça e Pinheiro — Advogados{info && info.escritorio ? ' · ' + info.escritorio : ''}
          </p>
          <label style={{ fontSize: 13, color: '#5b6572' }}>Seu nome</label>
          <input value={nome} onChange={e => setNome(e.target.value)} placeholder="como quer ser chamado(a)"
            style={{ width: '100%', padding: '11px 12px', border: '1px solid #d6dbe3', borderRadius: 9, fontSize: 15, boxSizing: 'border-box', margin: '4px 0 12px' }} />
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, color: '#2E3A4B', marginBottom: 16 }}>
            <input type="checkbox" checked={comVideo} onChange={e => setComVideo(e.target.checked)} style={{ width: 18, height: 18 }} />
            entrar com câmera
          </label>
          <button onClick={entrar} style={{ width: '100%', padding: 13, border: 0, borderRadius: 10, background: VERDE, color: '#fff', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
            Entrar na reunião
          </button>
          <p style={{ color: '#8a8f98', fontSize: 12, lineHeight: 1.5, marginTop: 14 }}>
            A conversa vai direto entre os dois aparelhos. O escritório guarda a transcrição em texto do que for dito — a gravação de áudio e vídeo não é armazenada.
          </p>
        </div>
      </Centro>
    )
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0d1420', color: '#fff', display: 'flex', flexDirection: 'column', fontFamily: 'system-ui,Arial,sans-serif' }}>
      <div style={{ padding: '10px 14px', background: 'rgba(0,0,0,.35)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <b style={{ fontSize: 15 }}>{(info && info.titulo) || 'Reunião'}</b>
        <span style={{ fontSize: 12.5, opacity: .8 }}>{estado}</span>
        {remotos.length > 1 && <span style={{ fontSize: 12, opacity: .8 }}>· {remotos.length + 1} na sala</span>}
        <span style={{ marginLeft: 'auto', fontSize: 11.5, opacity: .75 }}>
          {transcrevendo ? '● transcrevendo' : 'sem transcrição neste navegador'}
        </span>
      </div>

      <div style={{ flex: 1, position: 'relative', background: '#000', minHeight: 0 }}>
        {remotos.length <= 1 ? (
          // caso comum (dois na sala): remoto em tela cheia + eu num cantinho,
          // do jeito que sempre foi
          <>
            {remotos[0]
              ? <video key={remotos[0].id} autoPlay playsInline ref={refDoVideo(remotos[0].id)}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
              : <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,.6)', fontSize: 14 }}>
                  {estado || 'esperando a outra pessoa…'}
                </div>}
            <video ref={refLocal} autoPlay playsInline muted
              style={{ position: 'absolute', right: 12, bottom: 12, width: '26vw', maxWidth: 170, borderRadius: 10, border: '2px solid rgba(255,255,255,.6)', objectFit: 'cover' }} />
          </>
        ) : (
          // três ou mais: grade com todo mundo, eu incluído — como Meet/Zoom.
          // gridAutoRows:'1fr' é o que importa aqui: sem altura fixa na linha,
          // o <video style="height:100%"> cai pra proporção NATIVA da câmera —
          // e no celular, em pé, a câmera frontal é mais alta que larga. A
          // grade inteira estourava tela abaixo, cobrindo os botões e
          // empurrando o próprio quadradinho pra fora da vista.
          <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: 'repeat(' + Math.min(2, remotos.length + 1) + ',1fr)', gridAutoRows: '1fr', gap: 2 }}>
            {remotos.map(p => (
              <div key={p.id} style={{ position: 'relative', background: '#111', overflow: 'hidden' }}>
                <video autoPlay playsInline ref={refDoVideo(p.id)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <span style={{ position: 'absolute', left: 6, bottom: 6, fontSize: 11, background: 'rgba(0,0,0,.5)', padding: '2px 7px', borderRadius: 6 }}>{p.nome}</span>
              </div>
            ))}
            <div style={{ position: 'relative', background: '#111', overflow: 'hidden' }}>
              <video ref={refLocal} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              <span style={{ position: 'absolute', left: 6, bottom: 6, fontSize: 11, background: 'rgba(0,0,0,.5)', padding: '2px 7px', borderRadius: 6 }}>você</span>
            </div>
          </div>
        )}
      </div>

      {falas.length > 0 && (
        <div style={{ maxHeight: '22vh', overflowY: 'auto', background: 'rgba(255,255,255,.06)', padding: '8px 12px', fontSize: 13, lineHeight: 1.5 }}>
          {falas.slice(-40).map((f, i) => (
            <div key={i} style={{ marginBottom: 3 }}>
              <b style={{ color: f.meu ? '#8fd6c1' : '#ffd77a' }}>{f.quem}:</b> {f.texto}
            </div>
          ))}
        </div>
      )}

      <div style={{ padding: 14, display: 'flex', gap: 10, justifyContent: 'center', background: 'rgba(0,0,0,.35)', paddingBottom: 'calc(14px + env(safe-area-inset-bottom))' }}>
        <Redondo onClick={() => {
          const t = streamRef.current && streamRef.current.getAudioTracks()[0]
          if (t) { t.enabled = !t.enabled; setMudo(!t.enabled) }
        }} cor={mudo ? '#7a2f2f' : '#2b3a4d'}>{mudo ? '🔇' : '🎙'}</Redondo>
        <Redondo onClick={() => {
          const t = streamRef.current && streamRef.current.getVideoTracks()[0]
          if (t) { t.enabled = !t.enabled; setSemCam(!t.enabled) }
        }} cor={semCam ? '#7a2f2f' : '#2b3a4d'}>{semCam ? '📷' : '🎥'}</Redondo>
        <Redondo onClick={sair} cor="#b5342b">✕</Redondo>
      </div>
    </div>
  )
}

function Centro({ children }) {
  return (
    <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 22, background: '#f3f5f8', fontFamily: 'system-ui,Arial,sans-serif', textAlign: 'center' }}>
      <div>{children}</div>
    </div>
  )
}
function Redondo({ children, onClick, cor }) {
  return (
    <button onClick={onClick} style={{ border: 0, borderRadius: '50%', width: 54, height: 54, fontSize: 21, background: cor, color: '#fff', cursor: 'pointer' }}>{children}</button>
  )
}
