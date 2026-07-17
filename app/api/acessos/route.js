// API do CMPGestão — gestão real de acessos (logins) do escritório.
//
// O motivo desta rota: a tela "Acessos" antes só editava uma lista visual na
// memória do navegador (via prompt) e NUNCA criava a conta de verdade no
// Supabase. Por isso pessoas como a Rita e o Jader "cadastravam" e depois não
// conseguiam entrar — a conta não existia. Aqui o coordenador realmente cria/
// altera a senha das contas, usando a chave secreta (service role) no servidor.
//
//   POST /api/acessos   (header Authorization: Bearer <jwt do Supabase>)
//   body: { acao, email, senha, nome, papel }
//     acao = 'salvar'    -> cria a conta (ou atualiza a senha se já existir)
//     acao = 'listar'    -> devolve os usuários do escritório (para refletir o real)
//     acao = 'desativar' -> bloqueia o login da pessoa
//     acao = 'ativar'    -> reativa o login
//     acao = 'renomear'  -> troca o nome exibido da conta
//
// Segurança:
//  - exige usuário autenticado (JWT do Supabase);
//  - exige que o e-mail do solicitante seja de um coordenador (ACESSOS_ALLOW);
//  - a chave secreta (SUPABASE_SERVICE_ROLE_KEY) fica só no servidor, no .env.local.

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// e-mails sempre autorizados a gerenciar acessos (além deles, qualquer usuário com
// papel de sócio/coordenador gerencia os acessos do PRÓPRIO escritório — multi-empresa).
// Pode ampliar sem mexer no código: ACESSOS_ALLOW=email1,email2 no .env.local.
const ACESSOS_ALLOW = (process.env.ACESSOS_ALLOW || 'djan.adv@gmail.com')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY

function admin() {
  // cliente com poderes de administrador (não guarda sessão)
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
  const email = String(user.email || '').toLowerCase()
  if (ACESSOS_ALLOW.includes(email)) return user
  // multi-empresa: sócio/coordenador de qualquer escritório gerencia os próprios acessos
  // (a rota já limita tudo ao escritório do solicitante)
  try {
    const { data } = await admin().from('usuarios').select('papel').eq('id', user.id).single()
    const papel = String((data && data.papel) || '').toLowerCase()
    if (papel === 'socio' || papel === 'sócio' || papel === 'coordenador') return user
  } catch (e) {}
  return null
}

// procura a conta pelo e-mail (varre as páginas de usuários — escritório pequeno)
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

