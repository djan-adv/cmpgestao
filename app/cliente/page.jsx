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
const WHATS_NUM = '+55 0800 591 7259'.replace(/\D/g, '')
// mesma URL do convite que já sai nos e-mails pro cliente (app/api/portal/convite-lib.js)
const URL_PORTAL = 'https://gestao.cmpadvogados.com.br/portal.html'

// Precisamos de nome + relato do caso + e-mail + telefone, mas NÃO em ordem
// fixa — pedido do dono, 24/08/2026: gente respondendo fora de ordem (ou
// mandando dois dados juntos) virava lead com dado errado no campo errado.
// Cada mensagem que chega é classificada pelo FORMATO (parece e-mail? parece
// telefone? parece nome curto?); o que não casar com nenhum vira parte do
// relato. Depois de cada mensagem, pergunta-se só o que ainda falta.
function extraiEmail(t) {
  const m = String(t || '').match(/[\w.+-]+@[\w-]+\.[\w.-]{2,}/)
  return m ? m[0] : null
}
function pareceTelefone(t) {
  const s = String(t || '').trim()
  const digitos = s.replace(/\D/g, '')
  if (digitos.length < 10 || digitos.length > 13) return false
  const semFormatacao = s.replace(/[\s()\-+.]/g, '')
  return semFormatacao === digitos   // sobrou só dígito — não tinha texto solto junto
}
// nome de verdade é curto, só letras/espaço/hífen, sem dígito e sem
// pontuação de frase (evita "Trabalhei 4 anos e 5 meses..." virar nome)
function pareceNome(t) {
  const s = String(t || '').trim()
  if (!s || s.length > 45) return false
  if (/\d/.test(s)) return false
  if (/[.!?;:]/.test(s)) return false
  const palavras = s.split(/\s+/).filter(Boolean)
  if (!palavras.length || palavras.length > 5) return false
  return /^[A-Za-zÀ-ÿ' -]+$/.test(s)
}

export default function ClientePage() {
  const [msgs, setMsgs] = useState([])
  const [passo, setPasso] = useState('coletando')   // coletando (nome/mensagem/email/tel, em qualquer ordem) -> fim
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [leadId, setLeadId] = useState(null)
  const [ref, setRef] = useState('')
  const [numeroProcesso, setNumeroProcesso] = useState('')  // nº do caso já aberto no Gestão (data/hora — sem risco de duplicidade)
  const [pensando, setPensando] = useState(false)   // "digitando…" enquanto a IA responde na fase de contratação
  const [saidaAviso, setSaidaAviso] = useState(false)
  const scrollRef = useRef(null)
  const inputRef = useRef(null)
  const fileRef = useRef(null)
  const dados = useRef({ nome: '', mensagem: '', email: '', tel: '' })
  const leadIdRef = useRef(null)   // evita duas criações em paralelo (arquivo + texto quase juntos)
  const saidaAvisoMostradoRef = useRef(false)
  const syncLenRef = useRef(0)      // quantas entradas de crm_leads.conversa já refletimos aqui (evita duplicar)
  const humanoAvisadoRef = useRef(false)

  const addBot = useCallback((t) => setMsgs(m => [...m, { de: 'bot', texto: t }]), [])
  const addUser = useCallback((t) => setMsgs(m => [...m, { de: 'user', texto: t }]), [])

  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight }, [msgs])
  useEffect(() => { if (inputRef.current) inputRef.current.focus() }, [passo])

  // Alguém da equipe pode responder direto pela ficha do lead no sistema
  // (grava em crm_leads.conversa) — este polling traz essa resposta pro chat
  // do visitante sem precisar recarregar a página. Roda assim que o lead
  // existe (não só depois de e-mail/WhatsApp capturados): a equipe pode
  // assumir a conversa a qualquer momento, mesmo na fase de captura.
  useEffect(() => {
    if (!leadId) return
    const iv = setInterval(async () => {
      if (!leadIdRef.current) return
      try {
        const r = await fetch('/api/lead-chat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ acao: 'sincronizar', id: leadIdRef.current, desde: syncLenRef.current }),
        })
        const j = await r.json()
        if (j && j.ok && Array.isArray(j.conversa) && j.conversa.length) {
          j.conversa.forEach((entrada) => { if (entrada && (entrada.de === 'staff' || entrada.de === 'bot')) addBot(entrada.texto) })
          syncLenRef.current = j.total
        }
      } catch (e) { /* tenta de novo no próximo ciclo */ }
    }, 5000)
    return () => clearInterval(iv)
  }, [leadId, addBot])

  // Dificulta fechar a página sem querer ANTES de termos e-mail e WhatsApp — o
  // navegador mostra um aviso nativo de confirmação (o texto é fixo, definido
  // pelo próprio navegador; não dá pra personalizar). Funciona bem no
  // computador; em boa parte dos celulares (Safari/Chrome iOS, principalmente)
  // o aviso é ignorado — não é uma trava de verdade, só um reforço. Desliga
  // sozinho assim que os dois dados já estiverem capturados.
  useEffect(() => {
    function aoTentarSair(e) {
      if (passo === 'fim') return
      e.preventDefault()
      e.returnValue = ''
      return ''
    }
    window.addEventListener('beforeunload', aoTentarSair)
    return () => window.removeEventListener('beforeunload', aoTentarSair)
  }, [passo])

  // "Intenção de saída" no computador — o mouse sair por cima da janela é o
  // sinal clássico de "vou fechar a aba/trocar de aba". Aí sim dá pra mostrar
  // um aviso NOSSO (não é dialog do navegador) com botão de WhatsApp de
  // verdade. Só uma vez por visita, e só depois que já existe conversa (nome
  // capturado) — não faz sentido interceptar quem ainda nem começou. Não
  // existe equivalente confiável em celular (a maioria dos visitantes).
  useEffect(() => {
    function aoMouseSairDoTopo(e) {
      if (saidaAvisoMostradoRef.current) return
      if (!leadIdRef.current) return
      if (e.clientY > 0) return
      saidaAvisoMostradoRef.current = true
      setSaidaAviso(true)
    }
    document.addEventListener('mouseleave', aoMouseSairDoTopo)
    return () => document.removeEventListener('mouseleave', aoMouseSairDoTopo)
  }, [])

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
        const msgBot = 'Oi, ' + nomeQ.split(' ')[0] + '! 👋 Aqui é do escritório Crispim Mendonça e Pinheiro' + (j.ok ? (' (atendimento ' + j.ref + ')') : '') + '.'
        addBot(msgBot)
        await registrarMsg('bot', msgBot)
        await perguntarProximo()
      } else {
        addBot('Oi! 👋 Aqui é do escritório Crispim Mendonça e Pinheiro. Qual é o seu nome?')
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
  // Grava UMA entrada em crm_leads.conversa — usado na fase de captura (nome,
  // mensagem, e-mail, telefone), que antes só ia para `obs` e por isso não
  // aparecia na ficha do lead nem na tela "Chats" do sistema. Incrementa
  // syncLenRef ANTES do fetch (não depois) para o polling de cima nunca
  // reproduzir localmente uma mensagem que a própria aba acabou de mandar.
  async function registrarMsg(de, texto) {
    if (!leadIdRef.current || !texto) return
    syncLenRef.current += 1
    try {
      await fetch('/api/lead-chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'msg', id: leadIdRef.current, de, texto }),
      })
    } catch (e) { /* melhor esforço — não trava a conversa */ }
  }

  // Classifica a mensagem pelo FORMATO (não pelo passo em que estamos) e
  // grava tudo — sem perder nada mesmo quando a pessoa responde fora de
  // ordem ou manda dois dados na mesma mensagem.
  async function processarResposta(t) {
    const emailAchado = extraiEmail(t)
    const telAchado = (!dados.current.tel && !emailAchado && pareceTelefone(t)) ? t.replace(/\D/g, '') : null
    const nomeAchado = (!dados.current.nome && !emailAchado && !telAchado && pareceNome(t)) ? t : null
    const ehMensagem = !emailAchado && !telAchado && !nomeAchado

    if (nomeAchado) dados.current.nome = nomeAchado
    if (emailAchado && !dados.current.email) dados.current.email = emailAchado
    if (telAchado) dados.current.tel = telAchado
    if (ehMensagem) dados.current.mensagem = dados.current.mensagem ? (dados.current.mensagem + '\n' + t) : t

    if (!leadIdRef.current) await criarLead({})
    const patch = {}
    if (nomeAchado) patch.nome = nomeAchado
    if (emailAchado && dados.current.email === emailAchado) patch.email = emailAchado
    if (telAchado) patch.tel = telAchado
    if (ehMensagem) patch.mensagem = t
    if (Object.keys(patch).length) await atualizarLead(patch)

    await registrarMsg('user', t)
  }

  // Depois de cada mensagem, pergunta só o que ainda falta — nome primeiro,
  // depois o relato, depois e-mail, depois telefone. Se já tem tudo, quem
  // chamou já deve ter chamado concluirCaptura() em vez desta.
  async function perguntarProximo() {
    let msgBot
    if (!dados.current.nome) msgBot = 'Antes de mais nada, qual é o seu nome?'
    else if (!dados.current.mensagem) msgBot = 'Prazer, ' + dados.current.nome.split(' ')[0] + '! Me conta rapidinho o que está acontecendo — pode mandar prints ou documentos também, se quiser.'
    else if (!dados.current.email) msgBot = 'Qual é o seu e-mail, pra mantermos contato?'
    else if (!dados.current.tel) msgBot = 'E o seu WhatsApp (com DDD), pra continuarmos por lá também?'
    else return
    addBot(msgBot)
    await registrarMsg('bot', msgBot)
  }

  async function enviar(e) {
    e && e.preventDefault()
    const t = texto.trim()
    if (!t || enviando) return
    setEnviando(true)
    addUser(t)
    setTexto('')

    if (passo === 'coletando') {
      await processarResposta(t)
      const d = dados.current
      if (d.nome && d.mensagem && d.email && d.tel) await concluirCaptura()
      else await perguntarProximo()
    } else {
      // fase de contratação: o chat CONTINUA conversando de verdade, não fica
      // mudo até o cliente ir pro WhatsApp ou alguém da equipe assumir. Se a
      // equipe já assumiu por dentro do sistema, o servidor não manda resposta
      // (humano:true) — a resposta do atendente chega pelo polling (sincronizar).
      setPensando(true)
      try {
        const r = await fetch('/api/lead-chat', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ acao: 'responder', id: leadIdRef.current, mensagem: t }),
        })
        const j = await r.json()
        if (j && j.ok && j.humano) {
          syncLenRef.current += 1
          if (!humanoAvisadoRef.current) { humanoAvisadoRef.current = true; addBot('🧑‍💼 Alguém da nossa equipe já está com você aqui — só um instante!') }
        } else {
          syncLenRef.current += 2
          addBot((j && j.resposta) || 'Recebi! Se preferir, continue direto no WhatsApp 👇')
        }
      } catch (err) {
        addBot('Recebi sua mensagem! Se quiser garantir resposta rápida, use o WhatsApp abaixo.')
      }
      setPensando(false)
    }
    setEnviando(false)
  }

  // e-mail + WhatsApp completos: abre o caso no Gestão AGORA, manda e-mail de
  // confirmação ao cliente (best-effort do servidor) e o chat passa a
  // conversar via IA em vez de simplesmente parar
  async function concluirCaptura() {
    const primeiro = (dados.current.nome || '').split(' ')[0] || ''
    try {
      const r = await fetch('/api/lead-chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'concluir', id: leadIdRef.current }),
      })
      const j = await r.json()
      if (j && j.ok && j.numero) setNumeroProcesso(j.numero)
    } catch (e) { /* segue mesmo sem confirmar — o atendimento já ficou registrado */ }
    const msgBot = 'Perfeito, ' + primeiro + '! Já registrei tudo aqui e nossa equipe já foi avisada — te chamamos em breve. Se quiser adiantar, é só continuar agora mesmo no WhatsApp 👇 Ou me conta mais detalhes do caso que eu já vou anotando.'
    addBot(msgBot)
    await registrarMsg('bot', msgBot)
    setPasso('fim')
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
        await registrarMsg('user', '📎 ' + f.name)
      } catch (err) { addBot('Não consegui enviar "' + f.name + '".') }
    }
    const msgBot = 'Recebido! Pode continuar.'
    addBot(msgBot)
    await registrarMsg('bot', msgBot)
  }

  // qual campo a próxima mensagem provavelmente vai preencher — só pra
  // ajustar o placeholder/teclado do input; a classificação de verdade
  // acontece em processarResposta() e aceita qualquer ordem
  const campo = passo !== 'coletando' ? null
    : !dados.current.nome ? 'nome'
    : !dados.current.mensagem ? 'mensagem'
    : !dados.current.email ? 'email'
    : !dados.current.tel ? 'tel' : null
  const placeholder = campo === 'nome' ? 'Seu nome…' : campo === 'mensagem' ? 'Como podemos ajudar?' : campo === 'email' ? 'Seu e-mail…' : campo === 'tel' ? 'Seu WhatsApp (DDD + número)…' : 'Mensagem…'
  const referenciaWa = numeroProcesso ? ('processo nº ' + numeroProcesso) : (ref ? ('atendimento ' + ref) : '')
  const textoWa = 'Olá! Sou ' + (dados.current.nome || '') + ', vim pelo chat do site' + (referenciaWa ? (' (' + referenciaWa + ')') : '') + '.'
    + (dados.current.mensagem ? (' ' + dados.current.mensagem) : '')
    + '\n\nJá aproveita e instala nosso app pra acompanhar tudo: ' + URL_PORTAL
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
        {passo === 'fim' && pensando && (
          <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 8 }}>
            <div style={{ background: '#fff', borderRadius: 12, padding: '9px 14px', fontSize: 14.5, color: '#8a8f98', boxShadow: '0 1px 1px rgba(0,0,0,.08)' }}>digitando…</div>
          </div>
        )}
        {passo === 'fim' && linkWhats && (
          <div style={{ display: 'flex', justifyContent: 'center', margin: '16px 0 6px' }}>
            <a href={linkWhats} target="_blank" rel="noopener noreferrer"
              style={{ background: '#25D366', color: '#fff', textDecoration: 'none', fontWeight: 700, fontSize: 14.5, padding: '13px 22px', borderRadius: 26, display: 'inline-flex', alignItems: 'center', gap: 8, boxShadow: '0 3px 10px rgba(0,0,0,.18)' }}>
              💬 Falar agora no WhatsApp
            </a>
          </div>
        )}
      </div>

      {saidaAviso && linkWhats && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: '24px 22px', maxWidth: 340, textAlign: 'center', boxShadow: '0 8px 30px rgba(0,0,0,.25)' }}>
            <div style={{ fontSize: 30, marginBottom: 8 }}>👋</div>
            <div style={{ fontWeight: 700, fontSize: 16, color: NAVY, marginBottom: 6 }}>Já vai?</div>
            <p style={{ fontSize: 13.5, color: '#5b6673', margin: '0 0 16px' }}>Continue essa conversa agora mesmo pelo WhatsApp — é mais rápido e ninguém perde o fio.</p>
            <a href={linkWhats} target="_blank" rel="noopener noreferrer" onClick={() => setSaidaAviso(false)}
              style={{ background: '#25D366', color: '#fff', textDecoration: 'none', fontWeight: 700, fontSize: 14.5, padding: '12px 22px', borderRadius: 24, display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              💬 Continuar no WhatsApp
            </a>
            <div>
              <button onClick={() => setSaidaAviso(false)} style={{ background: 'none', border: 0, color: '#8a94a3', fontSize: 13, cursor: 'pointer', textDecoration: 'underline' }}>Continuar aqui</button>
            </div>
          </div>
        </div>
      )}

      <form onSubmit={enviar} style={{ display: 'flex', gap: 8, padding: '10px', background: '#fff', borderTop: '1px solid #ddd', flexShrink: 0, paddingBottom: 'max(10px, env(safe-area-inset-bottom))' }}>
        <input type="file" ref={fileRef} multiple accept="*/*" style={{ display: 'none' }} onChange={anexar} />
        <button type="button" onClick={() => fileRef.current && fileRef.current.click()} title="Anexar print ou documento"
          style={{ width: 42, height: 42, borderRadius: '50%', border: '1px solid #ddd', background: '#fff', fontSize: 17, cursor: 'pointer', flexShrink: 0 }}>📎</button>
        <input ref={inputRef} value={texto} onChange={e => setTexto(e.target.value)} placeholder={placeholder}
          autoComplete="off" enterKeyHint="send"
          type={campo === 'email' ? 'email' : (campo === 'tel' ? 'tel' : 'text')} inputMode={campo === 'email' ? 'email' : (campo === 'tel' ? 'tel' : 'text')}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(e) } }}
          style={{ flex: 1, minWidth: 0, border: '1px solid #ddd', borderRadius: 20, padding: '11px 15px', fontSize: 16 }} />
        <button type="submit" disabled={enviando || !texto.trim()}
          style={{ width: 42, height: 42, borderRadius: '50%', border: 0, background: NAVY, color: '#fff', fontSize: 17, cursor: 'pointer', flexShrink: 0, opacity: (enviando || !texto.trim()) ? .5 : 1 }}>➤</button>
      </form>
    </div>
  )
}
