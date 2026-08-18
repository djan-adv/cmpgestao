// Miolo do Portal da Inove — conexão, senha, sessão e a tarja dos documentos.
//
// Por que aqui não se usa o cliente do Supabase como no resto do sistema:
// a chave `service_role` ignora RLS e privilégio, e usá-la anularia a barreira que
// isola a Inove do Gestão. Esta rota conecta direto no Postgres como o role
// `inove_app`, que tem acesso total ao schema `inove` e NENHUM ao `public` — o que o
// portal enxerga do Gestão passa pelas views `inove.v_*` e pela função
// `inove.doc_conteudo()`. Ver ops/PROJETO-INOVE.md, seção 4.

import pg from 'pg'
import crypto from 'crypto'
import fs from 'fs'

/* ---------- conexão ---------- */
// O pool vive no globalThis para não abrir uma pilha nova a cada recarga em dev.
function pool() {
  if (!globalThis.__inovePool) {
    const url = process.env.INOVE_DB_URL
    if (!url) throw new Error('INOVE_DB_URL não configurada no servidor.')
    globalThis.__inovePool = new pg.Pool({
      connectionString: url,
      max: 6,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl: { rejectUnauthorized: false },
    })
  }
  return globalThis.__inovePool
}

export async function q(sql, params = []) {
  const r = await pool().query(sql, params)
  return r.rows
}
export async function q1(sql, params = []) {
  const rows = await q(sql, params)
  return rows[0] || null
}

/* ---------- senha (scrypt, mesmo formato do Portal do Cliente) ---------- */
export function hashSenha(senha) {
  const sal = crypto.randomBytes(16).toString('hex')
  const h = crypto.scryptSync(String(senha), sal, 32).toString('hex')
  return 's2$' + sal + '$' + h
}
export function confereSenha(senha, guardado) {
  try {
    const [v, sal, h] = String(guardado || '').split('$')
    if (v !== 's2' || !sal || !h) return false
    const calc = crypto.scryptSync(String(senha), sal, 32)
    return crypto.timingSafeEqual(calc, Buffer.from(h, 'hex'))
  } catch (e) { return false }
}
// senha legível para passar por e-mail: sem 0/O e 1/I/l, em dois blocos
export function gerarSenha() {
  const alf = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const bytes = crypto.randomBytes(8)
  let s = ''
  for (let i = 0; i < 8; i++) s += alf[bytes[i] % alf.length]
  return s.slice(0, 4) + '-' + s.slice(4)
}

/* ---------- sessão ---------- */
export const SESSAO_DIAS = 30

