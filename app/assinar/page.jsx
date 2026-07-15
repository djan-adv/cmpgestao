'use client'
// Tela PÚBLICA de assinatura de PROCURAÇÃO (equivalente ao assinar.html do site
// antigo). O cliente chega pelo link do e-mail (?d=documento&s=token), completa
// os dados, assina (digitando ou desenhando) e recebe a cópia por e-mail.
// Fala direto com o banco do assinador por token — não exige login.
import { useEffect, useRef, useState, useCallback } from 'react'
import { signSb } from '../../lib/supabaseAssinatura'

const CSS = `
  .asn-root{--azul:#2E3A4B;--azul2:#274b7d;--dourado:#b8912f;--cinza:#f4f5f7;--borda:#d9dde3;--texto:#1c2733;--suave:#5b6673;--ok:#1f7a44;--erro:#b3261e;
    font-family:'Segoe UI',system-ui,Arial,sans-serif;background:var(--cinza);color:var(--texto);line-height:1.5;min-height:100vh}
  .asn-root *{box-sizing:border-box}
  .asn-topo{background:var(--azul);color:#fff;padding:16px 22px;display:flex;align-items:center;gap:12px}
  .asn-marca{font-weight:700;font-size:17px}
  .asn-selo{margin-left:auto;font-size:11px;background:rgba(255,255,255,.12);padding:6px 10px;border-radius:20px}
  .asn-wrap{max-width:1120px;margin:0 auto;padding:24px;display:grid;grid-template-columns:1fr 1fr;gap:22px}
  @media(max-width:900px){.asn-wrap{grid-template-columns:1fr}}
  .asn-card{background:#fff;border:1px solid var(--borda);border-radius:12px;padding:22px;box-shadow:0 1px 3px rgba(0,0,0,.04)}
  .asn-root h2{margin:0 0 6px;font-size:16px;color:var(--azul)}
  .asn-passo{font-size:12px;color:var(--dourado);font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:12px}
  .asn-root label{display:block;font-size:12.5px;font-weight:600;color:var(--suave);margin:12px 0 4px}
  .asn-root input,.asn-root select{width:100%;padding:10px 12px;border:1px solid var(--borda);border-radius:8px;font-size:14px;font-family:inherit}
  .asn-root input:focus,.asn-root select:focus{outline:none;border-color:var(--azul2);box-shadow:0 0 0 3px rgba(39,75,125,.12)}
  .asn-grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
  .asn-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  @media(max-width:520px){.asn-grid2,.asn-grid3{grid-template-columns:1fr}}
  .asn-root button.btn{border:none;border-radius:8px;padding:11px 18px;font-size:14px;font-weight:600;cursor:pointer;background:var(--azul);color:#fff;margin-top:14px}
  .asn-root button.btn:hover{background:var(--azul2)}
  .asn-root button.btn:disabled{background:#a9b3c1;cursor:not-allowed}
  .asn-root button.ghost{background:#eef1f5;color:var(--texto)}
  .asn-msg{font-size:13px;margin-top:10px;padding:10px 12px;border-radius:8px}
  .asn-msg.err{background:#fdecea;color:var(--erro);border:1px solid #f2b8b3}
  .asn-msg.ok{background:#eaf6ef;color:var(--ok);border:1px solid #a9d7bd}
  .asn-errocpf{color:var(--erro);font-size:12px;margin-top:4px}
  .asn-hint{font-size:12px;color:var(--suave);margin-top:4px}
  .asn-gate{max-width:440px;margin:50px auto;display:block}
  .asn-doc{position:relative;overflow:hidden}
  .asn-doc-inner{position:relative;z-index:1;padding:30px 34px;font-family:'Barlow',Arial,sans-serif;font-size:12pt;line-height:1.5;color:#1c1c1c;text-align:justify;border:1.6px solid #33475f}
  .asn-watermark{position:absolute;inset:0;background:url('/logo_cmp_full.png') center 46% no-repeat;background-size:360px;opacity:.06;z-index:0;pointer-events:none}
  .asn-doc-inner .timbre{text-align:left;padding-bottom:8px;margin-bottom:14px}
  .asn-doc-inner .timbre img{max-height:52px;width:auto}
  .asn-doc-inner h1{font-size:13pt;text-align:center;letter-spacing:.5px;margin:6px 0 16px;text-transform:uppercase;font-weight:700}
  .asn-doc-inner p{margin:0 0 12pt}
  .asn-doc-inner .rodape-doc{margin-top:2px;text-align:center;font-size:11pt}
  .asn-doc-inner .rodape-doc .nome-out{font-weight:700}
  .asn-doc-inner .rodape-doc .contato-cmp{font-size:10.5pt;color:#333}
  .asn-doc-inner .rodape-doc .cpf-out{font-weight:700;margin-top:2px}
  .asn-doc-inner .campo{background:#fff6d8;padding:0 3px;border-radius:2px}
  .asn-doc-inner .vazio{color:#b98a00;font-style:italic}
  .asn-doc-inner .assin-bloco{margin-top:34px;text-align:center}
  .asn-doc-inner .assin-linha{border-top:1px solid #333;width:280px;margin:0 auto;padding-top:6px;font-size:12px}
  .asn-doc-inner .assin-img{max-height:74px;margin:0 auto 2px;display:block}
  .asn-doc-inner .auditoria{margin-top:22px;border-top:1px dashed #bbb;padding-top:10px;font-size:9.5px;color:#555}
  .asn-sigtabs{display:flex;gap:8px;margin-bottom:12px}
  .asn-sigtab{flex:1;border:1.5px solid var(--borda);background:#fff;border-radius:8px;padding:9px;font-size:13px;font-weight:600;color:var(--suave);cursor:pointer}
  .asn-sigtab.active{border-color:var(--azul);background:#eef3fa;color:var(--azul)}
  .asn-fontopts{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-top:4px}
  @media(max-width:520px){.asn-fontopts{grid-template-columns:1fr}}
  .asn-fontopt{border:1.5px solid var(--borda);background:#fff;border-radius:8px;padding:6px 4px;font-size:22px;color:#12233a;cursor:pointer;line-height:1.2;overflow:hidden;white-space:nowrap}
  .asn-fontopt.active{border-color:var(--azul);background:#eef3fa}
  .asn-sigpreview{margin-top:12px;min-height:96px;display:flex;align-items:center;justify-content:center;border:1px solid var(--borda);border-radius:10px;background:#fbfbfd;font-size:46px;color:#12233a;padding:8px;word-break:break-word;text-align:center;line-height:1.1}
  .asn-sigwrap{border:2px dashed var(--borda);border-radius:10px;background:#fbfbfd;position:relative}
  .asn-sig{width:100%;height:170px;touch-action:none;display:block;border-radius:10px;cursor:crosshair}
  .asn-sigph{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:#b7bfca;font-size:13px;pointer-events:none}
  @media print{
    .asn-topo,.asn-painel-form,.no-print{display:none!important}
    .asn-wrap{display:block;padding:0;max-width:none}
    .asn-card{border:none;box-shadow:none;padding:0}
    .asn-doc{overflow:visible}
    .asn-doc-inner{padding:1.2cm 1.3cm;font-size:12pt;border:1.6px solid #33475f;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .asn-watermark{-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .asn-doc-inner .auditoria{page-break-before:always;margin-top:0;border-top:none}
    @page{margin:1.2cm 1.1cm}
  }
`

