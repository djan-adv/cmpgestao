'use client'
// Painel do assinador (equivalente ao admin.html do site antigo): lista todos os
// documentos, status, busca/filtros, detalhe com trilha de auditoria e as ações
// de reenviar link, corrigir e-mail, baixar PDF (final ou parcial) e excluir.
import { useEffect, useState, useCallback } from 'react'
import { signSb } from '../../../lib/supabaseAssinatura'
import { apiAssinatura } from '../../../lib/assinaturaApi'

const NAVY = '#2E3A4B'
const CORES = {
  assinado: { bg: '#eaf6ef', fg: '#1f7a44' },
  enviado: { bg: '#eef1f5', fg: '#5b6673' },
  parcial: { bg: '#fff6d8', fg: '#8a6d00' },
  rascunho: { bg: '#f0f0f0', fg: '#777' },
  cancelado: { bg: '#fdecea', fg: '#b3261e' },
}
const FILTROS = [['todos', 'Todos'], ['assinado', 'Assinados'], ['enviado', 'Pendentes'], ['parcial', 'Parciais'], ['cancelado', 'Cancelados']]

function Badge({ st }) {
  const c = CORES[st] || CORES.enviado
  return <span style={{ display: 'inline-block', fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 20, textTransform: 'uppercase', background: c.bg, color: c.fg }}>{st}</span>
}
const fmtData = s => { if (!s) return '—'; try { return new Date(s).toLocaleString('pt-BR') } catch { return s } }
const fmtDataCurta = s => { if (!s) return '—'; try { return new Date(s).toLocaleDateString('pt-BR') } catch { return s } }

// carrega o pdf-lib do CDN só quando precisa (montagem do PDF parcial)
function carregarPdfLib() {
  return new Promise((res, rej) => {
    if (window.PDFLib) return res(window.PDFLib)
    const s = document.createElement('script')
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js'
    s.onload = () => res(window.PDFLib); s.onerror = () => rej(new Error('não foi possível carregar o gerador de PDF'))
    document.head.appendChild(s)
  })
}

const btnAcao = (bg, fg) => ({ border: 0, background: bg, color: fg, borderRadius: 6, padding: '6px 9px', fontSize: 14, cursor: 'pointer', lineHeight: 1, marginLeft: 6 })