export function tokenDo(request) {
  return (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
}

export async function sessao(token) {
  if (!/^[0-9a-f]{48}$/.test(String(token || ''))) return null
  const s = await q1(
    `select s.token, s.expira_em, a.*
       from inove.sessoes s
       join inove.acessos a on a.id = s.acesso_id
      where s.token = $1`, [token])
  if (!s) return null
  if (new Date(s.expira_em) < new Date()) {
    try { await q('delete from inove.sessoes where token = $1', [token]) } catch (e) {}
    return null
  }
  if (!s.ativo || s.bloqueado_em) return null
  try { await q('update inove.sessoes set ultimo_uso_em = now() where token = $1', [token]) } catch (e) {}
  return s
}

export function ip(request) {
  return (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null
}

/* ---------- trava contra chute de senha ---------- */
const _tent = new Map()
export function podeTentar(chave) {
  const agora = Date.now()
  const rec = (_tent.get(chave) || []).filter(x => agora - x < 10 * 60000)
  _tent.set(chave, rec)
  return rec.length < 10
}
export function marcaTentativa(chave) {
  const t = _tent.get(chave) || []
  t.push(Date.now())
  _tent.set(chave, t)
}

/* ---------- config ---------- */
export async function config() {
  const rows = await q('select chave, valor from inove.config')
  const c = {}
  rows.forEach(r => { c[r.chave] = r.valor })
  return c
}
export function num(c, chave, padrao) {
  const v = parseInt(c[chave] || '', 10)
  return isNaN(v) ? padrao : v
}

/* ---------- tarja diagonal ----------
   Carimba e-mail de quem abriu + data/hora, a 45°, em opacidade baixa, repetido em
   grade para cobrir a página inteira.

   Três escolhas de propósito:
   - o arquivo original em /opt/cmpdocs NÃO é tocado — a tarja é desenhada na hora da
     entrega, numa cópia em memória;
   - o texto do documento continua legível e selecionável;
   - a tarja em si é marcada como Artifact (ISO 32000-1 §14.8.2.2 — a mesma
     classificação usada para marca d'água, numeração de página, cabeçalho/rodapé),
     envolvendo o desenho com os operadores BDC/EMC do PDF. Visores compatíveis
     (Adobe, e o pdf.js que roda por trás do Chrome/Edge) excluem conteúdo marcado
     como Artifact da extração de texto — então selecionar um parágrafo do documento
     não arrasta mais o carimbo junto para o Word. Testado gerando um PDF e inflando
     o content stream salvo: o bloco aparece como
       /Artifact <</Type /Pagination /Subtype /Watermark>> BDC ... EMC
     — que é a sintaxe exata do padrão. Antes disso, o carimbo era texto comum e
     entrava em qualquer seleção que passasse perto — daí o problema relatado.

   Sobre o alcance, sem ilusão: a tarja não impede print de tela nem foto. Ela
   identifica a origem de um vazamento. Quem de fato responsabiliza é o
   inove.log_documentos. */
export async function carimbarPdf(buf, etiqueta) {
  const { PDFDocument, StandardFonts, rgb, degrees, PDFName, PDFOperator } = await import('pdf-lib')
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true })
  const fonte = await doc.embedFont(StandardFonts.Helvetica)
  // a fonte padrão do pdf-lib é WinAnsi: troca o que não couber em vez de estourar
  const txt = String(etiqueta || '').replace(/[^\x20-\xFF]/g, '?')
  const TAM = 13
  const largura = fonte.widthOfTextAtSize(txt, TAM)
  const propsArtefato = doc.context.obj({ Type: 'Pagination', Subtype: 'Watermark' })

  for (const pag of doc.getPages()) {
    const { width, height } = pag.getSize()
    const passoX = Math.max(largura * 0.85, 240)
    const passoY = 150
    pag.pushOperators(PDFOperator.of('BDC', [PDFName.of('Artifact'), propsArtefato]))
    for (let y = -height; y < height * 1.4; y += passoY) {
      for (let x = -largura; x < width * 1.3; x += passoX) {
        pag.drawText(txt, {
          x, y,
          size: TAM,
          font: fonte,
          color: rgb(0.42, 0.47, 0.56),
          opacity: 0.13,
          rotate: degrees(45),
        })
      }
    }
    pag.pushOperators(PDFOperator.of('EMC', []))
  }
  return Buffer.from(await doc.save())
}

/* ---------- tarja diagonal em HTML ----------
   Documentos que o jus.br devolve como HTML (petição, certidão) não passam pelo
   pdf-lib — a tarja aqui é uma camada própria: position:fixed, pointer-events:none e
   user-select:none, então o carimbo nunca entra na seleção nem no copiar/colar,
   sem precisar de truque de marcação como no PDF (o problema nem existe em HTML). */
