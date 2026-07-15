'use client'
// Documento AVULSO (equivalente ao avulso.html do assinador antigo): sobe um PDF,
// Word (.docx) ou imagem, adiciona até 30 signatários e gera os links de assinatura.
// As assinaturas entram no documento com trilha de auditoria.
import { useEffect, useState, useCallback } from 'react'
import { signSb } from '../../../lib/supabaseAssinatura'
import { apiAssinatura } from '../../../lib/assinaturaApi'

const NAVY = '#2E3A4B'
const estCampo = { width: '100%', padding: 10, border: '1px solid #d9dde3', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }
const estRotulo = { display: 'block', fontSize: 12.5, fontWeight: 600, color: '#5b6673', margin: '12px 0 4px' }

// carrega bibliotecas do CDN só quando são necessárias (conversão p/ PDF e montagem final)
function carregarScript(src, pronto) {
  return new Promise((res, rej) => {
    if (pronto()) return res()
    const s = document.createElement('script')
    s.src = src; s.onload = () => res(); s.onerror = () => rej(new Error('falha ao carregar ' + src))
    document.head.appendChild(s)
  })
}
const libJsPdf = () => carregarScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', () => window.jspdf)
const libHtml2Canvas = () => carregarScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js', () => window.html2canvas)
const libMammoth = () => carregarScript('https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js', () => window.mammoth)
const libPdfLib = () => carregarScript('https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js', () => window.PDFLib)

// Converte o arquivo enviado para PDF (PDF passa direto; imagem e .docx são convertidos)
async function toPdf(file) {
  const nome = (file.name || '').toLowerCase()
  if (file.type === 'application/pdf' || nome.endsWith('.pdf')) return file
  await libJsPdf()
  const { jsPDF } = window.jspdf
  const A4W = 210, A4H = 297, M = 12
  if (file.type.startsWith('image/') || /\.(jpe?g|png|webp)$/.test(nome)) {
    const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file) })
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl })
    let w = A4W - 2 * M, h = img.height * w / img.width
    if (h > A4H - 2 * M) { h = A4H - 2 * M; w = img.width * h / img.height }
    const pdf = new jsPDF('p', 'mm', 'a4')
    pdf.addImage(dataUrl, (A4W - w) / 2, M, w, h)
    return pdf.output('blob')
  }
  if (nome.endsWith('.docx')) {
    await libMammoth(); await libHtml2Canvas()
    const arrayBuffer = await file.arrayBuffer()
    const result = await window.mammoth.convertToHtml({ arrayBuffer })
    const div = document.createElement('div')
    div.style.cssText = 'position:fixed;left:-9999px;top:0;width:760px;padding:48px;background:#fff;font-family:Arial,Helvetica,sans-serif;font-size:12pt;line-height:1.5;color:#111;text-align:justify'
    div.innerHTML = result.value || '<p>(documento vazio)</p>'
    document.body.appendChild(div)
    const canvas = await window.html2canvas(div, { scale: 2, backgroundColor: '#ffffff' })
    document.body.removeChild(div)
    const pdf = new window.jspdf.jsPDF('p', 'mm', 'a4')
    const imgH = canvas.height * A4W / canvas.width
    const data = canvas.toDataURL('image/jpeg', 0.92)
    let hLeft = imgH, pos = 0
    pdf.addImage(data, 'JPEG', 0, 0, A4W, imgH); hLeft -= A4H
    while (hLeft > 0) { pos = hLeft - imgH; pdf.addPage(); pdf.addImage(data, 'JPEG', 0, pos, A4W, imgH); hLeft -= A4H }
    return pdf.output('blob')
  }
  if (nome.endsWith('.odt')) throw new Error('ODT não é suportado direto. Salve como PDF ou .docx e envie novamente.')
  throw new Error('Formato não suportado. Envie PDF, Word (.docx) ou imagem.')
}

