// Convite de reunião para mandar pelo WhatsApp.
//
// Quando o e-mail ao cliente não sai (endereço errado, lead que só tem
// telefone), o agendamento não pode morrer aí: a reunião já está na agenda e o
// cliente precisa ser avisado de algum jeito. Esta rota devolve a mensagem
// pronta — data, hora e link do Google Meet — para copiar e colar na conversa.
//
// O Meet é criado AGORA, não no próximo ciclo do cron: quem está com o cliente
// no telefone precisa do link neste minuto. Se o evento já tiver sido
// sincronizado antes, reaproveita o link que existe em vez de criar outro.
//
//   POST /api/leads/convite-reuniao   (Authorization: Bearer <jwt>)
//     { evento_id }
//   → { ok, meet, mensagem, whatsapp }

import { createClient } from '@supabase/supabase-js'
import { getFreshGoogleToken, sincronizarEvento } from '../../google/lib.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

async function usuarioEscritorio(request) {
  const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const u = await anon.auth.getUser(jwt)
  const user = (u && u.data && u.data.user) || null
  if (!user) return null
  const svc = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const { data } = await svc.from('usuarios').select('id,nome,email,escritorio_id').eq('id', user.id).maybeSingle()
  return data || null
}

const ESCRITORIO = 'Crispim, Mendonça e Pinheiro Advogados'

function montarMensagem({ nome, data, hora, meet, local }) {
  const dbr = String(data || '').split('-').reverse().join('/')
  const linhas = [
    'Olá' + (nome ? ', ' + String(nome).trim() : '') + '!',
    '',
    'Sua reunião com o escritório ' + ESCRITORIO + ' está marcada para ' + dbr + (hora ? (', às ' + hora) : '') + '.',
  ]
  if (meet) linhas.push('', 'Link da videochamada: ' + meet)
  else if (local) linhas.push('', 'Local: ' + local)
  linhas.push('', 'Qualquer imprevisto, é só me avisar por aqui que remarcamos.')
  return linhas.join('\n')
}

export async function POST(request) {
  const quem = await usuarioEscritorio(request)
  if (!quem) return Response.json({ erro: 'Faça login no sistema.' }, { status: 401 })

  let body = {}
  try { body = await request.json() } catch (e) {}
  const eventoId = body.evento_id ? Number(body.evento_id) : null
  if (!eventoId) return Response.json({ erro: 'evento_id obrigatório' }, { status: 400 })

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const { data: ev } = await sb.from('agenda_eventos')
    .select('id,titulo,data,hora,descricao,local_evento,processo_numero,resp,google_event_id,google_meet_link')
    .eq('id', eventoId).maybeSingle()
  if (!ev) return Response.json({ erro: 'evento não encontrado' }, { status: 404 })

  const nome = String(body.nome || '').trim() || String(ev.titulo || '').replace(/^Reuni[ãa]o\s*[—-]\s*/i, '').trim()

  // link que já existe vale mais que link novo: dois Meets para a mesma reunião
  // deixam o cliente numa sala e o escritório na outra
  let meet = ev.google_meet_link || null
  let avisoGoogle = null

  if (!meet) {
    const tok = await getFreshGoogleToken(sb)
    if (tok.erro) {
      avisoGoogle = 'Google Calendar indisponível (' + tok.erro + ') — a mensagem vai sem o link da videochamada.'
    } else {
      const desc = [ev.descricao, ev.processo_numero ? ('Processo: ' + ev.processo_numero) : '', ev.resp ? ('Responsável: ' + ev.resp) : ''].filter(Boolean).join('\n')
      const r = await sincronizarEvento(tok.token, {
        googleEventId: ev.google_event_id || null,
        titulo: ev.titulo || 'Reunião', data: ev.data, hora: ev.hora,
        descricao: desc, local: ev.local_evento || '', comMeet: true,
      })
      if (r.erro) {
        avisoGoogle = 'não consegui criar a sala do Meet (' + r.erro + ') — a mensagem vai sem o link.'
      } else {
        meet = r.meetLink || null
        try {
          await sb.from('agenda_eventos').update({
            google_event_id: r.id, google_meet_link: meet,
            google_sync_em: new Date().toISOString(), google_sync_erro: null,
          }).eq('id', ev.id)
        } catch (e) {}
      }
    }
  }

  const mensagem = montarMensagem({ nome, data: ev.data, hora: ev.hora, meet, local: ev.local_evento })
  const tel = String(body.telefone || '').replace(/\D/g, '')
  const numeroWa = tel ? (tel.length <= 11 ? ('55' + tel) : tel) : ''

  return Response.json({
    ok: true, meet, mensagem, aviso: avisoGoogle,
    whatsapp: 'https://wa.me/' + numeroWa + '?text=' + encodeURIComponent(mensagem),
  })
}
