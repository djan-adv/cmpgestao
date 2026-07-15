'use client'
// Gerar PROCURAÇÃO para assinatura (port do index.html do assinador antigo).
// Escolhe o tipo + gratuidade, gera o link público /assinar?d=…&s=… e envia
// por e-mail automaticamente; dá pra copiar, mandar por WhatsApp ou reenviar.
import { useEffect, useState } from 'react'
import { signSb } from '../../lib/supabaseAssinatura'
import { apiAssinatura } from '../../lib/assinaturaApi'

const NAVY = '#2E3A4B'

// Tipos base — o modelo final vira base + 'g' quando a gratuidade está marcada
// (trabalhista e previdenciária já têm gratuidade embutida no modelo, sem sufixo).
const TIPOS = [
  ['trabalhista', 'Trabalhista (êxito 30%)'],
  ['previdenciario', 'Previdenciária (êxito 30%)'],
  ['civel20', 'Cível (êxito 20%)'],
  ['civel30', 'Cível (êxito 30%)'],
  ['defesa', 'Defesa (sem êxito)'],
  ['defesa10', 'Defesa com êxito (10%)'],
]
const LABELS = {
  trabalhista: 'Procuração Trabalhista', previdenciario: 'Procuração Previdenciária',
  civel20: 'Procuração Cível 20%', civel30: 'Procuração Cível 30%',
  defesa: 'Procuração Defesa', defesa10: 'Procuração Defesa (êxito 10%)',
}
// regras do checkbox de gratuidade por tipo (marcado / travado), como no site antigo
const gratRegra = base =>
  (base === 'trabalhista' || base === 'previdenciario') ? { marcada: true, travada: true }
    : base === 'civel30' ? { marcada: true, travada: false }
      : { marcada: false, travada: false }

const emailValido = e => /.+@.+\..+/.test((e || '').trim())
const estCampo = { width: '100%', padding: '11px 12px', border: '1px solid #d9dde3', borderRadius: 8, fontSize: 15, boxSizing: 'border-box' }
const estRotulo = { display: 'block', fontSize: 12.5, fontWeight: 600, color: '#5b6673', margin: '14px 0 4px' }

