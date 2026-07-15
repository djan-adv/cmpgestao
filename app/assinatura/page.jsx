'use client'
// Gerar PROCURAÇÃO para assinatura (equivalente ao index.html do assinador antigo).
// Cria o documento no banco do assinador e gera o link público /assinar?d=…&s=…
// que pode ser copiado, mandado por WhatsApp ou enviado por e-mail ao cliente.
import { useEffect, useState } from 'react'
import { signSb } from '../../lib/supabaseAssinatura'
import { apiAssinatura } from '../../lib/assinaturaApi'

const NAVY = '#2E3A4B'

// Modelos de procuração — os mesmos códigos que a tela pública /assinar entende
// (cláusula de honorários + gratuidade da justiça variam por modelo).
const MODELOS = [
  ['trabalhista', 'Trabalhista — 30% + gratuidade da justiça'],
  ['previdenciario', 'Previdenciário — 30% + gratuidade da justiça'],
  ['civel30g', 'Cível — 30% + gratuidade da justiça'],
  ['civel30', 'Cível — 30% (sem gratuidade)'],
  ['civel20g', 'Cível — 20% + gratuidade da justiça'],
  ['civel20', 'Cível — 20% (sem gratuidade)'],
  ['defesag', 'Defesa — sem honorários no êxito, com gratuidade'],
  ['defesa', 'Defesa — sem cláusula de honorários'],
  ['defesa10g', 'Defesa — 10% + gratuidade da justiça'],
  ['defesa10', 'Defesa — 10% (sem gratuidade)'],
]

const estCampo = { width: '100%', padding: 10, border: '1px solid #d9dde3', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }
const estRotulo = { display: 'block', fontSize: 12.5, fontWeight: 600, color: '#5b6673', margin: '12px 0 4px' }