export default function DocumentoAvulso() {
  const [titulo, setTitulo] = useState('')
  const [arquivo, setArquivo] = useState(null)
  const [signers, setSigners] = useState([{ nome: '', email: '' }, { nome: '', email: '' }])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [links, setLinks] = useState([])
  const [avulsos, setAvulsos] = useState([])
  const [mfMsg, setMfMsg] = useState({}) // doc_id -> mensagem da montagem final

  const carregarLista = useCallback(async () => {
    const r = await apiAssinatura({ acao: 'listar' })
    if (r.ok) setAvulsos((r.documentos || []).filter(d => d.tipo === 'upload'))
  }, [])
  useEffect(() => { carregarLista() }, [carregarLista])

  function setSigner(i, campo, valor) {
    setSigners(s => s.map((x, j) => j === i ? { ...x, [campo]: valor } : x))
  }

  async function enviarEmail(link, to, nome, tituloDoc) {
    try {
      const r = await signSb.functions.invoke('enviar-email', { body: { to, nome: nome || '', titulo: tituloDoc, link } })
      return !(r.error || (r.data && r.data.ok === false))
    } catch { return false }
  }

  async function gerar() {
    const validos = signers.map(s => ({ nome: s.nome.trim(), email: s.email.trim() })).filter(s => s.email)
    if (!titulo.trim()) { setMsg({ texto: 'Informe o título.', ok: false }); return }
    if (!arquivo) { setMsg({ texto: 'Selecione o arquivo.', ok: false }); return }
    if (!validos.length) { setMsg({ texto: 'Adicione ao menos um signatário com e-mail.', ok: false }); return }

    setBusy(true); setLinks([])
    let pdfBlob
    try { setMsg({ texto: 'Preparando o documento…', ok: true }); pdfBlob = await toPdf(arquivo) }
    catch (e) { setMsg({ texto: e.message || 'Não foi possível preparar o arquivo.', ok: false }); setBusy(false); return }

    setMsg({ texto: 'Enviando arquivo…', ok: true })
    const docId = crypto.randomUUID()
    const path = docId + '/original.pdf'
    const up = await signSb.storage.from('documentos').upload(path, pdfBlob, { contentType: 'application/pdf', upsert: true })
    if (up.error) { setMsg({ texto: 'Erro ao enviar arquivo: ' + up.error.message, ok: false }); setBusy(false); return }

    const r = await apiAssinatura({ acao: 'criar', tipo: 'upload', doc_id: docId, titulo: titulo.trim(), arquivo_path: path, signatarios: validos })
    if (!r.ok) { setMsg({ texto: r.erro || 'Não foi possível criar.', ok: false }); setBusy(false); return }

    const itens = (r.signatarios || []).map(s => ({ ...s, link: window.location.origin + '/assinar-doc?d=' + docId + '&s=' + s.token }))
    setLinks(itens)
    setMsg({ texto: '✓ Documento criado. Enviando e-mails aos signatários…', ok: true })
    let enviados = 0
    for (const s of itens) { if (await enviarEmail(s.link, s.email, s.nome, titulo.trim())) enviados++ }
    setMsg(enviados === itens.length
      ? { texto: `✓ Documento criado e e-mail enviado a ${enviados} signatário(s). Use "Reenviar e-mail" se precisar.`, ok: true }
      : { texto: `Documento criado. ${enviados} de ${itens.length} e-mail(s) enviado(s) — reenvie os demais pelos botões abaixo.`, ok: false })
    setBusy(false)
    setTitulo(''); setArquivo(null); setSigners([{ nome: '', email: '' }])
    document.getElementById('arquivo').value = ''
    carregarLista()
  }

  // Monta o PDF final (original + página de assinaturas) e salva no Storage
  async function montarFinal(d) {
    setMfMsg(m => ({ ...m, [d.id]: 'Montando…' }))
    try {
      const det = await apiAssinatura({ acao: 'detalhe', doc_id: d.id })
      if (!det.ok) throw new Error(det.erro || 'falha ao carregar')
      const doc = det.documento, sigs = det.signatarios || []
      const orig = await apiAssinatura({ acao: 'signed', bucket: 'documentos', path: doc.arquivo_path })
      if (!orig.ok) throw new Error(orig.erro || 'arquivo original indisponível')
      const origBytes = await (await fetch(orig.url)).arrayBuffer()
      await libPdfLib()
      const { PDFDocument, StandardFonts, rgb } = window.PDFLib
      const pdf = await PDFDocument.load(origBytes)
      const font = await pdf.embedFont(StandardFonts.Helvetica)
      const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
      let page = pdf.addPage([595.28, 841.89])
      const M = 56; let y = 785
      const navy = rgb(0.12, 0.20, 0.31)
      page.drawText('PÁGINA DE ASSINATURAS', { x: M, y, size: 14, font: bold, color: navy }); y -= 10
      page.drawLine({ start: { x: M, y }, end: { x: 539, y }, thickness: 1.2, color: navy }); y -= 24
      page.drawText('Documento: ' + (doc.titulo || ''), { x: M, y, size: 11, font }); y -= 26
      for (const s of sigs) {
        if (y < 150) { page = pdf.addPage([595.28, 841.89]); y = 785 }
        if (s.assinatura_path) {
          try {
            const su = await apiAssinatura({ acao: 'signed', bucket: 'assinaturas', path: s.assinatura_path })
            if (su.ok) {
              const png = await pdf.embedPng(await (await fetch(su.url)).arrayBuffer())
              const w = 150, h = png.height * w / png.width
              page.drawImage(png, { x: M, y: y - h + 8, width: w, height: Math.min(h, 60) })
            }
          } catch { /* segue sem a imagem */ }
        }
        page.drawLine({ start: { x: M, y: y - 56 }, end: { x: M + 220, y: y - 56 }, thickness: .8, color: rgb(.3, .3, .3) })
        let yy = y - 70
        const linha = (t, b) => { page.drawText(t, { x: M, y: yy, size: 10, font: b ? bold : font, color: rgb(.1, .1, .1) }); yy -= 14 }
        linha(s.nome || s.email, true)
        if (s.cpf) linha('CPF: ' + s.cpf)
        linha('E-mail: ' + (s.email || ''))
        linha('Status: ' + (s.status === 'assinado' ? ('assinado em ' + (s.assinado_em ? new Date(s.assinado_em).toLocaleString('pt-BR') : '')) : s.status))
        linha('Identificador: ' + s.id)
        y = yy - 18
      }
      if (y < 90) { page = pdf.addPage([595.28, 841.89]); y = 785 }
      page.drawText('Assinado eletronicamente nos termos da Lei nº 14.063/2020 e da MP nº 2.200-2/2001.', { x: M, y: 60, size: 8, font, color: rgb(.35, .35, .35) })
      page.drawText('Crispim, Mendonça e Pinheiro — Advogados · 0800 591 7259 · contato@cmpadvogados.com.br', { x: M, y: 48, size: 8, font, color: rgb(.35, .35, .35) })
      const bytes = await pdf.save()
      await signSb.storage.from('documentos').upload(d.id + '/assinado.pdf', new Blob([bytes], { type: 'application/pdf' }), { upsert: true, contentType: 'application/pdf' })
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
      const a = document.createElement('a'); a.href = url; a.download = (doc.titulo || 'documento').replace(/[^\w\-]+/g, '_') + '_assinado.pdf'; a.click()
      setMfMsg(m => ({ ...m, [d.id]: '✓ PDF final montado e baixado.' }))
    } catch (e) { setMfMsg(m => ({ ...m, [d.id]: 'Erro: ' + (e.message || e) })) }
  }

  const btnMini = { border: 0, borderRadius: 6, padding: '7px 10px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: 22 }}>
      <div style={{ background: '#fff', border: '1px solid #d9dde3', borderRadius: 12, padding: 20, marginBottom: 18 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 16, color: NAVY }}>Enviar PDF para assinatura</h2>
        <p style={{ fontSize: 13, color: '#5b6673', margin: '0 0 12px' }}>Suba um PDF, Word (.docx) ou imagem e adicione quem precisa assinar (até 30). As assinaturas entram no documento, com trilha de auditoria.</p>
        <label style={estRotulo}>Título do documento *</label>
        <input value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="ex.: Contrato de honorários — Fulano" style={estCampo} />
        <label style={estRotulo}>Arquivo (PDF, Word .docx ou imagem JPG/PNG) *</label>
        <input id="arquivo" type="file" accept="application/pdf,.docx,image/*" onChange={e => setArquivo(e.target.files[0] || null)} style={{ ...estCampo, padding: 8 }} />
        <label style={estRotulo}>Signatários *</label>
        {signers.map((s, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input value={s.nome} onChange={e => setSigner(i, 'nome', e.target.value)} placeholder="Nome" style={{ ...estCampo, flex: 1 }} />
            <input value={s.email} onChange={e => setSigner(i, 'email', e.target.value)} placeholder="e-mail" type="email" style={{ ...estCampo, flex: 1 }} />
            <button onClick={() => setSigners(x => x.filter((_, j) => j !== i))} style={{ border: 0, background: '#fdecea', color: '#b3261e', borderRadius: 8, padding: '0 12px', cursor: 'pointer', fontWeight: 700 }}>×</button>
          </div>
        ))}
        <button onClick={() => signers.length < 30 && setSigners(s => [...s, { nome: '', email: '' }])}
          style={{ marginTop: 12, padding: '10px 16px', background: '#eef1f5', color: '#1c2733', border: 0, borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}>+ Adicionar signatário</button>
        <div>
          <button onClick={gerar} disabled={busy} style={{ marginTop: 12, padding: '11px 18px', background: busy ? '#a9b3c1' : NAVY, color: '#fff', border: 0, borderRadius: 8, fontWeight: 600, cursor: busy ? 'default' : 'pointer' }}>
            {busy ? 'Enviando…' : 'Enviar e gerar links'}
          </button>
        </div>
        {msg && <div style={{ fontSize: 13, marginTop: 10, padding: '10px 12px', borderRadius: 8, background: msg.ok ? '#eaf6ef' : '#fdecea', color: msg.ok ? '#1f7a44' : '#b3261e', border: '1px solid ' + (msg.ok ? '#a9d7bd' : '#f2b8b3') }}>{msg.texto}</div>}
        <div style={{ marginTop: 14 }}>
          {links.map(s => (
            <div key={s.id} style={{ background: '#f4f5f7', border: '1px solid #d9dde3', borderRadius: 8, padding: '10px 12px', marginTop: 10, fontSize: 13 }}>
              <b>{s.nome || s.email}</b> <span style={{ color: '#5b6673', fontSize: 12 }}>{s.email}</span>
              <div style={{ wordBreak: 'break-all', color: '#274b7d', fontSize: 12, margin: '4px 0' }}>{s.link}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button style={{ ...btnMini, background: '#e6e9ee', color: '#1c2733' }} onClick={e => { navigator.clipboard.writeText(s.link); e.currentTarget.textContent = 'Copiado!' }}>Copiar</button>
                <button style={{ ...btnMini, background: '#25d366', color: '#063d1e' }} onClick={() => window.open('https://wa.me/?text=' + encodeURIComponent('Olá! Segue o link para assinar o documento: ' + s.link), '_blank')}>WhatsApp</button>
                <button style={{ ...btnMini, background: NAVY, color: '#fff' }} onClick={async e => {
                  const b = e.currentTarget; b.disabled = true; b.textContent = 'Enviando…'
                  const ok = await enviarEmail(s.link, s.email, s.nome, titulo || 'documento')
                  b.disabled = false; b.textContent = ok ? 'Reenviado ✓' : 'Falhou — tentar de novo'
                }}>Reenviar e-mail</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ background: '#fff', border: '1px solid #d9dde3', borderRadius: 12, padding: 20 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 16, color: NAVY }}>Meus documentos avulsos</h2>
        <p style={{ fontSize: 13, color: '#5b6673', margin: '0 0 12px' }}>Monte o PDF final (original + página de assinaturas) quando todos assinarem.</p>
        <button onClick={carregarLista} style={{ padding: '10px 16px', background: '#eef1f5', color: '#1c2733', border: 0, borderRadius: 8, fontWeight: 600, cursor: 'pointer' }}>Atualizar lista</button>
        <div style={{ marginTop: 12 }}>
          {!avulsos.length && <div style={{ color: '#5b6673', fontSize: 12 }}>Nenhum documento avulso ainda.</div>}
          {avulsos.map(d => (
            <div key={d.id} style={{ background: '#f4f5f7', border: '1px solid #d9dde3', borderRadius: 8, padding: '10px 12px', marginTop: 10, fontSize: 13 }}>
              <b>{d.titulo || '—'}</b> <span style={{ color: '#5b6673', fontSize: 12 }}>
                {d.status === 'assinado' ? '✅ assinado' : d.status === 'parcial' ? '⏳ parcial' : '• enviado'} · {new Date(d.criado_em).toLocaleDateString('pt-BR')}
              </span>
              <div style={{ marginTop: 6 }}>
                <button style={{ ...btnMini, background: '#e6e9ee', color: '#1c2733' }} onClick={() => montarFinal(d)}>Montar PDF final</button>
              </div>
              {mfMsg[d.id] && <div style={{ color: '#5b6673', fontSize: 12, marginTop: 4 }}>{mfMsg[d.id]}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
