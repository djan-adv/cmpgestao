// Fecha sozinho as pendências de protocolo quando a peça APARECE NOS AUTOS.
// O sistema não protocola (ato irreversível) — mas percebe que foi protocolada e
// encerra o prazo fatal, para ninguém ficar com alerta vermelho à toa.
//   GET /api/jusbr/conferir-protocolo[?debug=1]

import { jusbrAdmin, getFreshToken, ESCRITORIO_CMP } from '../lib.js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0
export const maxDuration = 60

const PDPJ = 'https://portaldeservicos.pdpj.jus.br'
const PDPJ_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'Origin': 'https://portaldeservicos.pdpj.jus.br',
  'Referer': 'https://portaldeservicos.pdpj.jus.br/consulta/autosdigitais',
}
const soDig = (s) => String(s || '').replace(/\D/g, '')
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

// a peça juntada corresponde à petição pendente?
function combina(nomeDoc, tituloPend) {
  const nd = norm(nomeDoc), tp = norm(tituloPend)
  if (!nd) return false
  // 1) nome parecido (compartilha palavras significativas)
  const pal = tp.split(' ').filter(w => w.length >= 5)
  if (pal.length && pal.some(w => nd.indexOf(w) > -1)) return true
  // 2) ou é claramente uma peça da parte
  return /peticao|peca|manifestacao|contrarrazoes|recurso|embargos|apelacao|contestacao|replica|memoriais|alegacoes/.test(nd)
}

// Varre o JSON do PDPJ atrás de movimentos (data + texto), sem depender do nome
// exato dos campos — o formato varia entre tribunais.
function colheMovimentos(node, out, prof) {
  out = out || []; prof = prof || 0
  if (!node || typeof node !== 'object' || prof > 7) return out
  if (Array.isArray(node)) { for (const x of node) colheMovimentos(x, out, prof + 1); return out }
  const ks = Object.keys(node)
  let dataV = null, textoV = ''
  for (const k of ks) {
    const v = node[k]
    if (typeof v === 'string') {
      if (!dataV && /data|dt_?mov|datahora/i.test(k) && /\d{4}-\d{2}-\d{2}/.test(v)) dataV = v
      else if (/descri|nome|movimento|complement|titulo|texto|tipo/i.test(k) && v.length > 3) textoV += ' ' + v
    } else if (v && typeof v === 'object') colheMovimentos(v, out, prof + 1)
  }
  if (dataV && textoV.trim()) {
    const ts = new Date(dataV).getTime()
    if (ts) out.push({ iso: dataV, ts, txt: textoV.trim() })
  }
  return out
}

export async function GET(request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ erro: 'falta service key' }, { status: 500 })
  const debug = new URL(request.url).searchParams.get('debug') != null
  const sb = jusbrAdmin()

  const { data: pend } = await sb.from('peticoes_protocolo')
    .select('id,processo_numero,titulo,criado_em,prazo_fatal')
    .eq('escritorio_id', ESCRITORIO_CMP).eq('status', 'pendente').limit(200)
  if (!pend || !pend.length) return Response.json({ ok: true, pendentes: 0, fechadas: 0 })

  const tk = await getFreshToken(sb)
  if (tk.erro) return Response.json({ ok: false, pendentes: pend.length, erro: 'jus.br: ' + tk.erro, motivo: tk.erro })

  // agrupa por processo (um pedido ao PDPJ por processo)
  const porProc = {}
  pend.forEach(x => { const n = soDig(x.processo_numero); (porProc[n] = porProc[n] || []).push(x) })

  const rel = { ok: true, pendentes: pend.length, fechadas: 0, detalhe: [] }
  for (const numero of Object.keys(porProc)) {
    let data
    try {
      const r = await fetch(`${PDPJ}/api/v2/processos/${numero}`, { headers: { ...PDPJ_HEADERS, Authorization: 'Bearer ' + tk.token, Accept: 'application/json' }, signal: AbortSignal.timeout(25000) })
      if (!r.ok) { rel.detalhe.push({ numero, erro: 'HTTP ' + r.status }); continue }
      data = await r.json().catch(() => null)
    } catch (e) { rel.detalhe.push({ numero, erro: 'rede' }); continue }
    const proc = Array.isArray(data && data.content) ? data.content[0] : (Array.isArray(data) ? data[0] : data)
    const docs = (proc && (proc.documentos || (proc.tramitacaoAtual && proc.tramitacaoAtual.documentos))) || []
    // MOVIMENTOS: no PDPJ o "protocolo/juntada" costuma aparecer ANTES da peça em si,
    // que pode demorar dias para entrar nos autos. Por isso olhamos os dois.
    const movs = colheMovimentos(data)

    for (const p of porProc[numero]) {
      const desde = new Date(p.criado_em).getTime()
      let achou = null, via = ''
      if (Array.isArray(docs)) {
        achou = docs.find(d => {
          const dt = new Date(String(d.dataHoraJuntada || d.data || '')).getTime()
          if (!dt || dt < desde) return false               // só peças juntadas DEPOIS do registro
          return combina(d.nome || (d.arquivo && d.arquivo.nome), p.titulo)
        })
        if (achou) via = 'peça nos autos'
      }
      if (!achou) {
        const m = movs.find(x => x.ts >= desde && /junt|petic|protocol/i.test(x.txt))
        if (m) { achou = { nome: m.txt.slice(0, 120), dataHoraJuntada: m.iso }; via = 'movimento' }
      }
      if (!achou) continue
      if (!debug) {
        await sb.from('peticoes_protocolo').update({
          status: 'protocolada',
          protocolada_em: new Date().toISOString(),
          protocolo_ref: String(achou.nome || '').slice(0, 120),
          fechada_por: 'jusbr:' + (via || 'autos'),
        }).eq('id', p.id)
      }
      rel.fechadas++
      rel.detalhe.push({ numero, titulo: p.titulo, via, peca: achou.nome, juntada: achou.dataHoraJuntada })
    }
  }
  return Response.json(rel)
}
