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

   Duas escolhas de propósito:
   - o arquivo original em /opt/cmpdocs NÃO é tocado — a tarja é desenhada na hora da
     entrega, numa cópia em memória;
   - o texto do documento continua selecionável e copiável, porque o carimbo é
     desenhado por cima como conteúdo próprio e não rasteriza nem cobre a camada de
     texto original.

   Sobre o alcance, sem ilusão: a tarja não impede print de tela nem foto. Ela
   identifica a origem de um vazamento. Quem de fato responsabiliza é o
   inove.log_documentos. */
export async function carimbarPdf(buf, etiqueta) {
  const { PDFDocument, StandardFonts, rgb, degrees } = await import('pdf-lib')
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true })
  const fonte = await doc.embedFont(StandardFonts.Helvetica)
  // a fonte padrão do pdf-lib é WinAnsi: troca o que não couber em vez de estourar
  const txt = String(etiqueta || '').replace(/[^\x20-\xFF]/g, '?')
  const TAM = 13
  const largura = fonte.widthOfTextAtSize(txt, TAM)

  for (const pag of doc.getPages()) {
    const { width, height } = pag.getSize()
    const passoX = Math.max(largura * 0.85, 240)
    const passoY = 150
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
  }
  return Buffer.from(await doc.save())
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

export const erro = (msg, status = 400) => Response.json({ erro: msg }, { status })