export default function GerarProcuracao() {
  const [modelo, setModelo] = useState('trabalhista')
  const [titulo, setTitulo] = useState('')
  const [tituloManual, setTituloManual] = useState(false)
  const [nome, setNome] = useState('')
  const [email, setEmail] = useState('')
  const [telefone, setTelefone] = useState('')
  const [processo, setProcesso] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null) // {texto, ok}
  const [resultado, setResultado] = useState(null) // {link, nome, email, titulo}

  // chega pré-preenchido quando vem da ficha do processo ou do contato do CRM
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    if (q.get('nome')) setNome(q.get('nome'))
    if (q.get('email')) setEmail(q.get('email'))
    if (q.get('tel')) setTelefone(q.get('tel'))
    if (q.get('processo')) setProcesso(q.get('processo'))
  }, [])

  useEffect(() => {
    if (!tituloManual) setTitulo('Procuração' + (nome.trim() ? ' — ' + nome.trim() : ''))
  }, [nome, tituloManual])

  async function gerar() {
    setBusy(true); setMsg({ texto: 'Criando o documento…', ok: true }); setResultado(null)
    const r = await apiAssinatura({
      acao: 'criar',
      tipo: 'procuracao',
      modelo,
      titulo: titulo.trim() || 'Procuração',
      signatarios: [{ nome: nome.trim() || null, email: email.trim() || null }],
    })
    if (!r.ok) { setMsg({ texto: r.erro || 'Não foi possível criar.', ok: false }); setBusy(false); return }
    const sig = r.signatarios[0]
    const link = window.location.origin + '/assinar?d=' + r.doc_id + '&s=' + sig.token
    setResultado({ link, nome: nome.trim(), email: email.trim(), titulo: titulo.trim() || 'Procuração' })
    if (email.trim()) {
      setMsg({ texto: 'Documento criado. Enviando o e-mail…', ok: true })
      const ok = await enviarEmail(link, email.trim(), nome.trim(), titulo.trim() || 'Procuração')
      setMsg(ok
        ? { texto: '✓ Procuração criada e e-mail enviado para ' + email.trim() + '.', ok: true }
        : { texto: 'Procuração criada, mas o e-mail falhou — use os botões abaixo (Copiar/WhatsApp/Reenviar).', ok: false })
    } else {
      setMsg({ texto: '✓ Procuração criada! Envie o link ao cliente pelos botões abaixo.', ok: true })
    }
    setBusy(false)
  }

  async function enviarEmail(link, to, nomeSig, tituloDoc) {
    try {
      const r = await signSb.functions.invoke('enviar-email', { body: { to, nome: nomeSig || '', titulo: tituloDoc, link } })
      return !(r.error || (r.data && r.data.ok === false))
    } catch { return false }
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 22 }}>
      <div style={{ background: '#fff', border: '1px solid #d9dde3', borderRadius: 12, padding: 22 }}>
        <div style={{ fontSize: 12, color: '#b8912f', fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5 }}>Nova procuração</div>
        <h2 style={{ margin: '4px 0 4px', fontSize: 17, color: NAVY }}>Gerar link de assinatura</h2>
        <p style={{ fontSize: 13, color: '#5b6673', margin: '0 0 8px' }}>
          O cliente abre o link, completa os próprios dados (CPF, endereço…) e assina online.
          A cópia assinada vai por e-mail para ele e para o escritório.
        </p>

        <label style={estRotulo}>Modelo da procuração *</label>
        <select value={modelo} onChange={e => setModelo(e.target.value)} style={estCampo}>
          {MODELOS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
        </select>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={estRotulo}>Nome do cliente (opcional)</label>
            <input value={nome} onChange={e => setNome(e.target.value)} placeholder="ex.: Maria da Silva" style={estCampo} />
          </div>
          <div>
            <label style={estRotulo}>E-mail do cliente (opcional)</label>
            <input value={email} onChange={e => setEmail(e.target.value)} type="email" placeholder="para enviar o link automaticamente" style={estCampo} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={estRotulo}>WhatsApp do cliente (opcional)</label>
            <input value={telefone} onChange={e => setTelefone(e.target.value)} placeholder="(83) 90000-0000" style={estCampo} />
          </div>
          <div>
            <label style={estRotulo}>Processo vinculado (opcional)</label>
            <input value={processo} onChange={e => setProcesso(e.target.value)} placeholder="número do processo" style={estCampo} />
          </div>
        </div>
        <label style={estRotulo}>Título do documento</label>
        <input value={titulo} onChange={e => { setTitulo(e.target.value); setTituloManual(true) }} style={estCampo} />

        <button onClick={gerar} disabled={busy} style={{
          marginTop: 16, padding: '11px 20px', background: busy ? '#a9b3c1' : NAVY, color: '#fff',
          border: 0, borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: busy ? 'default' : 'pointer',
        }}>{busy ? 'Gerando…' : 'Gerar procuração'}</button>

        {msg && <div style={{
          fontSize: 13, marginTop: 12, padding: '10px 12px', borderRadius: 8,
          background: msg.ok ? '#eaf6ef' : '#fdecea', color: msg.ok ? '#1f7a44' : '#b3261e',
          border: '1px solid ' + (msg.ok ? '#a9d7bd' : '#f2b8b3'),
        }}>{msg.texto}</div>}

        {resultado && (
          <div style={{ background: '#f4f5f7', border: '1px solid #d9dde3', borderRadius: 8, padding: '12px 14px', marginTop: 14, fontSize: 13 }}>
            <b>{resultado.nome || 'Cliente'}</b>{resultado.email ? <span style={{ color: '#5b6673' }}> · {resultado.email}</span> : null}
            <div style={{ wordBreak: 'break-all', color: '#274b7d', fontSize: 12, margin: '6px 0' }}>{resultado.link}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button onClick={e => { navigator.clipboard.writeText(resultado.link); e.currentTarget.textContent = 'Copiado!' }}
                style={{ border: 0, borderRadius: 6, padding: '7px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', background: '#e6e9ee', color: '#1c2733' }}>Copiar link</button>
              <button onClick={() => {
                const texto = 'Olá' + (resultado.nome ? ' ' + resultado.nome : '') + '! Segue o link para assinar: ' + resultado.titulo + ' — ' + resultado.link
                const num = telefone.replace(/\D/g, '')
                window.open('https://wa.me/' + (num ? (num.length <= 11 ? '55' + num : num) : '') + '?text=' + encodeURIComponent(texto), '_blank')
              }} style={{ border: 0, borderRadius: 6, padding: '7px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', background: '#25d366', color: '#063d1e' }}>WhatsApp</button>
              {resultado.email && <button onClick={async e => {
                const b = e.currentTarget; b.disabled = true; b.textContent = 'Enviando…'
                const ok = await enviarEmail(resultado.link, resultado.email, resultado.nome, resultado.titulo)
                b.disabled = false; b.textContent = ok ? 'Reenviado ✓' : 'Falhou — tentar de novo'
              }} style={{ border: 0, borderRadius: 6, padding: '7px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', background: NAVY, color: '#fff' }}>Reenviar e-mail</button>}
            </div>
          </div>
        )}
      </div>

      <p style={{ fontSize: 12, color: '#697180', marginTop: 14 }}>
        Acompanhe quem já assinou no <a href="/assinatura/painel" style={{ color: NAVY, fontWeight: 600 }}>Painel</a>.
        Para contratos e outros PDFs, use <a href="/assinatura/avulso" style={{ color: NAVY, fontWeight: 600 }}>PDF avulso</a>.
      </p>
    </div>
  )
}