export default function PainelAssinaturas() {
  const [docs, setDocs] = useState([])
  const [erro, setErro] = useState('')
  const [busca, setBusca] = useState('')
  const [filtro, setFiltro] = useState('todos')
  const [detalhe, setDetalhe] = useState(null) // {documento, signatarios, eventos}
  const [sigUrls, setSigUrls] = useState({})   // assinatura_path -> url temporária
  const [carregando, setCarregando] = useState(true)

  const carregar = useCallback(async () => {
    setCarregando(true)
    const r = await apiAssinatura({ acao: 'listar' })
    if (!r.ok) { setErro(r.erro || 'Falha ao carregar.'); setCarregando(false); return }
    setErro('')
    setDocs((r.documentos || []).map(d => {
      const sigs = (d.signatarios || []).slice().sort((a, b) => (a.ordem || 0) - (b.ordem || 0))
      const assinados = sigs.filter(s => s.status === 'assinado')
      return {
        ...d, sigs,
        sig1: sigs[0] || null,
        total: sigs.length,
        assinados: assinados.length,
        assinantes: assinados.map(s => s.nome || s.email).join(', '),
      }
    }))
    setCarregando(false)
  }, [])
  useEffect(() => { carregar() }, [carregar])

  function linkDe(doc, sig) {
    const base = doc.tipo === 'procuracao' ? '/assinar' : '/assinar-doc'
    return window.location.origin + base + '?d=' + doc.id + '&s=' + sig.token
  }

  const lista = docs
    .filter(d => filtro === 'todos' || d.status === filtro)
    .filter(d => {
      const q = busca.toLowerCase().trim()
      if (!q) return true
      return [d.titulo, ...(d.sigs.flatMap(s => [s.nome, s.email, s.cpf]))].map(x => (x || '').toLowerCase()).join(' ').includes(q)
    })

  async function excluir(d) {
    if (!confirm('Excluir "' + (d.titulo || 'documento') + '"?\n\nIsso remove o documento, as assinaturas e a trilha de auditoria. Não pode ser desfeito.')) return
    const r = await apiAssinatura({ acao: 'excluir', doc_id: d.id })
    if (!r.ok) { alert('Não foi possível excluir: ' + (r.erro || '')); return }
    setDocs(ds => ds.filter(x => x.id !== d.id))
  }

  async function reenviar(d, btn) {
    const pend = d.sigs.filter(s => s.status !== 'assinado' && s.email)
    if (!pend.length) { alert('Não há signatários pendentes com e-mail cadastrado neste documento.'); return }
    if (btn) { btn.disabled = true; btn.textContent = '…' }
    let ok = 0
    for (const s of pend) {
      const r = await signSb.functions.invoke('enviar-email', { body: { to: s.email, nome: s.nome || '', titulo: d.titulo || 'documento', link: linkDe(d, s) } })
      if (!(r.error || (r.data && r.data.ok === false))) ok++
    }
    if (btn) { btn.disabled = false; btn.textContent = '↻' }
    alert('E-mail reenviado para ' + ok + ' de ' + pend.length + ' signatário(s) pendente(s).')
  }

  async function corrigirEmail(d) {
    const pend = d.sigs.filter(s => s.status !== 'assinado')
    if (!pend.length) { alert('Todos os signatários já assinaram — não há e-mail pendente para corrigir.'); return }
    let alvo = pend[0]
    if (pend.length > 1) {
      const listaTxt = pend.map((s, i) => (i + 1) + ') ' + (s.nome || '(sem nome)') + ' — ' + (s.email || '(sem e-mail)')).join('\n')
      const escolha = prompt('Há vários signatários pendentes. Digite o número de quem corrigir:\n\n' + listaTxt, '1')
      if (escolha === null) return
      const idx = parseInt(escolha, 10) - 1
      if (isNaN(idx) || idx < 0 || idx >= pend.length) { alert('Número inválido.'); return }
      alvo = pend[idx]
    }
    const novo = prompt('Corrigir e-mail de ' + (alvo.nome || 'signatário pendente') + ':', alvo.email || '')
    if (novo === null) return
    if (!/.+@.+\..+/.test(novo.trim())) { alert('E-mail inválido.'); return }
    const r = await apiAssinatura({ acao: 'email', sig_id: alvo.id, email: novo.trim() })
    if (!r.ok) { alert('Não foi possível salvar: ' + (r.erro || '')); return }
    await carregar()
    alert('E-mail atualizado. Agora clique em ↻ para reenviar o link a quem não assinou.')
  }

  async function baixarPdf(docId) {
    const r = await apiAssinatura({ acao: 'signed', bucket: 'documentos', path: docId + '.pdf' })
    if (r.ok && r.url) { window.open(r.url, '_blank'); return }
    const r2 = await apiAssinatura({ acao: 'signed', bucket: 'documentos', path: docId + '/assinado.pdf' })
    if (r2.ok && r2.url) { window.open(r2.url, '_blank'); return }
    alert('PDF ainda não disponível para este documento.')
  }

  async function verAssinatura(path) {
    const r = await apiAssinatura({ acao: 'signed', bucket: 'assinaturas', path })
    if (!r.ok) { alert('Não foi possível abrir: ' + (r.erro || '')); return }
    setSigUrls(u => ({ ...u, [path]: r.url }))
  }

  // PDF "parcial": original + página com as assinaturas já coletadas (documentos avulsos)
  async function baixarParcial(d, btn) {
    const orig = btn ? btn.textContent : ''
    if (btn) { btn.disabled = true; btn.textContent = '…' }
    try {
      const det = await apiAssinatura({ acao: 'detalhe', doc_id: d.id })
      if (!det.ok) throw new Error(det.erro || 'falha ao carregar')
      const doc = det.documento, sigs = det.signatarios || []
      if (!doc.arquivo_path) throw new Error('Documento sem arquivo original.')
      const orl = await apiAssinatura({ acao: 'signed', bucket: 'documentos', path: doc.arquivo_path })
      if (!orl.ok) throw new Error(orl.erro || 'arquivo original indisponível')
      const origBytes = await (await fetch(orl.url)).arrayBuffer()
      const { PDFDocument, StandardFonts, rgb } = await carregarPdfLib()
      const pdf = await PDFDocument.load(origBytes)
      const font = await pdf.embedFont(StandardFonts.Helvetica)
      const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
      const navy = rgb(.12, .20, .31)
      let page = pdf.addPage([595.28, 841.89]); const M = 56; let y = 785
      page.drawText('ASSINATURAS COLETADAS ATÉ O MOMENTO', { x: M, y, size: 13, font: bold, color: navy }); y -= 10
      page.drawLine({ start: { x: M, y }, end: { x: 539, y }, thickness: 1.2, color: navy }); y -= 22
      page.drawText('Documento: ' + (doc.titulo || ''), { x: M, y, size: 11, font }); y -= 26
      for (const s of sigs) {
        if (y < 150) { page = pdf.addPage([595.28, 841.89]); y = 785 }
        const assinou = s.status === 'assinado'
        if (assinou && s.assinatura_path) {
          try {
            const su = await apiAssinatura({ acao: 'signed', bucket: 'assinaturas', path: s.assinatura_path })
            if (su.ok) {
              const png = await pdf.embedPng(await (await fetch(su.url)).arrayBuffer())
              const w = 150, h = Math.min(png.height * w / png.width, 55)
              page.drawImage(png, { x: M, y: y - h + 8, width: w, height: h })
            }
          } catch { /* segue sem a imagem */ }
        }
        page.drawLine({ start: { x: M, y: y - 52 }, end: { x: M + 220, y: y - 52 }, thickness: .7, color: rgb(.4, .4, .4) })
        let yy = y - 66; const L = (t, b) => { page.drawText(t, { x: M, y: yy, size: 10, font: b ? bold : font, color: rgb(.1, .1, .1) }); yy -= 14 }
        L((s.nome || s.email || '') + (assinou ? '' : '  [PENDENTE]'), true)
        if (s.cpf) L('CPF: ' + s.cpf)
        L('E-mail: ' + (s.email || ''))
        L(assinou ? ('Assinado em ' + (s.assinado_em ? new Date(s.assinado_em).toLocaleString('pt-BR') : '')) : 'Ainda não assinou')
        y = yy - 16
      }
      const bytes = await pdf.save()
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
      const a = document.createElement('a'); a.href = url; a.download = (doc.titulo || 'documento').replace(/[^\w\-]+/g, '_') + '_parcial.pdf'; a.click()
    } catch (e) { alert('Não foi possível montar o PDF: ' + (e.message || e)) }
    if (btn) { btn.disabled = false; btn.textContent = orig }
  }

  async function abrirDetalhe(d) {
    setSigUrls({})
    setDetalhe({ carregando: true })
    const r = await apiAssinatura({ acao: 'detalhe', doc_id: d.id })
    if (!r.ok) { setDetalhe({ erro: r.erro || 'falha' }); return }
    setDetalhe(r)
  }

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: 22 }}>
      <div style={{ background: '#fff', border: '1px solid #d9dde3', borderRadius: 12, padding: 20 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 16, color: NAVY }}>Documentos</h2>
        <p style={{ fontSize: 13, color: '#5b6673', margin: '0 0 12px' }}>Todos os documentos enviados para assinatura e o status de cada um.</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por nome, e-mail, CPF ou título…"
            style={{ flex: 1, minWidth: 180, padding: '10px 12px', border: '1px solid #d9dde3', borderRadius: 8, fontSize: 14 }} />
          <button onClick={carregar} style={{ padding: '10px 16px', background: NAVY, color: '#fff', border: 0, borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}>Atualizar</button>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {FILTROS.map(([v, r]) => (
            <span key={v} onClick={() => setFiltro(v)} style={{
              border: '1px solid ' + (filtro === v ? NAVY : '#d9dde3'), background: filtro === v ? '#eef3fa' : '#fff',
              color: filtro === v ? NAVY : '#5b6673', fontWeight: filtro === v ? 600 : 400,
              borderRadius: 20, padding: '6px 12px', fontSize: 12.5, cursor: 'pointer',
            }}>{r}</span>
          ))}
        </div>
        {erro && <div style={{ fontSize: 13, marginTop: 10, padding: '10px 12px', borderRadius: 8, background: '#fdecea', color: '#b3261e', border: '1px solid #f2b8b3' }}>{erro}</div>}

        <div style={{ marginTop: 12, overflowX: 'auto' }}>
          {carregando ? <div style={{ textAlign: 'center', color: '#5b6673', padding: '30px 10px' }}>Carregando…</div> :
            !lista.length ? <div style={{ textAlign: 'center', color: '#5b6673', padding: '30px 10px' }}>Nenhum documento encontrado.</div> : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
                <thead><tr>
                  {['Documento', 'Signatário', 'Status', 'Assinado em', 'Criado', ''].map(h =>
                    <th key={h} style={{ textAlign: 'left', color: '#5b6673', fontWeight: 600, fontSize: 12, textTransform: 'uppercase', padding: '8px 10px', borderBottom: '2px solid #d9dde3' }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {lista.map(d => {
                    const pend = d.status !== 'assinado' && d.status !== 'cancelado'
                    return (
                      <tr key={d.id} onClick={() => abrirDetalhe(d)} style={{ cursor: 'pointer' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#f9fbfd'} onMouseLeave={e => e.currentTarget.style.background = ''}>
                        <td style={{ padding: 10, borderBottom: '1px solid #eef0f3', maxWidth: 300, wordBreak: 'break-word' }}>
                          <b>{d.titulo || '—'}</b>
                          <div style={{ color: '#5b6673', fontSize: 12 }}>{d.modelo || d.tipo || ''}</div>
                        </td>
                        <td style={{ padding: 10, borderBottom: '1px solid #eef0f3' }}>
                          {d.sig1?.nome || '—'}
                          <div style={{ color: '#5b6673', fontSize: 12 }}>{d.sig1?.email || ''}{d.sig1?.cpf ? ' · ' + d.sig1.cpf : ''}</div>
                          {d.total > 1
                            ? <div style={{ fontSize: 12, color: '#1f7a44', marginTop: 2 }}>{d.assinados} de {d.total} assinaram{d.assinantes ? ': ' + d.assinantes : ''}</div>
                            : (d.assinantes ? <div style={{ fontSize: 12, color: '#1f7a44', marginTop: 2 }}>✓ {d.assinantes} assinou</div> : null)}
                        </td>
                        <td style={{ padding: 10, borderBottom: '1px solid #eef0f3' }}><Badge st={d.status} /></td>
                        <td style={{ padding: 10, borderBottom: '1px solid #eef0f3' }}>{d.sig1?.assinado_em ? fmtDataCurta(d.sig1.assinado_em) : <span style={{ color: '#5b6673' }}>—</span>}</td>
                        <td style={{ padding: 10, borderBottom: '1px solid #eef0f3', color: '#5b6673' }}>{fmtDataCurta(d.criado_em)}</td>
                        <td style={{ padding: 10, borderBottom: '1px solid #eef0f3', whiteSpace: 'nowrap', textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                          {d.tipo === 'upload' && <button title="Baixar PDF no estado atual (parcial)" style={btnAcao('#eaf6ef', '#1f7a44')} onClick={e => baixarParcial(d, e.currentTarget)}>⤓</button>}
                          {pend && <>
                            <button title="Corrigir e-mail de quem não assinou" style={btnAcao('#fff6d8', '#8a6d00')} onClick={() => corrigirEmail(d)}>✎</button>
                            <button title="Reenviar e-mail para quem não assinou" style={btnAcao('#eef3fa', NAVY)} onClick={e => reenviar(d, e.currentTarget)}>↻</button>
                          </>}
                          <button title="Excluir documento" style={btnAcao('#fdecea', '#b3261e')} onClick={() => excluir(d)}>🗑</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
        </div>
      </div>

      {detalhe && (
        <div onClick={e => { if (e.target === e.currentTarget) setDetalhe(null) }} style={{
          position: 'fixed', inset: 0, background: 'rgba(20,30,45,.45)', display: 'flex',
          alignItems: 'flex-start', justifyContent: 'center', padding: '30px 16px', zIndex: 50, overflow: 'auto',
        }}>
          <div style={{ background: '#fff', borderRadius: 12, maxWidth: 680, width: '100%', padding: 22 }}>
            <button onClick={() => setDetalhe(null)} style={{ float: 'right', cursor: 'pointer', color: '#5b6673', fontSize: 20, lineHeight: 1, border: 0, background: 'none' }}>×</button>
            {detalhe.carregando ? <p style={{ color: '#5b6673' }}>Carregando…</p> :
              detalhe.erro ? <p style={{ color: '#b3261e' }}>{detalhe.erro}</p> : (
                <>
                  <h3 style={{ margin: '0 0 2px', color: NAVY, fontSize: 16 }}>{detalhe.documento.titulo || 'Documento'}</h3>
                  <div style={{ fontSize: 13, color: '#5b6673' }}>{detalhe.documento.modelo || detalhe.documento.tipo || ''} · criado em {fmtData(detalhe.documento.criado_em)}</div>
                  <div style={{ fontSize: 13, margin: '6px 0' }}>Status: <Badge st={detalhe.documento.status} /></div>
                  <div style={{ marginTop: 8 }}>
                    <a onClick={() => baixarPdf(detalhe.documento.id)} style={{ color: '#274b7d', fontSize: 12.5, cursor: 'pointer', textDecoration: 'underline' }}>baixar PDF assinado</a>
                  </div>
                  <div style={{ marginTop: 16, borderTop: '1px solid #d9dde3', paddingTop: 12 }}>
                    <h4 style={{ margin: '0 0 8px', fontSize: 13, color: '#5b6673', textTransform: 'uppercase' }}>Signatários</h4>
                    {(detalhe.signatarios || []).map(s => (
                      <div key={s.id} style={{ fontSize: 13, margin: '6px 0 10px' }}>
                        <b>{s.nome || '—'}</b> <Badge st={s.status} />
                        <br /><span style={{ color: '#5b6673' }}>{s.email || ''}{s.cpf ? ' · CPF ' + s.cpf : ''}{s.assinado_em ? ' · assinou em ' + fmtData(s.assinado_em) : ''}</span>
                        <div>
                          {s.assinatura_path && !sigUrls[s.assinatura_path] &&
                            <a onClick={() => verAssinatura(s.assinatura_path)} style={{ color: '#274b7d', fontSize: 12.5, cursor: 'pointer', textDecoration: 'underline', marginRight: 12 }}>ver assinatura</a>}
                          <a href={linkDe(detalhe.documento, s)} target="_blank" style={{ color: '#274b7d', fontSize: 12.5, textDecoration: 'underline' }}>abrir link</a>
                        </div>
                        {sigUrls[s.assinatura_path] && <img src={sigUrls[s.assinatura_path]} alt="assinatura" style={{ maxHeight: 80, border: '1px solid #d9dde3', borderRadius: 8, padding: 4, background: '#fbfbfd', marginTop: 6 }} />}
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 16, borderTop: '1px solid #d9dde3', paddingTop: 12 }}>
                    <h4 style={{ margin: '0 0 8px', fontSize: 13, color: '#5b6673', textTransform: 'uppercase' }}>Trilha de auditoria</h4>
                    {!(detalhe.eventos || []).length && <div style={{ color: '#5b6673', fontSize: 12.5 }}>Sem eventos.</div>}
                    {(detalhe.eventos || []).map(e => (
                      <div key={e.id} style={{ fontSize: 12.5, padding: '6px 0', borderBottom: '1px dashed #e3e6ea' }}>
                        <span style={{ color: '#5b6673' }}>{fmtData(e.criado_em)}</span> — <b>{e.tipo}</b> {e.detalhe ? '· ' + e.detalhe : ''}{e.ip ? ' · IP ' + e.ip : ''}
                      </div>
                    ))}
                  </div>
                </>
              )}
          </div>
        </div>
      )}
    </div>
  )
}