export function carimbarHtml(html, etiqueta) {
  const txt = String(etiqueta || '')
  const escapado = txt.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const overlay = `
<div aria-hidden="true" style="position:fixed;inset:0;z-index:2147483647;pointer-events:none;user-select:none;-webkit-user-select:none;overflow:hidden">
  <div style="position:absolute;inset:-50%;display:flex;flex-wrap:wrap;align-content:space-around;justify-content:space-around;transform:rotate(-32deg);opacity:.16">
    ${Array.from({ length: 60 }).map(() =>
      `<span style="display:inline-block;margin:34px 46px;font:600 13px system-ui,sans-serif;color:#5a6472;white-space:nowrap">${escapado}</span>`
    ).join('')}
  </div>
</div>`
  if (/<body[\s>]/i.test(html)) return html.replace(/<body([^>]*)>/i, '<body$1>' + overlay)
  // fragmento sem <html>/<body> ao redor (o formato mais comum vindo do jus.br)
  return '<!doctype html><html><head><meta charset="utf-8"></head><body>' + overlay + html + '</body></html>'
}

/* ---------- leitura dos bytes de um documento ----------
   Passa por inove.doc_conteudo(), que é SECURITY DEFINER e confere sozinha se o
   documento pertence a um processo da Inove. O role da aplicação não tem privilégio
   em public.jusbr_arquivos, então não existe caminho alternativo. */
export async function lerDocumento(docId) {
  const d = await q1('select * from inove.doc_conteudo($1)', [docId])
  if (!d) return null
  let buf = null
  if (d.conteudo_b64) buf = Buffer.from(d.conteudo_b64, 'base64')
  else if (d.caminho_disco) { try { buf = fs.readFileSync(d.caminho_disco) } catch (e) { buf = null } }
  if (!buf || !buf.length) return null
  return { ...d, buf }
}

/* ---------- log de acesso a documento ---------- */
export async function logDoc(acesso, doc, acao, request) {
  try {
    await q(
      `insert into inove.log_documentos
         (acesso_id, email, processo_id, processo_numero, doc_tipo, doc_id, doc_nome, acao, ip, user_agent)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        acesso.id, acesso.email, doc.processo_id || null, doc.processo_numero || null,
        doc.doc_tipo || null, String(doc.id || ''), doc.doc_nome || null, acao,
        ip(request), (request.headers.get('user-agent') || '').slice(0, 400),
      ])
  } catch (e) { /* log não pode derrubar a entrega do documento */ }
}

/* ---------- alerta para o escritório ---------- */
export async function alertarEscritorio(assunto, corpo) {
  try {
    const { enviarEmailCore } = await import('../enviar-email/enviar.js')
    await enviarEmailCore({
      para: process.env.INOVE_ALERTA_EMAIL || 'djan.adv@gmail.com',
      assunto,
      corpo,
      dedup: false,
    })
  } catch (e) { /* alerta falhar não pode quebrar a ação do usuário */ }
}

/* ---------- e-mail de acesso novo ----------
   Mesmo espírito do "esqueci senha": quem cadastra não digita senha nenhuma — o
   sistema gera, manda pronta por e-mail, e quem recebe já entra com ela. */
export async function enviarAcessoInove({ nome, email, senha, controlador }) {
  const { enviarEmailCore, URL_PUBLICA } = await import('../enviar-email/enviar.js')
  const corpo =
    'Olá' + (nome ? ', ' + nome : '') + '!\n\n' +
    'Seu acesso ao Portal do Perito está pronto' + (controlador ? ' — como controlador, você também pode criar acesso para o restante da equipe.' : '.') + '\n\n' +
    'ENDEREÇO: ' + URL_PUBLICA + '/inove.html\n' +
    'E-MAIL: ' + email + '\n' +
    'SENHA: ' + senha + '\n\n' +
    'IMPORTANTE:\n' +
    '• O acesso é pessoal — não compartilhe.\n' +
    '• As peças dos processos são de uso restrito: cada documento aberto sai carimbado com o seu e-mail e o acesso fica registrado.\n' +
    '• Qualquer dúvida, é só responder este e-mail.'
  return enviarEmailCore({
    para: email,
    assunto: (controlador ? 'Seu acesso (controlador) ' : 'Seu acesso ') + 'ao Portal do Perito — Inove',
    corpo, dedup: false,
  })
}

export const erro = (msg, status = 400) => Response.json({ erro: msg }, { status })