const OUTORGADO = '<b>Djan Henrique Mendonça do Nascimento</b>, brasileiro, casado, advogado, inscrito na OAB/PB n. 5.219-A, e os integrantes da sociedade <b>CRISPIM, MENDONÇA E PINHEIRO ADVOGADOS</b>, registrada na Ordem dos Advogados do Brasil, seccional da Paraíba sob o número OAB/PB 2200042, e no CNPJ 45.487.942/0001-84, com sede na Rua Abelardo da Silva Guimarães Barreto, 51, sala 604-C edf. Alliance Plaza Business, CEP 58046-110, Altiplano Cabo Branco, João Pessoa/PB, e-mail: djan.adv@gmail.com'

function tituloNome(s) { const min = new Set(['da', 'de', 'do', 'das', 'dos', 'e', 'di', 'du', 'del', 'van', 'von', 'y']); return (s || '').toLowerCase().trim().split(/\s+/).map((w, i) => (i > 0 && min.has(w)) ? w : (w.charAt(0).toUpperCase() + w.slice(1))).join(' ') }
function cpfValido(cpf) { cpf = (cpf || '').replace(/\D/g, ''); if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false; let s = 0; for (let i = 0; i < 9; i++) s += +cpf[i] * (10 - i); let d1 = (s * 10) % 11; if (d1 === 10) d1 = 0; if (d1 !== +cpf[9]) return false; s = 0; for (let i = 0; i < 10; i++) s += +cpf[i] * (11 - i); let d2 = (s * 10) % 11; if (d2 === 10) d2 = 0; return d2 === +cpf[10] }
const mCPF = v => v.replace(/\D/g, '').slice(0, 11).replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2')
const mCEP = v => v.replace(/\D/g, '').slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2')
const escH = s => (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const ph = (t, v) => v ? `<span class="campo">${escH(v)}</span>` : `<span class="vazio">[${t}]</span>`

function clausulas(modelo) {
  const MAP = { trabalhista: { e: 30, g: true }, previdenciario: { e: 30, g: true }, civel20: { e: 20, g: false }, civel20g: { e: 20, g: true }, civel30: { e: 30, g: false }, civel30g: { e: 30, g: true }, defesa: { e: null, g: false }, defesag: { e: null, g: true }, defesa10: { e: 10, g: false }, defesa10g: { e: 10, g: true } }
  const cfg = MAP[modelo] || { e: null, g: false }
  const EXT = { 10: 'dez por cento', 20: 'vinte por cento', 25: 'vinte e cinco por cento', 30: 'trinta por cento' }
  let o = ''
  if (cfg.e !== null) o += `<p><b>Cláusula Contratual</b> – pelos serviços prestados o outorgado receberá a título de honorários o percentual de <b>${cfg.e}% (${EXT[cfg.e] || ''})</b> do valor obtido com a ação, podendo requerer ao juízo da causa que lhe pague diretamente os valores destacados do montante principal.</p>`
  if (cfg.g) o += `<p><b>Da Gratuidade da Justiça</b> – o(a) outorgante declara não dispor de condições de arcar com custas e despesas processuais sem prejuízo do próprio sustento, requerendo os benefícios da gratuidade da justiça, na forma do art. 98 do CPC.</p>`
  return o
}

const FONTES = ["'Dancing Script', cursive", "'Great Vibes', cursive", "'Sacramento', cursive"]

function carregarScript(src, pronto) {
  return new Promise((res, rej) => {
    if (pronto()) return res()
    const s = document.createElement('script')
    s.src = src; s.onload = () => res(); s.onerror = () => rej(new Error('falha ao carregar biblioteca'))
    document.head.appendChild(s)
  })
}

export default function AssinarProcuracao() {
  const [params, setParams] = useState(null) // {d, s}
  const [doc, setDoc] = useState(null)
  const [gateMsg, setGateMsg] = useState('')
  const [f, setF] = useState({ nome: '', nacionalidade: 'brasileiro(a)', estadocivil: '', profissao: '', cpf: '', rg: '', cep: '', numero: '', endereco: '', email: '', telefone: '' })
  const [cepMsg, setCepMsg] = useState('')
  const [declara, setDeclara] = useState(false)
  const [sigMode, setSigMode] = useState('typed')
  const [sigFont, setSigFont] = useState(FONTES[0])
  const [sigNomeTyped, setSigNomeTyped] = useState('')
  const [temAssinatura, setTemAssinatura] = useState(false)
  const [msg, setMsg] = useState(null)
  const [assinado, setAssinado] = useState(null) // {img, nome, cpf, ip, id, metodo, fatores}
  const [busy, setBusy] = useState(false)
  const canvasRef = useRef(null)
  const desenhando = useRef(false)

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const p = { d: q.get('d'), s: q.get('s') }
    setParams(p)
    if (!p.s) { setGateMsg('Link inválido.'); return }
    signSb.rpc('doc_por_token', { tok: p.s }).then(({ data, error }) => {
      if (error) { setGateMsg(error.message); return }
      if (!data || !data.length) { setGateMsg('Link inválido ou expirado.'); return }
      setDoc(data[0])
      signSb.rpc('marcar_visto', { tok: p.s })
    })
  }, [])

  const set = (campo, valor) => setF(x => ({ ...x, [campo]: valor }))

  async function buscarCep() {
    const cep = f.cep.replace(/\D/g, '')
    if (cep.length !== 8) return
    setCepMsg('Buscando endereço…')
    try {
      const r = await fetch('https://viacep.com.br/ws/' + cep + '/json/')
      const d = await r.json()
      if (d.erro) { setCepMsg('CEP não encontrado.'); return }
      const partes = [d.logradouro, d.bairro, (d.localidade && d.uf) ? (d.localidade + '/' + d.uf) : ''].filter(Boolean)
      setF(x => {
        if (!x.endereco.trim()) return { ...x, endereco: tituloNome(partes.join(', ')) }
        if (d.localidade && !x.endereco.toLowerCase().includes(d.localidade.toLowerCase()))
          return { ...x, endereco: x.endereco.replace(/,\s*$/, '') + ', ' + (d.bairro ? tituloNome(d.bairro) + ', ' : '') + d.localidade + '/' + d.uf }
        return x
      })
      setCepMsg((d.localidade || '') + (d.uf ? '/' + d.uf : ''))
    } catch { setCepMsg('Não foi possível consultar o CEP agora.') }
  }

  // canvas de desenho
  function fitCanvas() {
    const canvas = canvasRef.current; if (!canvas) return
    const r = canvas.getBoundingClientRect()
    canvas.width = r.width * 2; canvas.height = r.height * 2
    const ctx = canvas.getContext('2d')
    ctx.scale(2, 2); ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.strokeStyle = '#12233a'
  }
  const posDe = e => {
    const r = canvasRef.current.getBoundingClientRect()
    const t = e.touches ? e.touches[0] : e
    return { x: t.clientX - r.left, y: t.clientY - r.top }
  }
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

  const dt = cpfValido(f.cpf)
  const emailOk = /.+@.+\..+/.test(f.email)
  const sigOk = sigMode === 'typed' ? !!(sigNomeTyped.trim() || f.nome.trim()) : temAssinatura
  const podeAssinar = !!(f.nome.trim() && dt && emailOk && declara && sigOk) && !assinado

  const enderecoCompleto = f.endereco.trim() ? (f.endereco.trim() + (f.numero.trim() ? ', nº ' + f.numero.trim() : '')) : ''
  const qualif = [ph('nacionalidade', f.nacionalidade.trim()), ph('estado civil', f.estadocivil), ph('profissão', f.profissao.trim())].join(', ')
  const ehDefesa = doc && (doc.modelo === 'defesa' || doc.modelo === 'defesag')
  const podExtra = ehDefesa ? '' : ', receber e dar quitação, <b>levantar e receber alvarás judiciais</b>, e <b>requerer ao juízo o pagamento direto ao(à) outorgado(a), mediante destaque ou retenção sobre os valores devidos ao(à) outorgante, dos honorários advocatícios que lhe forem devidos</b>'

  const blocoAssinatura = assinado
    ? `<img class="assin-img" src="${assinado.img}">
       <div class="assin-linha"><span class="nome-out">${escH(assinado.nome)}</span></div>
       <div class="rodape-doc">
         <div class="cpf-out">${escH(assinado.cpf)}</div>
         ${assinado.ip ? `<div style="font-size:9.5pt;color:#555">IP: ${escH(assinado.ip)} · ${assinado.quando}</div>` : ''}
         <div class="contato-cmp">0800 591 7259 &nbsp;|&nbsp; contato@cmpadvogados.com.br</div>
       </div>
       <div class="auditoria"><b>TRILHA DE AUDITORIA</b><br>Assinado eletronicamente por <b>${escH(assinado.nome)}</b> (CPF ${escH(assinado.cpf)}).<br><b>Fatores de autenticação:</b> ${assinado.fatores}.<br><b>Método:</b> ${assinado.metodo}.<br>Data/hora: <b>${assinado.quando}</b> · Identificador: <b>${assinado.id}</b><br>Fundamento: Lei nº 14.063/2020 e MP nº 2.200-2/2001.</div>`
    : `<div class="assin-linha">${escH(f.nome.trim()) || '[assinatura do outorgante]'}</div>
       <div class="rodape-doc">
         <div class="contato-cmp">0800 591 7259 &nbsp;|&nbsp; contato@cmpadvogados.com.br</div>
         <div class="cpf-out">${escH(f.cpf) || '—'}</div>
       </div>`

  const docHTML = `
    <div class="timbre"><img src="/logo_cmp_full.png" alt="Crispim, Mendonça e Pinheiro — Advogados" onerror="this.style.display='none'"></div>
    <h1>Procuração</h1>
    <p><b>Outorgante:</b> ${f.nome.trim() ? ('<b>' + escH(f.nome.trim()) + '</b>') : ph('nome', '')}, ${qualif}, inscrito(a) no CPF de nº ${ph('CPF', f.cpf)}${f.rg.trim() ? ' e RG ' + escH(f.rg.trim()) : ''}, residente e domiciliado(a) na ${ph('endereço', enderecoCompleto)}, com e-mail: ${escH(f.email.trim())}${f.telefone.trim() ? (' e contato: ' + escH(f.telefone.trim())) : ''}.</p>
    <p><b>Outorgado:</b> ${OUTORGADO}.</p>
    <p><b>Poderes:</b> o(a) outorgante nomeia e constitui seu bastante procurador o(a) outorgado(a), conferindo-lhe a cláusula <b>ad judicia et extra</b>, para o foro em geral, podendo propor, acompanhar e contestar ações em qualquer juízo, instância ou tribunal, bem como representá-lo(a) perante repartições públicas e privadas, com poderes especiais para <b>transigir, negociar</b>, firmar acordos, desistir, renunciar, substabelecer com ou sem reserva${podExtra}.</p>
    ${clausulas(doc && doc.modelo)}
    <p>Outorgada de forma livre e consciente, por assinatura eletrônica, nos termos da Lei nº 14.063/2020 e da MP nº 2.200-2/2001.</p>
    <p style="text-align:center;margin-top:16pt">João Pessoa/PB, ${new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}.</p>
    <div class="assin-bloco">${blocoAssinatura}</div>`

  async function assinar() {
    setBusy(true)
    setMsg({ texto: 'Registrando assinatura…', ok: true })
    const nome = tituloNome(f.nome), cpf = f.cpf, telefone = f.telefone.trim(), email = f.email.trim()
    if (sigMode === 'typed') await renderTypedToCanvas(tituloNome(sigNomeTyped) || nome)
    const canvas = canvasRef.current
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'))
    const path = `${doc.sig_id}.png`
    const up = await signSb.storage.from('assinaturas').upload(path, blob, { upsert: true, contentType: 'image/png' })
    if (up.error) { setMsg({ texto: 'Erro ao salvar assinatura: ' + up.error.message, ok: false }); setBusy(false); return }
    const metodo = sigMode === 'typed' ? 'assinatura digitada em caligrafia' : 'assinatura desenhada à mão'
    const { data, error } = await signSb.rpc('assinar_procuracao', { tok: params.s, p_nome: nome, p_cpf: cpf, p_telefone: telefone || null, p_email: email || null, p_path: path, p_ua: navigator.userAgent, p_metodo: metodo })
    if (error) { setMsg({ texto: error.message, ok: false }); setBusy(false); return }
    const res = data[0]
    const last4 = telefone.replace(/\D/g, '').slice(-4)
    const fatores = `e-mail informado (${escH(res.email_verificado)})` + (res.ip ? `; IP ${escH(res.ip)}` : '') + (last4 ? `; contato terminado em ••••${last4}` : '')
    setAssinado({ img: canvas.toDataURL('image/png'), nome, cpf, ip: res.ip || '', id: res.id_evento, metodo, fatores, quando: new Date().toLocaleString('pt-BR') })
    setMsg({ texto: '✓ Procuração assinada! Clique em "Baixar PDF".', ok: true })
    gerarEEnviarCopia(nome, email)
    // Dupla verificação: pede ao cliente que confirme por e-mail
    try {
      if (email) {
        const linkC = window.location.origin + '/assinar/confirmar?d=' + params.d + '&s=' + params.s
        signSb.functions.invoke('enviar-confirmacao', { body: { modo: 'pedir', email, nome, titulo: (doc && doc.titulo) || 'Procuração', link: linkC } })
      }
    } catch { /* best-effort */ }
    setBusy(false)
  }

  // Gera o PDF assinado, salva no Storage e dispara a cópia por e-mail (best-effort)
  async function gerarEEnviarCopia(nome, email) {
    try {
      await carregarScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js', () => window.html2canvas)
      await carregarScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js', () => window.jspdf)
      if (!params.d) return
      const { jsPDF } = window.jspdf
      const pdf = new jsPDF('p', 'mm', 'a4')
      const pw = pdf.internal.pageSize.getWidth(), phh = pdf.internal.pageSize.getHeight()
      // espera o React aplicar o bloco assinado no preview antes de fotografar
      await new Promise(r => setTimeout(r, 250))
      const docEl = document.querySelector('.asn-doc')
      const auditEl = document.querySelector('.asn-doc .auditoria')
      const prev = auditEl ? auditEl.style.display : ''
      if (auditEl) auditEl.style.display = 'none'
      const c1 = await window.html2canvas(docEl, { scale: 2, backgroundColor: '#ffffff', useCORS: true })
      if (auditEl) auditEl.style.display = prev
      let w1 = pw, h1 = c1.height * pw / c1.width
      if (h1 > phh) { w1 = c1.width * phh / c1.height; h1 = phh }
      pdf.addImage(c1.toDataURL('image/jpeg', 0.92), 'JPEG', (pw - w1) / 2, 0, w1, h1)
      if (auditEl) {
        const c2 = await window.html2canvas(auditEl, { scale: 2, backgroundColor: '#ffffff', useCORS: true })
        pdf.addPage()
        let w2 = pw - 20, h2 = c2.height * (pw - 20) / c2.width
        if (h2 > phh - 20) { w2 = c2.width * (phh - 20) / c2.height; h2 = phh - 20 }
        pdf.addImage(c2.toDataURL('image/jpeg', 0.92), 'JPEG', 10, 10, w2, h2)
      }
      const blob = pdf.output('blob')
      await signSb.storage.from('documentos').upload(params.d + '.pdf', blob, { upsert: true, contentType: 'application/pdf' })
      const r = await signSb.functions.invoke('enviar-copia-assinada', {
        body: { doc_id: params.d, cliente_email: email, cliente_nome: nome, titulo: (doc && doc.titulo) || 'Procuração', pdf_path: params.d + '.pdf' },
      })
      if (!(r.error) && !(r.data && r.data.ok === false)) {
        setMsg({ texto: '✓ Procuração assinada! Uma cópia foi enviada para ' + email + '. Você também pode clicar em "Baixar PDF".', ok: true })
      }
    } catch (e) { console.error('cópia automática:', e) }
  }

  return (
    <div className="asn-root">
      <style>{CSS}</style>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;600;700&family=Dancing+Script:wght@700&family=Great+Vibes&family=Sacramento&display=swap" rel="stylesheet" />
      <header className="asn-topo">
        <div className="asn-marca">CMP Advogados · Assinatura eletrônica</div>
        <div className="asn-selo">🔒 Assinatura com trilha de auditoria</div>
      </header>

      {!doc && (
        <div className="asn-gate">
          <div className="asn-card">
            <div className="asn-passo">Assinatura eletrônica</div>
            <h2>{gateMsg ? 'Não foi possível abrir' : 'Carregando documento…'}</h2>
            {!gateMsg && <p className="asn-hint">Aguarde um instante.</p>}
            {gateMsg && <div className="asn-msg err">{gateMsg}</div>}
          </div>
        </div>
      )}

      {doc && (
        <div className="asn-wrap">
          <div className="asn-painel-form">
            <div className="asn-card">
              <div className="asn-passo">Seus dados</div>
              <h2>{doc.titulo || 'Procuração'}</h2>
              <label>Nome completo *</label>
              <input value={f.nome} onChange={e => set('nome', e.target.value)}
                onBlur={e => { const v = tituloNome(e.target.value); set('nome', v); if (!sigNomeTyped) setSigNomeTyped(v) }} />
              <div className="asn-grid3">
                <div><label>Nacionalidade</label><input value={f.nacionalidade} onChange={e => set('nacionalidade', e.target.value)} /></div>
                <div><label>Estado civil</label>
                  <select value={f.estadocivil} onChange={e => set('estadocivil', e.target.value)}>
                    <option value="">—</option><option>solteiro(a)</option><option>casado(a)</option>
                    <option>divorciado(a)</option><option>viúvo(a)</option><option>união estável</option>
                  </select></div>
                <div><label>Profissão</label><input value={f.profissao} onChange={e => set('profissao', e.target.value)} /></div>
              </div>
              <div className="asn-grid2">
                <div><label>CPF *</label><input value={f.cpf} placeholder="000.000.000-00" inputMode="numeric" onChange={e => set('cpf', mCPF(e.target.value))} />
                  {f.cpf && !dt && <div className="asn-errocpf">CPF inválido.</div>}</div>
                <div><label>RG / Órgão</label><input value={f.rg} onChange={e => set('rg', e.target.value)} /></div>
              </div>
              <div className="asn-grid2">
                <div><label>CEP (opcional)</label><input value={f.cep} placeholder="00000-000" inputMode="numeric" onChange={e => set('cep', mCEP(e.target.value))} onBlur={buscarCep} />
                  <div className="asn-hint">{cepMsg}</div></div>
                <div><label>Número / complemento</label><input value={f.numero} placeholder="nº, apto, sala" onChange={e => set('numero', e.target.value)} /></div>
              </div>
              <label>Endereço completo</label>
              <input value={f.endereco} onChange={e => set('endereco', e.target.value)} onBlur={e => set('endereco', tituloNome(e.target.value))} />
              <div className="asn-grid2">
                <div><label>E-mail *</label><input value={f.email} type="email" placeholder="voce@email.com" onChange={e => set('email', e.target.value)} />
                  <div className="asn-hint">Enviaremos a cópia assinada para este e-mail.</div></div>
                <div><label>Telefone / WhatsApp (opcional)</label>
                  <input value={f.telefone} type="tel" placeholder="(83) 90000-0000" onChange={e => set('telefone', e.target.value)} /></div>
              </div>
            </div>

            <div className="asn-card" style={{ marginTop: 20 }}>
              <div className="asn-passo">Assinatura</div>
              <h2>Sua assinatura</h2>
              <div className="asn-sigtabs no-print">
                <button type="button" className={'asn-sigtab' + (sigMode === 'typed' ? ' active' : '')} onClick={() => mudarModo('typed')}>Digitar assinatura</button>
                <button type="button" className={'asn-sigtab' + (sigMode === 'draw' ? ' active' : '')} onClick={() => mudarModo('draw')}>Desenhar</button>
              </div>
              <div className="no-print" style={{ display: sigMode === 'typed' ? 'block' : 'none' }}>
                <label>Nome para a assinatura</label>
                <input value={sigNomeTyped} onChange={e => setSigNomeTyped(e.target.value)} onBlur={e => setSigNomeTyped(tituloNome(e.target.value))} />
                <label style={{ marginTop: 10 }}>Estilo da caligrafia</label>
                <div className="asn-fontopts">
                  {FONTES.map(ft => (
                    <button key={ft} type="button" className={'asn-fontopt' + (sigFont === ft ? ' active' : '')} style={{ fontFamily: ft }} onClick={() => setSigFont(ft)}>Assinatura</button>
                  ))}
                </div>
                <div className="asn-sigpreview" style={{ fontFamily: sigFont }}>{sigNomeTyped || f.nome || 'Assinatura'}</div>
              </div>
              <div className="no-print" style={{ display: sigMode === 'draw' ? 'block' : 'none' }}>
                <div className="asn-sigwrap">
                  <canvas ref={canvasRef} className="asn-sig"
                    onMouseDown={startDraw} onMouseMove={moveDraw} onMouseUp={endDraw} onMouseLeave={endDraw}
                    onTouchStart={startDraw} onTouchMove={moveDraw} onTouchEnd={endDraw} />
                  {!temAssinatura && <div className="asn-sigph">✍️ Assine com o dedo ou o mouse</div>}
                </div>
                <button className="btn ghost" onClick={limparSig}>Limpar</button>
              </div>
              <label style={{ marginTop: 14 }}>
                <input type="checkbox" checked={declara} onChange={e => setDeclara(e.target.checked)} style={{ width: 'auto', marginRight: 8 }} />
                Declaro, sob as penas da lei, que as informações são verdadeiras e que sou a pessoa identificada.
              </label>
              <div className="no-print">
                <button className="btn" disabled={!podeAssinar || busy} onClick={assinar}>{busy ? 'Assinando…' : 'Assinar procuração'}</button>
                {assinado && <button className="btn ghost" style={{ marginLeft: 8 }} onClick={() => window.print()}>Baixar PDF</button>}
              </div>
              {msg && <div className={'asn-msg ' + (msg.ok ? 'ok' : 'err')}>{msg.texto}</div>}
            </div>
          </div>
          <div>
            <div className="asn-card asn-doc">
              <div className="asn-watermark"></div>
              <div className="asn-doc-inner" dangerouslySetInnerHTML={{ __html: docHTML }} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