export default function GerarProcuracao() {
  const [base, setBase] = useState('trabalhista')
  const [grat, setGrat] = useState(true)
  const [emailCli, setEmailCli] = useState('')
  const [nomeCli, setNomeCli] = useState('')
  const [telefone, setTelefone] = useState('')
  const [processo, setProcesso] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)          // mensagem do formulário
  const [msgEnvio, setMsgEnvio] = useState(null) // mensagem da área do link
  const [resultado, setResultado] = useState(null) // {link, titulo, sig_id}
  const [emailRow, setEmailRow] = useState(false)
  const [emailDest, setEmailDest] = useState('')
  const [hist, setHist] = useState([])

  // chega pré-preenchido quando vem da ficha do processo ou do contato do CRM
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    if (q.get('nome')) setNomeCli(q.get('nome'))
    if (q.get('email')) setEmailCli(q.get('email'))
    if (q.get('tel')) setTelefone(q.get('tel'))
    if (q.get('processo')) setProcesso(q.get('processo'))
  }, [])

  function mudarTipo(v) {
    setBase(v)
    setGrat(gratRegra(v).marcada)
  }
  const regra = gratRegra(base)

  async function gerar() {
    if (!emailValido(emailCli)) { setMsg({ texto: 'Informe um e-mail válido do cliente antes de gerar.', ok: false }); return }
    setBusy(true); setResultado(null); setMsgEnvio(null)
    setMsg({ texto: 'Gerando e enviando…', ok: true })
    const semGrat = base !== 'trabalhista' && base !== 'previdenciario'
    const modelo = semGrat ? base + (grat ? 'g' : '') : base
    const titulo = LABELS[base] + (semGrat && grat ? ' c/ gratuidade' : '')
    const r = await apiAssinatura({
      acao: 'criar', tipo: 'procuracao', modelo, titulo, processo: processo.trim() || null,
      signatarios: [{ nome: nomeCli.trim() || null, email: emailCli.trim() }],
    })
    if (!r.ok) { setMsg({ texto: r.erro || 'Não foi possível criar.', ok: false }); setBusy(false); return }
    const sig = r.signatarios[0]
    const link = window.location.origin + '/assinar?d=' + r.doc_id + '&s=' + sig.token
    setResultado({ link, titulo, sig_id: sig.id })
    setMsg(null)
    setEmailDest(emailCli.trim()); setEmailRow(false)
    setHist(h => [{ titulo, link }, ...h])
    // envio automático por e-mail
    const res = await enviarEmailFn(link, emailCli.trim(), nomeCli.trim(), titulo)
    setMsgEnvio(res
      ? { texto: 'Link criado e e-mail enviado para ' + emailCli.trim() + '.', ok: true }
      : { texto: 'Link criado, mas o e-mail não saiu agora. Use Copiar ou WhatsApp, ou o botão E-mail para reenviar.', ok: false })
    setBusy(false)
  }

  async function enviarEmailFn(link, to, nome, titulo) {
    try {
      const r = await signSb.functions.invoke('enviar-email', { body: { to, nome: nome || '', titulo, link } })
      return !(r.error || (r.data && r.data.ok === false))
    } catch { return false }
  }

  function copiar() { navigator.clipboard.writeText(resultado.link); setMsgEnvio({ texto: 'Link copiado!', ok: true }) }
  function whats() {
    const texto = 'Olá! Segue o link para assinar sua ' + resultado.titulo + ': ' + resultado.link
    const num = telefone.replace(/\D/g, '')
    window.open('https://wa.me/' + (num ? (num.length <= 11 ? '55' + num : num) : '') + '?text=' + encodeURIComponent(texto), '_blank')
  }
  async function reenviar() {
    const to = emailDest.trim()
    if (!emailValido(to)) { setMsgEnvio({ texto: 'Digite um e-mail válido do cliente.', ok: false }); return }
    setMsgEnvio({ texto: 'Enviando…', ok: true })
    // salva/corrige o e-mail no registro do signatário (para os lembretes funcionarem)
    if (resultado.sig_id) { try { await apiAssinatura({ acao: 'email', sig_id: resultado.sig_id, email: to }) } catch { /* segue */ } }
    const ok = await enviarEmailFn(resultado.link, to, '', resultado.titulo)
    setMsgEnvio(ok ? { texto: 'E-mail enviado para ' + to + '.', ok: true } : { texto: 'Não foi possível enviar o e-mail agora. Use Copiar ou WhatsApp.', ok: false })
  }

  const Msg = ({ m }) => m ? (
    <div style={{
      fontSize: 13, marginTop: 12, padding: '10px 12px', borderRadius: 8,
      background: m.ok ? '#eaf6ef' : '#fdecea', color: m.ok ? '#1f7a44' : '#b3261e',
      border: '1px solid ' + (m.ok ? '#a9d7bd' : '#f2b8b3'),
    }}>{m.texto}</div>
  ) : null

  const btnAct = { flex: 1, minWidth: 120, border: 'none', borderRadius: 8, padding: 11, fontSize: 14, fontWeight: 600, cursor: 'pointer' }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: 24 }}>
      <div style={{ background: '#fff', border: '1px solid #d9dde3', borderRadius: 12, padding: 22, marginBottom: 20 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 16, color: NAVY }}>Nova procuração</h2>
        <p style={{ fontSize: 13, color: '#5b6673', margin: '0 0 14px' }}>Escolha o tipo e gere o link. O cliente preenche os dados e assina.</p>

        <label style={estRotulo}>Tipo de procuração</label>
        <select value={base} onChange={e => mudarTipo(e.target.value)} style={estCampo}>
          {TIPOS.map(([v, r]) => <option key={v} value={v}>{r}</option>)}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontWeight: 500, fontSize: 14, color: '#1c2733' }}>
          <input type="checkbox" checked={grat} disabled={regra.travada} onChange={e => setGrat(e.target.checked)} style={{ width: 'auto' }} />
          Incluir requerimento de gratuidade da justiça
        </label>

        <label style={estRotulo}>E-mail do cliente <span style={{ color: '#b3261e' }}>*</span></label>
        <input value={emailCli} onChange={e => setEmailCli(e.target.value)} type="email" placeholder="e-mail de quem vai assinar" style={estCampo} />
        <label style={estRotulo}>Nome do cliente (opcional)</label>
        <input value={nomeCli} onChange={e => setNomeCli(e.target.value)} placeholder="nome de quem vai assinar" style={estCampo} />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={estRotulo}>WhatsApp (opcional)</label>
            <input value={telefone} onChange={e => setTelefone(e.target.value)} placeholder="(83) 90000-0000" style={estCampo} />
          </div>
          <div>
            <label style={estRotulo}>Processo vinculado (opcional)</label>
            <input value={processo} onChange={e => setProcesso(e.target.value)} placeholder="número do processo" style={estCampo} />
          </div>
        </div>

        <button onClick={gerar} disabled={busy} style={{
          border: 'none', borderRadius: 8, padding: '12px 18px', fontSize: 15, fontWeight: 600,
          cursor: busy ? 'not-allowed' : 'pointer', background: busy ? '#a9b3c1' : NAVY, color: '#fff', marginTop: 18, width: '100%',
        }}>Gerar link e enviar por e-mail</button>
        <Msg m={msg} />

        {resultado && (
          <div style={{ marginTop: 16 }}>
            <label style={estRotulo}>Link para o cliente assinar</label>
            <div style={{ background: '#f4f5f7', border: '1px solid #d9dde3', borderRadius: 8, padding: '10px 12px', fontSize: 12.5, wordBreak: 'break-all' }}>{resultado.link}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              <button style={{ ...btnAct, background: '#eef1f5', color: '#1c2733' }} onClick={copiar}>Copiar link</button>
              <button style={{ ...btnAct, background: '#25d366', color: '#063d1e' }} onClick={whats}>WhatsApp</button>
              <button style={{ ...btnAct, background: NAVY, color: '#fff' }} onClick={() => setEmailRow(v => !v)}>E-mail</button>
            </div>
            {emailRow && (
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <input value={emailDest} onChange={e => setEmailDest(e.target.value)} type="email" placeholder="e-mail do cliente" style={{ ...estCampo, flex: 1 }} />
                <button onClick={reenviar} style={{ border: 'none', borderRadius: 8, padding: '0 16px', background: NAVY, color: '#fff', fontWeight: 600, cursor: 'pointer' }}>Enviar</button>
              </div>
            )}
            <Msg m={msgEnvio} />
          </div>
        )}
      </div>

      <div style={{ background: '#fff', border: '1px solid #d9dde3', borderRadius: 12, padding: 22, marginBottom: 20 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 16, color: NAVY }}>Acessar</h2>
        <p style={{ fontSize: 13, color: '#5b6673', margin: '0 0 14px' }}>Veja as procurações enviadas ou suba um contrato/PDF para assinatura.</p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <a href="/assinatura/painel" style={{ flex: 1, minWidth: 200, textDecoration: 'none', textAlign: 'center', background: NAVY, color: '#fff', fontWeight: 600, padding: 16, borderRadius: 10 }}>📁 Procurações enviadas</a>
          <a href="/assinatura/avulso" style={{ flex: 1, minWidth: 200, textDecoration: 'none', textAlign: 'center', background: '#1f7a44', color: '#fff', fontWeight: 600, padding: 16, borderRadius: 10 }}>📄 Subir contrato para assinatura</a>
        </div>
      </div>

      {hist.length > 0 && (
        <div style={{ background: '#fff', border: '1px solid #d9dde3', borderRadius: 12, padding: 22 }}>
          <h2 style={{ margin: '0 0 8px', fontSize: 16, color: NAVY }}>Links gerados nesta sessão</h2>
          {hist.map((h, i) => (
            <div key={i} style={{ margin: '6px 0', fontSize: 12.5, color: '#5b6673' }}>
              <b style={{ color: '#1c2733' }}>{h.titulo}</b> — <a href={h.link} target="_blank" style={{ color: '#274b7d' }}>abrir</a>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
