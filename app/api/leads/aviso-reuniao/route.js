// Aviso de reunião marcada com um LEAD (funil comercial) — dispara o e-mail de
// confirmação ao cliente (com o botão "confirmo presença", igual ao aviso de
// audiência) e coloca em cópia quem estiver logado no sistema + o Jader
// (comercial/captação). O evento em si (agenda_eventos) é criado no navegador,
// direto pelo sistema.html — esta rota só cuida do e-mail, que precisa do SMTP
// do servidor.
//
//   POST /api/leads/aviso-reuniao  (Authorization: Bearer <jwt do escritório>)
//     { evento_id, email, nome, data, hora, local, numero_processo? }

import { createClient } from '@supabase/supabase-js'
import { enviarEmailCore, emailValido } from '../../enviar-email/enviar.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// mesma lista do robô de notificação do Jader (app/api/notificar-jader) — NÃO REMOVER.
const JADER = ['jadergabrielpinheiro.adv@gmail.com', 'jaderpinheiroadv@gmail.com']

async function usuarioEscritorio(request) {
  const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const u = await anon.auth.getUser(jwt)
  const user = (u && u.data && u.data.user) || null
  if (!user) return null
  const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const { data } = await svc.from('usuarios').select('id,nome,email,escritorio_id').eq('id', user.id).maybeSingle()
  if (!data) return null
  return data
}

export async function POST(request) {
  const quem = await usuarioEscritorio(request)
  if (!quem) return Response.json({ erro: 'Faça login no sistema.' }, { status: 401 })

  let body = {}
  try { body = await request.json() } catch (e) {}

  const email = String(body.email || '').trim().toLowerCase()
  if (!emailValido(email)) return Response.json({ erro: 'e-mail do cliente inválido' }, { status: 400 })
  const nome = String(body.nome || '').trim()
  const data = String(body.data || '').slice(0, 10)
  const hora = String(body.hora || '').slice(0, 5)
  const local = String(body.local || '').trim()
  const eventoId = body.evento_id ? Number(body.evento_id) : null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return Response.json({ erro: 'data inválida' }, { status: 400 })

  const dbr = data.split('-').reverse().join('/')
  const horaTxt = hora ? (' às ' + hora) : ''
  const corpo =
    'Olá' + (nome ? ', ' + nome : '') + '!\n\n' +
    'Confirmando: sua reunião com o escritório Crispim, Mendonça e Pinheiro Advogados foi marcada para o dia ' + dbr + horaTxt + '.\n\n' +
    (local ? ('Local/link: ' + local + '\n\n') : '') +
    'Qualquer imprevisto, é só responder este e-mail que reagendamos.'

  // quem está logado + Jader, sempre em cópia. Sem duplicar se a mesma pessoa
  // acabar entrando nas duas listas (aconteceria só se um dia o Jader logasse
  // ele mesmo — mantém o e-mail limpo mesmo nesse caso).
  const ccLista = Array.from(new Set([quem.email, ...JADER].filter(Boolean).map(e => String(e).trim().toLowerCase())))

  const r = await enviarEmailCore({
    para: email,
    cc: ccLista.join(', '),
    assunto: 'Reunião confirmada — CMP Advogados',
    corpo,
    numero: String(body.numero_processo || '').replace(/\D/g, ''),
    confirmarEventoId: eventoId,
    dedup: false,
  })
  if (r.erro) return Response.json({ erro: r.erro }, { status: r.status || 500 })
  return Response.json({ ok: true })
}
