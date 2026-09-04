// API do CMPGestão — envio de e-mail pelo servidor (SMTP Hostinger).
// Garante que TODO e-mail sai de contato@cmpadvogados.com.br, independente de
// quem está logado no navegador. O motor de envio vive em ./enviar.js, compartilhado
// com o robô da fila (/api/cron/email-fila).
//
//   POST /api/enviar-email  (Authorization: Bearer <jwt do Supabase>)
//   body: { para, assunto, corpo, numero?, cc? }              → envia agora
//   body: { ..., enviar_em: '2026-07-28T11:00:00.000Z' }      → entra na fila
//
// A fila existe por causa do horário das varas: e-mail escrito às 14h só sai às
// 08:00 (justiça comum e trabalhista) ou às 10:00 (justiça federal) do próximo
// dia útil, para chegar no topo da caixa do servidor.
//
// Segurança: exige usuário autenticado. Credenciais SMTP vêm de variáveis de
// ambiente (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS) — nunca no código.

import { createClient } from '@supabase/supabase-js'
import { enviarEmailCore, emailValido } from './enviar.js'
import { contaDemo, respostaDemo } from '../../../lib/demo.js'
import { escritorioDoUsuario, semEscritorio, canalLiberado, bloqueioDeCanal } from '../_lib/inquilino.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

async function usuario(request) {
  const auth = request.headers.get('authorization') || ''
  const jwt = auth.replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const u = await sb.auth.getUser(jwt)
  const user = (u && u.data && u.data.user) || null
  return user ? { user, jwt } : null
}

// Põe na fila em vez de enviar. Usa o token do usuário, então a RLS resolve o
// escritório sozinha e o item só é visto por quem é do escritório.
async function agendar(sess, body, quando) {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: 'Bearer ' + sess.jwt } }, auth: { persistSession: false },
  })
  const meu = await sb.from('usuarios').select('escritorio_id,nome').eq('id', sess.user.id).single()
  if (meu.error || !meu.data) return Response.json({ erro: 'não foi possível identificar o escritório do usuário' }, { status: 403 })

  const para = String(body.para || '').trim().toLowerCase()
  const assunto = String(body.assunto || '').trim()
  const corpo = String(body.corpo || '')
  const numero = String(body.numero || '').replace(/\D/g, '')

  // não deixa a mesma mensagem entrar duas vezes na fila (clique repetido)
  try {
    const ja = await sb.from('emails_agendados').select('id,enviar_em')
      .eq('status', 'agendado').eq('para', para).eq('numero', numero).eq('assunto', assunto).limit(1)
    if (ja.data && ja.data.length) {
      return Response.json({ erro: 'Este mesmo e-mail já está na fila para ' + ja.data[0].enviar_em + '. Cancele o agendamento antes de criar outro.', jaNaFila: true }, { status: 409 })
    }
  } catch (e) { /* sem checagem: segue */ }

  const ins = await sb.from('emails_agendados').insert({
    escritorio_id: meu.data.escritorio_id,
    para, cc: String(body.cc || '').trim() || null,
    assunto, corpo, numero,
    enviar_em: quando.toISOString(),
    destino: String(body.destino || 'vara'),
    criado_por: meu.data.nome || sess.user.email || null,
  }).select('id,enviar_em').single()
  if (ins.error) return Response.json({ erro: 'não foi possível agendar: ' + ins.error.message }, { status: 500 })
  return Response.json({ ok: true, agendado: true, id: ins.data.id, enviar_em: ins.data.enviar_em })
}

export async function POST(request) {
  const sess = await usuario(request)
  if (!sess) return Response.json({ erro: 'não autenticado' }, { status: 401 })
  if (await contaDemo(sess)) return respostaDemo('enviar e-mail')

  // Todo e-mail sai da MESMA caixa (contato@cmpadvogados.com.br). Para o
  // escritório dono do sistema isso é o esperado; para um escritório cliente
  // seria um e-mail saindo do endereço do fornecedor, em nome dele, para o
  // cliente ou a vara dele. O canal só abre com conta de envio própria.
  const escRemetente = await escritorioDoUsuario(sess.user.id)
  if (!escRemetente) return semEscritorio()
  const liberado = await canalLiberado(escRemetente, 'email')
  if (!liberado.ok) return bloqueioDeCanal(liberado)

  let body
  try { body = await request.json() } catch (e) { return Response.json({ erro: 'json inválido' }, { status: 400 }) }

  // validação comum aos dois caminhos, para não guardar lixo na fila
  if (!emailValido(body.para)) return Response.json({ erro: 'e-mail do destinatário inválido' }, { status: 400 })
  // cc pode vir com vários endereços separados por vírgula — valida um a um
  if (body.cc && !String(body.cc).split(',').every(x => !x.trim() || emailValido(x.trim()))) {
    return Response.json({ erro: 'e-mail da cópia (cc) inválido' }, { status: 400 })
  }
  if (!String(body.corpo || '').trim()) return Response.json({ erro: 'corpo vazio' }, { status: 400 })

  // ——— com hora marcada: entra na fila e sai sozinho no horário ———
  if (body.enviar_em) {
    const quando = new Date(body.enviar_em)
    if (isNaN(quando.getTime())) return Response.json({ erro: 'data de envio inválida' }, { status: 400 })
    if (quando.getTime() > Date.now() + 60 * 86400000) return Response.json({ erro: 'data de envio muito distante (máximo 60 dias)' }, { status: 400 })
    return agendar(sess, body, quando)
  }

  // ——— envio na hora ———
  // in_reply_to: message-id do e-mail respondido — encaixa a resposta na conversa
  const r = await enviarEmailCore({
    // a raiz continua com a conta do ambiente; um escritório cliente usa a dele
    escritorioId: liberado.raiz ? null : escRemetente,
    para: body.para, cc: body.cc, assunto: body.assunto, corpo: body.corpo, numero: body.numero,
    inReplyTo: String(body.in_reply_to || ''),
    // aviso de audiência: liga o botão "confirmo presença" apontando para o evento
    confirmarEventoId: (body.confirmar_evento ? Number(body.confirmar_evento) : null) || null,
    // reenvio deliberado (botão "reenviar aviso"): pula a trava de repetição do dia
    dedup: !body.forcar,
    // arquivos escolhidos pelo advogado (ex.: a sentença) — [{filename, content_base64}]
    anexos: Array.isArray(body.anexos) ? body.anexos : [],
    // 'vara': tira o rodapé social (Instagram/áreas de atuação) — não cabe em e-mail processual
    destino: String(body.destino || ''),
  })
  if (r.erro) return Response.json({ erro: r.erro, repetido: r.repetido }, { status: r.status || 500 })

  // resposta enviada: marca o e-mail original como respondido na caixa
  if (body.responder_id) {
    try {
      const sbU = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: 'Bearer ' + sess.jwt } }, auth: { persistSession: false },
      })
      await sbU.from('emails_recebidos').update({ respondido: true, lido: true }).eq('id', body.responder_id)
    } catch (e) {}
  }
  return Response.json(r)
}
