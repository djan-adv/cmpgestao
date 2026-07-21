'use client'
// Tela PÚBLICA de assinatura de DOCUMENTO AVULSO (equivalente ao assinar-doc.html
// do site antigo). O signatário chega pelo link (?d=documento&s=token), vê o PDF,
// assina digitando ou desenhando. Fala direto com o banco do assinador — sem login.
import { useEffect, useRef, useState } from 'react'
import { signSb } from '../../lib/supabaseAssinatura'

const CSS = `
  .asd-root{--azul:#2E3A4B;--azul2:#274b7d;--dourado:#b8912f;--cinza:#f4f5f7;--borda:#d9dde3;--texto:#1c2733;--suave:#5b6673;--ok:#1f7a44;--erro:#b3261e;
    font-family:'Segoe UI',system-ui,Arial,sans-serif;background:var(--cinza);color:var(--texto);line-height:1.5;min-height:100vh}
  .asd-root *{box-sizing:border-box}
  .asd-topo{background:var(--azul);color:#fff;padding:14px 22px;display:flex;align-items:center;gap:12px}
  .asd-marca{font-weight:700;font-size:17px}
  .asd-selo{margin-left:auto;font-size:11px;background:rgba(255,255,255,.12);padding:6px 10px;border-radius:20px}
  .asd-wrap{max-width:1120px;margin:0 auto;padding:22px;display:grid;grid-template-columns:1.15fr .85fr;gap:20px}
  @media(max-width:900px){.asd-wrap{grid-template-columns:1fr}}
  .asd-card{background:#fff;border:1px solid var(--borda);border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.04)}
  .asd-root h2{margin:0 0 6px;font-size:16px;color:var(--azul)}
  .asd-passo{font-size:12px;color:var(--dourado);font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:10px}
  .asd-root label{display:block;font-size:12.5px;font-weight:600;color:var(--suave);margin:12px 0 4px}
  .asd-root input{width:100%;padding:10px 12px;border:1px solid var(--borda);border-radius:8px;font-size:14px;font-family:inherit}
  .asd-root button.btn{border:none;border-radius:8px;padding:11px 18px;font-size:14px;font-weight:600;cursor:pointer;background:var(--azul);color:#fff;margin-top:14px}
  .asd-root button.btn:disabled{background:#a9b3c1;cursor:not-allowed}
  .asd-root button.ghost{background:#eef1f5;color:var(--texto)}
  .asd-msg{font-size:13px;margin-top:10px;padding:10px 12px;border-radius:8px}
  .asd-msg.err{background:#fdecea;color:var(--erro);border:1px solid #f2b8b3}
  .asd-msg.ok{background:#eaf6ef;color:var(--ok);border:1px solid #a9d7bd}
  .asd-hint{font-size:12px;color:var(--suave);margin-top:4px}
  .asd-gate{max-width:440px;margin:48px auto}
  .asd-pdf{width:100%;height:560px;border:1px solid var(--borda);border-radius:8px;background:#fff}
  .asd-sigtabs{display:flex;gap:8px;margin-bottom:12px}
  .asd-sigtab{flex:1;border:1.5px solid var(--borda);background:#fff;border-radius:8px;padding:9px;font-size:13px;font-weight:600;color:var(--suave);cursor:pointer}
  .asd-sigtab.active{border-color:var(--azul);background:#eef3fa;color:var(--azul)}
  .asd-fontopts{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:4px}
  .asd-fontopt{border:1.5px solid var(--borda);background:#fff;border-radius:8px;padding:6px 4px;font-size:22px;color:#12233a;cursor:pointer;overflow:hidden;white-space:nowrap}
  .asd-fontopt.active{border-color:var(--azul);background:#eef3fa}
  .asd-sigpreview{margin-top:12px;min-height:90px;display:flex;align-items:center;justify-content:center;border:1px solid var(--borda);border-radius:10px;background:#fbfbfd;font-size:44px;color:#12233a;padding:8px;text-align:center}
  .asd-sigwrap{border:2px dashed var(--borda);border-radius:10px;background:#fbfbfd;position:relative}
  .asd-sig{width:100%;height:160px;touch-action:none;display:block;border-radius:10px;cursor:crosshair}
  .asd-sigph{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:#b7bfca;font-size:13px;pointer-events:none}
  .asd-prog{font-size:12.5px;color:var(--suave);margin-top:6px}
`

const FONTES = ["'Dancing Script', cursive", "'Great Vibes', cursive", "'Sacramento', cursive"]
function tituloNome(s) { const min = new Set(['da', 'de', 'do', 'das', 'dos', 'e']); return (s || '').toLowerCase().trim().split(/\s+/).map((w, i) => (i > 0 && min.has(w)) ? w : (w.charAt(0).toUpperCase() + w.slice(1))).join(' ') }
const mCPF = v => v.replace(/\D/g, '').slice(0, 11).replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2')

