'use client'
// Botão "juntar assinatura recebida por fora" — o cliente assinou à mão no
// celular e mandou o PDF por WhatsApp/e-mail. O escritório sobe o arquivo e o
// servidor monta o PDF final (ver /api/assinatura, ação juntar_externo).
import { useState } from 'react'
import { apiAssinatura } from '../../lib/assinaturaApi'

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
