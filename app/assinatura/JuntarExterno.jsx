'use client'
// Botão "juntar assinatura recebida por fora" — o cliente assinou à mão no
// celular e mandou o PDF por WhatsApp/e-mail. O escritório sobe o arquivo e o
// servidor monta o PDF final (ver /api/assinatura, ação juntar_externo).
import { useState } from 'react'
import { apiAssinatura } from '../../lib/assinaturaApi'

/* "Consegue mostrar se a pessoa leu o documento?" (03/09/2026). O assinador marca
   o signatário como "visto" quando ele abre o link (RPC marcar_visto). Aqui isso
   vira uma linha por pessoa: não abriu / abriu e não assinou / assinou — com a
   hora quando o banco a tiver. */
export function fmtQuando(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return '' }
}
export function fmtHora(iso) {
  if (!iso) return ''
  try { return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) } catch { return '' }
}
/* uma linha por pessoa: quantas vezes abriu, quando abriu a primeira e a última
   vez, e a hora em que assinou. As contagens vêm da trilha de auditoria
   (ver anexarLeitura em /api/assinatura); quando ela não tem o registro, a
   linha diz o que sabe em vez de inventar hora. */
export function statusLeitura(s) {
  const st = String(s.status || '')
  const L = s.leitura || {}
  const n = L.aberturas || 0
  const vezes = n === 1 ? '1 vez' : n + ' vezes'
  const quando = n
    ? (n === 1 ? ' em ' + fmtHora(L.primeira)
               : ' · 1ª em ' + fmtHora(L.primeira) + ' · última em ' + fmtHora(L.ultima))
    : ''
  const abriu = n ? ('abriu ' + vezes + quando) : 'abriu o documento (sem hora registrada)'
  if (st === 'assinado') {
    const h = L.assinado_em || s.assinado_em
    return { icone: '✅', cor: '#0F6E56', texto: 'assinou' + (h ? ' em ' + fmtHora(h) : '') + (n ? ' · ' + abriu : '') }
  }
  if (st === 'visto' || n) return { icone: '👁', cor: '#8a5a00', texto: abriu + ' — ainda não assinou' }
  return { icone: '✉', cor: '#5b6673', texto: 'ainda não abriu o link' }
}
export function LeituraSignatarios({ signatarios }) {
  const sigs = (signatarios || []).slice().sort((a, b) => (a.ordem || 0) - (b.ordem || 0))
  if (!sigs.length) return null
  return (
    <div style={{ marginTop: 4, display: 'grid', gap: 2 }}>
      {sigs.map(s => { const l = statusLeitura(s); return (
        <div key={s.id} style={{ fontSize: 12, color: l.cor }}>{l.icone} <b style={{ color: '#1c2733' }}>{s.nome || s.email || '—'}</b> · {l.texto}</div>
      ) })}
    </div>
  )
}
export function HistoricoDoc({ doc }) {
  const [ev, setEv] = useState(null)
  const [aberto, setAberto] = useState(false)
  async function abrir() {
    setAberto(a => !a)
    if (ev) return
    const r = await apiAssinatura({ acao: 'detalhe', doc_id: doc.id })
    setEv(r.ok ? (r.eventos || []) : [])
  }
  return (
    <span style={{ display: 'inline-block', verticalAlign: 'top' }}>
      <button onClick={abrir} style={{ padding: '6px 10px', border: 0, borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', background: '#eef1f5', color: '#1c2733', marginLeft: 6 }} title="Tudo que aconteceu com este documento: criado, aberto, assinado, e-mails">📜 histórico</button>
      {aberto && (
        <div style={{ marginTop: 8, padding: 10, background: '#fff', border: '1px solid #d9dde3', borderRadius: 8, fontSize: 12, maxWidth: 560 }}>
          {ev === null && <div style={{ color: '#5b6673' }}>Carregando…</div>}
          {ev && !ev.length && <div style={{ color: '#5b6673' }}>Sem eventos registrados.</div>}
          {ev && ev.map(e => (
            <div key={e.id} style={{ padding: '4px 0', borderBottom: '1px dashed #e3e6ea' }}>
              <span style={{ color: '#5b6673' }}>{fmtQuando(e.criado_em)}</span> — <b>{e.tipo}</b>{e.detalhe ? ' · ' + e.detalhe : ''}{e.ip ? ' · IP ' + e.ip : ''}
            </div>
          ))}
        </div>
      )}
    </span>
  )
}

export default function JuntarExterno({ doc, signatarios, aoConcluir }) {
  const [aberto, setAberto] = useState(false)
  const [sigId, setSigId] = useState((signatarios && signatarios[0] && signatarios[0].id) || '')
  const [via, setVia] = useState('WhatsApp')
  const [data, setData] = useState(new Date().toLocaleDateString('pt-BR'))
  const [arq, setArq] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const sigs = signatarios || []
  async function enviar() {
    if (!arq) { setMsg({ ok: false, t: 'Escolha o PDF que o cliente mandou.' }); return }
    if (!sigId) { setMsg({ ok: false, t: 'Escolha quem assinou.' }); return }
    setBusy(true); setMsg({ ok: true, t: 'Montando o PDF final…' })
    try {
      const b64 = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.onerror = rej; fr.readAsDataURL(arq) })
      const r = await apiAssinatura({ acao: 'juntar_externo', doc_id: doc.id, sig_id: sigId, pdf_b64: b64, via, data_recebida: data })
      if (!r.ok) throw new Error(r.erro || 'falha')
      setMsg({ ok: true, t: '✓ Assinatura juntada' + (r.trocas ? ' (caneta recolorida em azul)' : '') + '. E-mail ' + (r.email || '—') + '.', url: r.url })
      if (aoConcluir) aoConcluir(r)
    } catch (e) { setMsg({ ok: false, t: String(e && e.message || e) }) }
    setBusy(false)
  }
  const btn = { padding: '6px 10px', border: 0, borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }
  return (
    <span style={{ display: 'inline-block', verticalAlign: 'top' }}>
      <button style={{ ...btn, background: '#eef3fa', color: '#185FA5', marginLeft: 6 }} onClick={() => setAberto(a => !a)} title="O cliente assinou à mão e mandou o PDF por WhatsApp ou e-mail? Suba aqui: o sistema recolore a caneta em azul, anexa a página de assinaturas com hash e marca como assinado.">
        ✍ juntar assinatura recebida por fora
      </button>
      {aberto && (
        <div style={{ marginTop: 8, padding: 10, background: '#fff', border: '1px solid #d9dde3', borderRadius: 8, fontSize: 12, display: 'grid', gap: 6, maxWidth: 520 }}>
          <div style={{ color: '#5b6673' }}>PDF que o cliente assinou e mandou (com a assinatura dele por cima):</div>
          <input type="file" accept="application/pdf" onChange={e => setArq(e.target.files && e.target.files[0])} />
          {sigs.length > 1 && (
            <label>Quem assinou: <select value={sigId} onChange={e => setSigId(e.target.value)}>{sigs.map(s => <option key={s.id} value={s.id}>{s.nome || s.email}</option>)}</select></label>
          )}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <label>Recebido por: <select value={via} onChange={e => setVia(e.target.value)}><option>WhatsApp</option><option>e-mail</option><option>em mãos</option></select></label>
            <label>em <input value={data} onChange={e => setData(e.target.value)} style={{ width: 90 }} /></label>
          </div>
          <div><button disabled={busy} style={{ ...btn, background: '#0F6E56', color: '#fff' }} onClick={enviar}>{busy ? 'montando…' : 'Juntar e marcar como assinado'}</button></div>
          {msg && <div style={{ color: msg.ok ? '#0F6E56' : '#b5342b' }}>{msg.t} {msg.url && <a href={msg.url} target="_blank" rel="noopener" style={{ color: '#185FA5' }}>abrir PDF final</a>}</div>}
        </div>
      )}
    </span>
  )
}
