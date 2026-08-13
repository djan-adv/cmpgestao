'use client'
// Chat público de captação — link pro site ou pra mandar direto pra quem
// ainda não é cliente (sem processo cadastrado). Sem login: qualquer pessoa
// que abrir já cai conversando. Guarda tudo em crm_leads (mesmo funil que a
// equipe usa) via /api/lead-chat, e no fim solta um botão de WhatsApp já com
// a referência da conversa — pra a conversa continuar lá, com o contexto.
import { useState, useRef, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'

const NAVY = '#2E3A4B'
const GOLD = '#C9A227'
const WHATS_NUM = (process.env.NEXT_PUBLIC_WHATSAPP_ESCRITORIO || '').replace(/\D/g, '')

export default function ClientePage() {
  const [msgs, setMsgs] = useState([])
  const [passo, setPasso] = useState('nome')     // nome -> mensagem -> email -> fim
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [leadId, setLeadId] = useState(null)
  const [ref, setRef] = useState('')
  const scrollRef = useRef(null)
  const inputRef = useRef(null)
  const fileRef = useRef(null)
  const dados = useRef({ nome: '', mensagem: '', email: '' })
  const leadIdRef = useRef(null)   // evita duas criações em paralelo (arquivo + texto quase juntos)

  const addBot = useCallback((t) => setMsgs(m => [...m, { de: 'bot', texto: t }]), [])
  const addUser = useCallback((t) => setMsgs(m => [...m, { de: 'user', texto: t }]), [])

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight }, [msgs])
  useEffect(() => { if (inputRef.current) inputRef.current.focus() }, [passo])

  // link personalizado (?nome=&email=) pula a pergunta de quem já sabemos
  useEffect(() => {
    let q
    try { q = new URLSearchParams(window.location.search) } catch (e) { q = new URLSearchParams() }
    const nomeQ = (q.get('nome') || '').trim()
    const emailQ = (q.get('email') || '').trim()
    ;(async () => {
      if (nomeQ) {
        dados.current.nome = nomeQ
        if (emailQ) dados.current.email = emailQ
        const j = await criarLead({ nome: nomeQ, email: emailQ || undefined })
        addBot('Oi, ' + nomeQ.split(' ')[0] + '! 👋 Sou o assistente do escritório Crispim Mendonça e Pinheiro' + (j.ok ? (' (atendimento ' + j.ref + ')') : '') + '. Me conta rapidinho o que está acontecendo — pode mandar prints ou documentos também, se quiser.')
        setPasso('mensagem')
      } else {
        addBot('Oi! 👋 Sou o assistente do escritório Crispim Mendonça e Pinheiro. Qual é o seu nome?')
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function criarLead(extra) {
    if (leadIdRef.current) return { ok: true, id: leadIdRef.current, ref }
    try {
      const r = await fetch('/api/lead-chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'criar', origem_url: location.href, ...(extra || {}) }),
      })
      const j = await r.json()
      if (j.ok) { leadIdRef.current = j.id; setLeadId(j.id); setRef(j.ref) }
      return j
    } catch (e) { return { ok: false } }
  }
  async function atualizarLead(patch) {
    if (!leadIdRef.current) return
    try {
      await fetch('/api/lead-chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'atualizar', id: leadIdRef.current, ...patch }),
      })
    } catch (e) { /* melhor esforço — não trava a conversa */ }
  }

  async function enviar(e) {
    e && e.preventDefault()
    const t = texto.trim()
    if (!t || enviando) return
    setEnviando(true)
    addUser(t)
    setTexto('')

    if (passo === 'nome') {
      dados.current.nome = t
      const j = await criarLead({ nome: t })
      addBot('Prazer, ' + t.split(' ')[0] + '!' + (j.ref ? (' (atendimento ' + j.ref + ')') : '') + ' Me conta rapidinho o que está acontecendo — pode mandar prints ou documentos também, se quiser.')
      setPasso('mensagem')
    } else if (passo === 'mensagem') {
      dados.current.mensagem = t
      await atualizarLead({ mensagem: t })
      if (dados.current.email) {
        // e-mail já veio no link (?email=) — não pergunta de novo
        addBot('Perfeito, ' + (dados.current.nome.split(' ')[0] || '') + '! Já registrei aqui' + (ref ? (' (atendimento ' + ref + ')') : '') + '. Se quiser adiantar, é só continuar agora mesmo no WhatsApp 👇')
        setPasso('fim')
      } else {
        addBot('Entendi. Por último, qual é o seu e-mail, pra mantermos contato?')
        setPasso('email')
      }
    } else if (passo === 'email') {
      dados.current.email = t
      await atualizarLead({ email: t })
      addBot('Perfeito, ' + (dados.current.nome.split(' ')[0] || '') + '! Já registrei aqui' + (ref ? (' (atendimento ' + ref + ')') : '') + ' e o escritório vai te chamar por e-mail. Se quiser adiantar, é só continuar agora mesmo no WhatsApp 👇')
      setPasso('fim')
    } else {
      await atualizarLead({ mensagem: t })
      addBot('Anotado! Se puder, use o WhatsApp abaixo pra a gente responder mais rápido.')
    }
    setEnviando(false)
  }

  async function anexar(e) {
    const arqs = Array.prototype.slice.call(e.target.files || [])
    e.target.value = ''
    if (!arqs.length) return
    if (!leadIdRef.current) await criarLead({})
    for (const f of arqs) {
      addUser('📎 ' + f.name)
      if (!leadIdRef.current) { addBot('Não consegui registrar "' + f.name + '" agora. Tenta de novo?'); continue }
      try {
        const path = leadIdRef.current + '/' + Date.now() + '_' + String(f.name).replace(/[^\w.\-]+/g, '_')
        const up = await supabase.storage.from('leads-publicos').upload(path, f, { contentType: f.type || 'application/octet-stream', upsert: false })
        if (up.error) { addBot('Não consegui enviar "' + f.name + '". Tenta de novo?'); continue }
        await atualizarLead({ arquivo: { nome: f.name, path, tipo: f.type, tamanho: f.size } })
      } catch (err) { addBot('Não consegui enviar "' + f.name + '".') }
    }
    addBot('Recebido! Pode continuar.')
  }

  const placeholder = passo === 'nome' ? 'Seu nome…' : passo === 'mensagem' ? 'Como podemos ajudar?' : passo === 'email' ? 'Seu e-mail…' : 'Mensagem…'
  const textoWa = 'Olá! Sou ' + (dados.current.nome || '') + ', vim pelo chat do site' + (ref ? (' (atendimento ' + ref + ')') : '') + '.' + (dados.current.mensagem ? (' ' + dados.current.mensagem) : '')
  const linkWhats = WHATS_NUM ? ('https://wa.me/' + WHATS_NUM + '?text=' + encodeURIComponent(textoWa)) : ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', background: '#ECE5DD', fontFamily: 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif' }}>
      <div style={{ background: NAVY, color: '#fff', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: GOLD, color: NAVY, display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 13, flexShrink: 0 }}>CMP</div>
        <div style={{ minWidth: 0 }}>
          <b style={{ display: 'block', fontSize: 15 }}>Crispim Mendonça e Pinheiro</b>
          <span style={{ fontSize: 12, opacity: .85 }}>{ref ? ('Atendimento ' + ref) : 'Fale com o escritório'}</span>
        </div>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '14px 10px' }}>
        {msgs.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.de === 'bot' ? 'flex-start' : 'flex-end', marginBottom: 8 }}>
            <div style={{ maxWidth: '80%', background: m.de === 'bot' ? '#fff' : '#DCF8C6', borderRadius: 12, padding: '9px 12px', fontSize: 14.5, lineHeight: 1.4, boxShadow: '0 1px 1px rgba(0,0,0,.08)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.texto}</div>
          </div>
        ))}
        {passo === 'fim' && linkWhats && (
          <div style={{ display: 'flex', justifyContent: 'center', margin: '16px 0 6px' }}>
            <a href={linkWhats} target="_blank" rel="noopener noreferrer"
              style={{ background: '#25D366', color: '#fff', textDecoration: 'none', fontWeight: 700, fontSize: 14.5, padding: '13px 22px', borderRadius: 26, display: 'inline-flex', alignItems: 'center', gap: 8, boxShadow: '0 3px 10px rgba(0,0,0,.18)' }}>
              💬 Falar agora no WhatsApp
            </a>
          </div>
        )}
      </div>

      <form onSubmit={enviar} style={{ display: 'flex', gap: 8, padding: '10px', background: '#fff', borderTop: '1px solid #ddd', flexShrink: 0, paddingBottom: 'max(10px, env(safe-area-inset-bottom))' }}>
        <input type="file" ref={fileRef} multiple accept="*/*" style={{ display: 'none' }} onChange={anexar} />
        <button type="button" onClick={() => fileRef.current && fileRef.current.click()} title="Anexar print ou documento"
          style={{ width: 42, height: 42, borderRadius: '50%', border: '1px solid #ddd', background: '#fff', fontSize: 17, cursor: 'pointer', flexShrink: 0 }}>📎</button>
        <input ref={inputRef} value={texto} onChange={e => setTexto(e.target.value)} placeholder={placeholder}
          autoComplete="off" enterKeyHint="send"
          type={passo === 'email' ? 'email' : 'text'} inputMode={passo === 'email' ? 'email' : 'text'}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(e) } }}
          style={{ flex: 1, minWidth: 0, border: '1px solid #ddd', borderRadius: 20, padding: '11px 15px', fontSize: 16 }} />
        <button type="submit" disabled={enviando || !texto.trim()}
          style={{ width: 42, height: 42, borderRadius: '50%', border: 0, background: NAVY, color: '#fff', fontSize: 17, cursor: 'pointer', flexShrink: 0, opacity: (enviando || !texto.trim()) ? .5 : 1 }}>➤</button>
      </form>
    </div>
  )
}
