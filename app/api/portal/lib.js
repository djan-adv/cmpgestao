// Miolo compartilhado do Portal do Cliente — usado pela API do cliente
// (app/api/portal/route.js) e pela API do escritório (app/api/portal/admin/route.js).
// Fica num arquivo próprio porque route.js não pode exportar nada além dos handlers.

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

export function svc() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}

/* ---------- senha (scrypt, sem dependência nova) ---------- */
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

// senha legível para o e-mail: 8 caracteres sem ambíguos (0/O, 1/I/l), em 2 blocos
export function gerarSenha() {
  const alf = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  let s = ''
  const bytes = crypto.randomBytes(8)
  for (let i = 0; i < 8; i++) s += alf[bytes[i] % alf.length]
  return s.slice(0, 4) + '-' + s.slice(4)
}

/* ---------- sessão do cliente (Bearer token do portal) ---------- */
export async function sessao(sb, token) {
  if (!/^[0-9a-f]{48}$/.test(String(token || ''))) return null
  const { data: s } = await sb.from('portal_sessoes').select('token,acesso_id,expira_em').eq('token', token).maybeSingle()
  if (!s) return null
  if (new Date(s.expira_em) < new Date()) { try { await sb.from('portal_sessoes').delete().eq('token', token) } catch (e) {} ; return null }
  const { data: a } = await sb.from('portal_acessos').select('*').eq('id', s.acesso_id).maybeSingle()
  if (!a || !a.ativo || a.bloqueado_em) return null
  try { await sb.from('portal_sessoes').update({ ultimo_uso_em: new Date().toISOString() }).eq('token', token) } catch (e) {}
  return a
}
export function tokenDo(request) {
  return (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
}

export function digitos(s) { return String(s || '').replace(/\D/g, '') }

/* ---------- quais processos um acesso enxerga ----------
   união de: grants explícitos (portal_acesso_processos) + processos do contato
   vinculado (cliente_id igual OU cliente_nome igual ao nome do contato). */
export async function processosPermitidos(sb, acesso) {
  const ids = new Set()
  const g = await sb.from('portal_acesso_processos').select('processo_id').eq('acesso_id', acesso.id)
  ;(g.data || []).forEach(r => ids.add(r.processo_id))
  if (acesso.contato_id) {
    const c = await sb.from('contatos').select('id,nome').eq('id', acesso.contato_id).maybeSingle()
    const q1 = await sb.from('processos').select('id').eq('escritorio_id', acesso.escritorio_id).eq('cliente_id', acesso.contato_id)
    ;(q1.data || []).forEach(r => ids.add(r.id))
    const nome = c.data && String(c.data.nome || '').trim()
    if (nome) {
      const q2 = await sb.from('processos').select('id').eq('escritorio_id', acesso.escritorio_id).ilike('cliente_nome', nome)
      ;(q2.data || []).forEach(r => ids.add(r.id))
    }
  }
  return Array.from(ids)
}