export async function POST(request) {
  if (!SERVICE) {
    return Response.json({
      erro: 'A chave de administrador (SUPABASE_SERVICE_ROLE_KEY) não está configurada no servidor. ' +
            'Adicione-a no arquivo .env.local do sistema e publique novamente.'
    }, { status: 500 })
  }

  const coord = await coordenador(request)
  if (!coord) return Response.json({ erro: 'Sem permissão para gerenciar acessos.' }, { status: 403 })

  let body = {}
  try { body = await request.json() } catch (e) {}
  const acao = String(body.acao || 'salvar')
  const sb = admin()

  // escritório do coordenador (todo mundo que ele cria entra no mesmo escritório)
  const { data: pf } = await sb.from('usuarios').select('escritorio_id').eq('id', coord.id).single()
  const esc = pf && pf.escritorio_id
  if (!esc && acao === 'salvar') {
    return Response.json({ erro: 'Escritório do coordenador não encontrado.' }, { status: 500 })
  }

  try {
    if (acao === 'listar') {
      const { data, error } = await sb.from('usuarios').select('id,nome,email,papel,escritorio_id').eq('escritorio_id', esc)
      if (error) throw new Error(error.message)
      // marca quem está bloqueado (desativado)
      const lista = data || []
      let banned = {}
      try {
        for (let page = 1; page <= 20; page++) {
          const r = await sb.auth.admin.listUsers({ page, perPage: 200 })
          const users = (r.data && r.data.users) || []
          users.forEach(u => { banned[String(u.email || '').toLowerCase()] = !!(u.banned_until && new Date(u.banned_until) > new Date(0)) })
          if (users.length < 200) break
        }
      } catch (e) {}
      const usuarios = lista.map(u => ({ ...u, ativo: !banned[String(u.email || '').toLowerCase()] }))
      return Response.json({ ok: true, usuarios })
    }

    const email = String(body.email || '').trim().toLowerCase()
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return Response.json({ erro: 'E-mail inválido.' }, { status: 400 })
    }

    if (acao === 'salvar') {
      const senha = String(body.senha || '')
      const nome = String(body.nome || '').trim() || null
      const papel = String(body.papel || 'membro').trim() || 'membro'
      if (senha.length < 6) return Response.json({ erro: 'A senha precisa de pelo menos 6 caracteres.' }, { status: 400 })

      const existente = await acharPorEmail(sb, email)
      let uid, criado
      if (existente) {
        // multi-empresa: não se altera (nem "puxa") conta que já pertence a outro escritório
        const { data: donoAtual } = await sb.from('usuarios').select('escritorio_id').eq('id', existente.id).maybeSingle()
        if (donoAtual && donoAtual.escritorio_id && donoAtual.escritorio_id !== esc) {
          return Response.json({ erro: 'Este e-mail já é usado por uma conta de outro escritório.' }, { status: 403 })
        }
        const { error } = await sb.auth.admin.updateUserById(existente.id, { password: senha, email_confirm: true })
        if (error) throw new Error(error.message)
        uid = existente.id; criado = false
      } else {
        const { data, error } = await sb.auth.admin.createUser({ email, password: senha, email_confirm: true })
        if (error) throw new Error(error.message)
        uid = data.user.id; criado = true
      }
      // vincula/atualiza no escritório
      const { error: eU } = await sb.from('usuarios').upsert({ id: uid, escritorio_id: esc, nome, email, papel }, { onConflict: 'id' })
      if (eU) throw new Error(eU.message)
      return Response.json({ ok: true, criado, id: uid })
    }

    if (acao === 'desativar' || acao === 'ativar') {
      const u = await acharPorEmail(sb, email)
      if (!u) return Response.json({ erro: 'Conta não encontrada.' }, { status: 404 })
      // multi-empresa: só se mexe em contas do PRÓPRIO escritório
      const { data: alvo } = await sb.from('usuarios').select('papel').eq('email', email).eq('escritorio_id', esc).maybeSingle()
      if (!alvo) return Response.json({ erro: 'Esta conta não pertence ao seu escritório.' }, { status: 403 })
      // protege o coordenador (lista fixa ou papel de sócio)
      const papelAlvo = String(alvo.papel || '').toLowerCase()
      if (ACESSOS_ALLOW.includes(email) || papelAlvo === 'socio' || papelAlvo === 'sócio' || papelAlvo === 'coordenador') {
        return Response.json({ erro: 'O acesso do coordenador não pode ser desativado.' }, { status: 400 })
      }
      const ban_duration = acao === 'desativar' ? '876000h' : 'none' // ~100 anos ou libera
      const { error } = await sb.auth.admin.updateUserById(u.id, { ban_duration })
      if (error) throw new Error(error.message)
      return Response.json({ ok: true })
    }

    if (acao === 'renomear') {
      const nome = String(body.nome || '').trim()
      if (!nome) return Response.json({ erro: 'Informe o nome.' }, { status: 400 })
      const { error } = await sb.from('usuarios').update({ nome }).eq('email', email).eq('escritorio_id', esc)
      if (error) throw new Error(error.message)
      return Response.json({ ok: true })
    }

    return Response.json({ erro: 'Ação desconhecida.' }, { status: 400 })
  } catch (e) {
    return Response.json({ erro: (e && e.message) || String(e) }, { status: 500 })
  }
}

export async function GET() {
  return Response.json({ info: 'Use POST autenticado para gerenciar acessos do CMPGestão.' })
}
