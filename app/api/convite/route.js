// API do CMPGestão — convite de acesso por LINK pessoal.
//
// Fluxo: o coordenador gera um link por pessoa (tela Acessos) e manda pelo
// WhatsApp. A pessoa abre o link (convite.html), confere/edita o próprio nome,
// informa o e-mail e cria a própria senha — a conta nasce na hora, no escritório
// do coordenador, com acesso total (por enquanto não há restrição por perfil).
//
//   POST /api/convite {acao:'criar', nome_sugerido, papel}   (Bearer coordenador)
//       -> { ok, token }
//   GET  /api/convite?t=<token>                               (público)
//       -> { ok, nome_sugerido, usado }
//   POST /api/convite {acao:'aceitar', token, nome, email, senha}  (público)
//       -> { ok }
//
// Segurança: a tabela convites não tem políticas públicas (só o service role);
// o token é um UUID não adivinhável e expira em 7 dias ou no primeiro uso.

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const ACESSOS_ALLOW = ['djan.adv@gmail.com']
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
const DIAS_VALIDADE = 7

function admin() {
  return createClient(SB_URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })
}
async function coordenador(request) {
  const auth = request.headers.get('authorization') || ''
  const jwt = auth.replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const sb = createClient(SB_URL, ANON)
  const u = await sb.auth.getUser(jwt)
  const user = (u && u.data && u.data.user) || null
  if (!user) return null
  if (!ACESSOS_ALLOW.includes(String(user.email || '').toLowerCase())) return null
  return user
}
function expirado(criado_em) {
  return (Date.now() - new Date(criado_em).getTime()) > DIAS_VALIDADE * 86400000
}
async function acharPorEmail(sb, email) {
  const alvo = String(email || '').toLowerCase()
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw new Error(error.message)
    const users = (data && data.users) || []
    const hit = users.find(x => String(x.email || '').toLowerCase() === alvo)
    if (hit) return hit
    if (users.length < 200) break
  }
  return null
}

export async function GET(request) {
  if (!SERVICE) return Response.json({ erro: 'servidor sem SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })
  const { searchParams } = new URL(request.url)
  const t = String(searchParams.get('t') || '').trim()
  if (!/^[0-9a-f-]{36}$/i.test(t)) return Response.json({ erro: 'convite inválido' }, { status: 400 })
  const sb = admin()
  const { data: c } = await sb.from('convites').select('nome_sugerido,papel,criado_em,usado_em').eq('token', t).maybeSingle()
  if (!c) return Response.json({ erro: 'Convite não encontrado — peça um novo link ao coordenador.' }, { status: 404 })
  if (c.usado_em) return Response.json({ ok: true, usado: true, nome_sugerido: c.nome_sugerido })
  if (expirado(c.criado_em)) return Response.json({ erro: 'Este convite expirou (7 dias) — peça um novo link ao coordenador.' }, { status: 410 })
  return Response.json({ ok: true, usado: false, nome_sugerido: c.nome_sugerido || '' })
}

export async function POST(request) {
  if (!SERVICE) return Response.json({ erro: 'servidor sem SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })
  let body = {}
  try { body = await request.json() } catch (e) {}
  const acao = String(body.acao || '')
  const sb = admin()

  if (acao === 'criar') {
    const coord = await coordenador(request)
    if (!coord) return Response.json({ erro: 'Sem permissão para gerar convites.' }, { status: 403 })
    const { data: pf } = await sb.from('usuarios').select('escritorio_id').eq('id', coord.id).single()
    const esc = pf && pf.escritorio_id
    if (!esc) return Response.json({ erro: 'Escritório do coordenador não encontrado.' }, { status: 500 })
    const nome = String(body.nome_sugerido || '').slice(0, 120) || null
    const papel = String(body.papel || 'membro').slice(0, 40)
    const { data, error } = await sb.from('convites').insert({ escritorio_id: esc, nome_sugerido: nome, papel }).select('token').single()
    if (error) return Response.json({ erro: error.message }, { status: 500 })
    return Response.json({ ok: true, token: data.token })
  }

  if (acao === 'aceitar') {
    const t = String(body.token || '').trim()
    const nome = String(body.nome || '').replace(/\s+/g, ' ').trim()
    const email = String(body.email || '').trim().toLowerCase()
    const senha = String(body.senha || '')
    if (!/^[0-9a-f-]{36}$/i.test(t)) return Response.json({ erro: 'convite inválido' }, { status: 400 })
    if (!nome || nome.length < 3) return Response.json({ erro: 'Informe seu nome completo.' }, { status: 400 })
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return Response.json({ erro: 'E-mail inválido.' }, { status: 400 })
    if (senha.length < 6) return Response.json({ erro: 'A senha precisa de pelo menos 6 caracteres.' }, { status: 400 })

    const { data: c } = await sb.from('convites').select('*').eq('token', t).maybeSingle()
    if (!c) return Response.json({ erro: 'Convite não encontrado — peça um novo link ao coordenador.' }, { status: 404 })
    if (c.usado_em) return Response.json({ erro: 'Este convite já foi usado. Se foi você, entre normalmente no sistema; senão, peça um novo link.' }, { status: 409 })
    if (expirado(c.criado_em)) return Response.json({ erro: 'Este convite expirou (7 dias) — peça um novo link ao coordenador.' }, { status: 410 })

    try {
      const existente = await acharPorEmail(sb, email)
      let uid
      if (existente) {
        // conta já existe: aproveita o convite para (re)definir a senha e vincular ao escritório
        const { error } = await sb.auth.admin.updateUserById(existente.id, { password: senha, email_confirm: true })
        if (error) throw new Error(error.message)
        uid = existente.id
      } else {
        const { data, error } = await sb.auth.admin.createUser({ email, password: senha, email_confirm: true })
        if (error) throw new Error(error.message)
        uid = data.user.id
      }
      const { error: eU } = await sb.from('usuarios').upsert({ id: uid, escritorio_id: c.escritorio_id, nome, email, papel: c.papel || 'membro' }, { onConflict: 'id' })
      if (eU) throw new Error(eU.message)
      await sb.from('convites').update({ usado_em: new Date().toISOString(), email_usado: email }).eq('token', t)
      return Response.json({ ok: true })
    } catch (e) {
      return Response.json({ erro: (e && e.message) || String(e) }, { status: 500 })
    }
  }

  return Response.json({ erro: 'Ação desconhecida.' }, { status: 400 })
}
