// Miolo do site do corretor (djan.net.br) — conexão, senha e sessão.
//
// Mesma lógica de isolamento da Inove (ops/PROJETO-INOVE.md, seção 4): esta rota
// nunca usa o cliente do Supabase nem a service_role da CMP. Conecta direto no
// Postgres como o role `imoveis_app`, que só enxerga o schema `imoveis`.

import pg from 'pg'
import crypto from 'crypto'

function pool() {
  if (!globalThis.__imoveisPool) {
    const url = process.env.IMOVEIS_DB_URL
    if (!url) throw new Error('IMOVEIS_DB_URL não configurada no servidor.')
    globalThis.__imoveisPool = new pg.Pool({
      connectionString: url,
      max: 4,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl: { rejectUnauthorized: false },
    })
  }
  return globalThis.__imoveisPool
}

export async function q(sql, params = []) {
  const r = await pool().query(sql, params)
  return r.rows
}
export async function q1(sql, params = []) {
  const rows = await q(sql, params)
  return rows[0] || null
}

/* ---------- senha (mesmo formato scrypt do Portal/Inove) ---------- */
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

/* ---------- sessão do admin único ---------- */
export const SESSAO_DIAS = 30

export function tokenDo(request) {
  return (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
}

export async function sessaoAdminValida(token) {
  if (!/^[0-9a-f]{48}$/.test(String(token || ''))) return false
  const s = await q1('select token, expira_em from imoveis.sessoes where token = $1', [token])
  if (!s) return false
  if (new Date(s.expira_em) < new Date()) {
    try { await q('delete from imoveis.sessoes where token = $1', [token]) } catch (e) {}
    return false
  }
  return true
}

/* ---------- sessão do anunciante (dono do imóvel, autoatendimento) ---------- */
export async function sessaoAnunciante(token) {
  if (!/^[0-9a-f]{48}$/.test(String(token || ''))) return null
  const s = await q1(
    `select s.token, s.expira_em, a.*
       from imoveis.anunciante_sessoes s
       join imoveis.anunciantes a on a.id = s.anunciante_id
      where s.token = $1`, [token])
  if (!s) return null
  if (new Date(s.expira_em) < new Date()) {
    try { await q('delete from imoveis.anunciante_sessoes where token = $1', [token]) } catch (e) {}
    return null
  }
  if (!s.ativo) return null
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

export const erro = (msg, status = 400) => Response.json({ erro: msg }, { status })