export default function AssinarDocumento() {
  const [token, setToken] = useState(null)
  const [info, setInfo] = useState(null)
  const [gateMsg, setGateMsg] = useState('')
  const [pdfUrl, setPdfUrl] = useState('')
  const [nome, setNome] = useState('')
  const [cpf, setCpf] = useState('')
  const [declara, setDeclara] = useState(false)
  const [sigMode, setSigMode] = useState('typed')
  const [sigFont, setSigFont] = useState(FONTES[0])
  const [temAssinatura, setTemAssinatura] = useState(false)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [jaAssinou, setJaAssinou] = useState(false)
  const canvasRef = useRef(null)
  const desenhando = useRef(false)

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const tok = q.get('s')
    setToken(tok)
    if (!tok) { setGateMsg('Link inválido.'); return }
    signSb.rpc('avulso_por_token', { tok }).then(async ({ data, error }) => {
      if (error) { setGateMsg(error.message); return }
      if (!data || !data.length) { setGateMsg('Link inválido ou expirado.'); return }
      const i = data[0]
      setInfo(i)
      if (i.sig_nome) setNome(i.sig_nome)
      if (i.sig_cpf) setCpf(i.sig_cpf)
      if (i.sig_status === 'assinado') { setJaAssinou(true); setMsg({ texto: 'Você já assinou este documento. Obrigado!', ok: true }) }
      try {
        const r = await signSb.functions.invoke('ver-documento', { body: { token: tok } })
        if (r.data && r.data.url) setPdfUrl(r.data.url)
      } catch { /* o PDF pode não abrir, mas a assinatura segue */ }
    })
  }, [])

  function fitCanvas() {
    const canvas = canvasRef.current; if (!canvas) return
    const r = canvas.getBoundingClientRect()
    canvas.width = r.width * 2; canvas.height = r.height * 2
    const ctx = canvas.getContext('2d')
    ctx.scale(2, 2); ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.strokeStyle = '#12233a'
  }
  const posDe = e => { const r = canvasRef.current.getBoundingClientRect(); const t = e.touches ? e.touches[0] : e; return { x: t.clientX - r.left, y: t.clientY - r.top } }
  const startDraw = e => { e.preventDefault(); desenhando.current = true; const p = posDe(e); const ctx = canvasRef.current.getContext('2d'); ctx.beginPath(); ctx.moveTo(p.x, p.y) }
  const moveDraw = e => { if (!desenhando.current) return; e.preventDefault(); const p = posDe(e); const ctx = canvasRef.current.getContext('2d'); ctx.lineTo(p.x, p.y); ctx.stroke(); setTemAssinatura(true) }
  const endDraw = () => { desenhando.current = false }
  function limparSig() { const c = canvasRef.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); setTemAssinatura(false) }
  function mudarModo(m) { setSigMode(m); if (m === 'draw') { setTimeout(fitCanvas, 30); setTemAssinatura(false) } }

  async function renderTypedToCanvas(text) {
    const primary = sigFont.split(',')[0].replace(/'/g, '').trim()
    try { await document.fonts.load(`64px '${primary}'`); await document.fonts.ready } catch { /* segue com a fonte padrão */ }
    const canvas = canvasRef.current
    canvas.width = 620; canvas.height = 200
    const c = canvas.getContext('2d')
    c.clearRect(0, 0, 620, 200); c.fillStyle = '#12233a'; c.textAlign = 'center'; c.textBaseline = 'middle'
    let size = 76; c.font = `${size}px ${sigFont}`
    while (c.measureText(text).width > 580 && size > 22) { size -= 4; c.font = `${size}px ${sigFont}` }
    c.fillText(text, 310, 100)
  }

  const sigOk = sigMode === 'typed' ? !!nome.trim() : temAssinatura
  const podeAssinar = !!(nome.trim() && declara && sigOk) && !jaAssinou

  async function assinar() {
    setBusy(true)
    setMsg({ texto: 'Registrando assinatura…', ok: true })
    const nomeF = tituloNome(nome)
    if (sigMode === 'typed') await renderTypedToCanvas(nomeF)
    const canvas = canvasRef.current
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'))
    const path = `${info.sig_id}.png`
    const up = await signSb.storage.from('assinaturas').upload(path, blob, { upsert: true, contentType: 'image/png' })
    if (up.error) { setMsg({ texto: 'Erro ao salvar assinatura: ' + up.error.message, ok: false }); setBusy(false); return }
    const metodo = sigMode === 'typed' ? 'assinatura digitada em caligrafia' : 'assinatura desenhada à mão'
    const { error } = await signSb.rpc('assinar_avulso', { tok: token, p_nome: nomeF, p_cpf: cpf.trim() || null, p_path: path, p_ua: navigator.userAgent, p_metodo: metodo })
    if (error) { setMsg({ texto: error.message, ok: false }); setBusy(false); return }
    setJaAssinou(true)
    setMsg({ texto: '✓ Documento assinado com sucesso! Obrigado.', ok: true })
    // Se todos assinaram, o servidor monta o PDF final e envia por e-mail a todos + escritório
    try { await signSb.functions.invoke('finalizar-documento', { body: { doc_id: info.doc_id } }) } catch { /* best-effort */ }
    setBusy(false)
  }

  return (
    <div className="asd-root">
      {/* dangerouslySetInnerHTML evita mismatch de hidratação (o SSR escapa as aspas do CSS) */}
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link href="https://fonts.googleapis.com/css2?family=Dancing+Script:wght@700&family=Great+Vibes&family=Sacramento&display=swap" rel="stylesheet" />
      <header className="asd-topo">
        <div className="asd-marca">CMP Advogados · Assinatura eletrônica</div>
        <div className="asd-selo">🔒 Assinatura com trilha de auditoria</div>
      </header>

      {!info && (
        <div className="asd-gate">
          <div className="asd-card">
            <div className="asd-passo">Assinatura eletrônica</div>
            <h2>{gateMsg ? 'Não foi possível abrir' : 'Carregando documento…'}</h2>
            {!gateMsg && <p className="asd-hint">Aguarde um instante.</p>}
            {gateMsg && <div className="asd-msg err">{gateMsg}</div>}
          </div>
        </div>
      )}

      {info && (
        <div className="asd-wrap">
          <div className="asd-card">
            <div className="asd-passo">Documento</div>
            <h2>{info.titulo || 'Documento'}</h2>
            <div className="asd-prog">Assinaturas: {info.assinados} de {info.total}</div>
            {pdfUrl
              ? <iframe className="asd-pdf" src={pdfUrl} title="Documento" />
              : <div className="asd-hint" style={{ padding: 20 }}>Carregando a visualização do documento…</div>}
          </div>
          <div className="asd-card">
            <div className="asd-passo">Sua assinatura</div>
            <h2>Assine abaixo</h2>
            <label>Nome completo</label>
            <input value={nome} onChange={e => setNome(e.target.value)} />
            <label>CPF (opcional)</label>
            <input value={cpf} placeholder="000.000.000-00" inputMode="numeric" onChange={e => setCpf(mCPF(e.target.value))} />
            <div className="asd-sigtabs">
              <button type="button" className={'asd-sigtab' + (sigMode === 'typed' ? ' active' : '')} onClick={() => mudarModo('typed')}>Digitar</button>
              <button type="button" className={'asd-sigtab' + (sigMode === 'draw' ? ' active' : '')} onClick={() => mudarModo('draw')}>Desenhar</button>
            </div>
            <div style={{ display: sigMode === 'typed' ? 'block' : 'none' }}>
              <div className="asd-fontopts">
                {FONTES.map(ft => (
                  <button key={ft} type="button" className={'asd-fontopt' + (sigFont === ft ? ' active' : '')} style={{ fontFamily: ft }} onClick={() => setSigFont(ft)}>Assinatura</button>
                ))}
              </div>
              <div className="asd-sigpreview" style={{ fontFamily: sigFont }}>{nome || 'Assinatura'}</div>
            </div>
            <div style={{ display: sigMode === 'draw' ? 'block' : 'none' }}>
              <div className="asd-sigwrap">
                <canvas ref={canvasRef} className="asd-sig"
                  onMouseDown={startDraw} onMouseMove={moveDraw} onMouseUp={endDraw} onMouseLeave={endDraw}
                  onTouchStart={startDraw} onTouchMove={moveDraw} onTouchEnd={endDraw} />
                {!temAssinatura && <div className="asd-sigph">✍️ Assine com o dedo ou o mouse</div>}
              </div>
              <button className="btn ghost" onClick={limparSig}>Limpar</button>
            </div>
            <label style={{ marginTop: 12 }}>
              <input type="checkbox" checked={declara} onChange={e => setDeclara(e.target.checked)} style={{ width: 'auto', marginRight: 8 }} />
              Declaro, sob as penas da lei, que li o documento e que sou a pessoa identificada.
            </label>
            <button className="btn" disabled={!podeAssinar || busy} onClick={assinar}>{busy ? 'Assinando…' : 'Assinar documento'}</button>
            {msg && <div className={'asd-msg ' + (msg.ok ? 'ok' : 'err')}>{msg.texto}</div>}
          </div>
        </div>
      )}
    </div>
  )
}
