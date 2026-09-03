// Troca da senha provisória no primeiro acesso.
//
// Quem cria um acesso (o dono do sistema, ou o contratante para a equipe dele)
// gera uma senha provisória e a entrega. A partir do momento em que a pessoa
// entra, a senha tem de ser só dela: ninguém do lado de fora pode continuar
// sabendo como entrar na conta de um advogado e ver processo de cliente.
//
//   POST /api/trocar-senha  (Authorization: Bearer <jwt>)
//   body: { senha }

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SERVICE) return Response.json({ erro: 'servidor sem chave de administrador' }, { status: 500 })

  const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return Response.json({ erro: 'não autenticado' }, { status: 401 })
  const { data: au } = await createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    .auth.getUser(jwt)
  const user = (au && au.user) || null
  if (!user) return Response.json({ erro: 'não autenticado' }, { status: 401 })

  let body = {}
  try { body = await request.json() } catch (e) {}
  const senha = String(body.senha || '')
  // 8 caracteres é o mínimo que o Supabase Auth aceita configurar sem folga;
  // pedir menos aqui só empurraria o erro para a tela seguinte.
  if (senha.length < 8) return Response.json({ erro: 'A senha precisa de pelo menos 8 caracteres.' }, { status: 400 })

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, SERVICE, { auth: { persistSession: false } })
  const { error } = await sb.auth.admin.updateUserById(user.id, { password: senha })
  if (error) return Response.json({ erro: error.message }, { status: 400 })
  await sb.from('usuarios').update({ trocar_senha: false }).eq('id', user.id)
  return Response.json({ ok: true })
}
