// Robô da fila de e-mails com hora marcada — o que faz o "horário da vara" valer.
// Roda a cada poucos minutos pelo maestro (/api/cron/tick) e envia o que já venceu.
//
//   GET /api/cron/email-fila            → envia os vencidos (no máximo LOTE por vez)
//   GET /api/cron/email-fila?limite=3   → limita o lote nesta rodada
//
// A hora certa é decidida no painel, na hora de agendar (08:00 justiça comum e
// trabalhista, 10:00 justiça federal, sempre em dia útil). Aqui é só disparar.
//
// Nunca reenvia: a linha sai de 'agendado' ANTES do envio (para 'enviando'), então
// duas rodadas simultâneas não pegam o mesmo item. Falha vira 'agendado' de novo
// até 3 tentativas; depois disso fica 'falhou' e aparece no painel.

import { createClient } from '@supabase/supabase-js'
import { enviarEmailCore } from '../../enviar-email/enviar.js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0
export const maxDuration = 60

const LOTE = 8
const MAX_TENTATIVAS = 3

function admin() { return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } }) }

export async function GET(request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ erro: 'falta service key' }, { status: 500 })
  const { searchParams } = new URL(request.url)
  const limite = Math.max(1, Math.min(LOTE, parseInt(searchParams.get('limite') || String(LOTE), 10) || LOTE))
  const sb = admin()

  // destravamento: item que ficou preso em 'enviando' (queda do servidor no meio
  // do envio) volta para a fila depois de 10 minutos, senão ficaria parado para sempre
  try {
    await sb.from('emails_agendados').update({ status: 'agendado' })
      .eq('status', 'enviando').lt('enviar_em', new Date(Date.now() - 10 * 60000).toISOString())
  } catch (e) {}

  const fila = await sb.from('emails_agendados')
    .select('id,para,cc,assunto,corpo,numero,tentativas,enviar_em,in_reply_to,responder_id')
    .eq('status', 'agendado').lte('enviar_em', new Date().toISOString())
    .order('enviar_em', { ascending: true }).limit(limite)
  if (fila.error) return Response.json({ erro: fila.error.message }, { status: 500 })
  const itens = fila.data || []
  if (!itens.length) return Response.json({ ok: true, enviados: 0, resumo: 'fila vazia' })

  const res = []
  for (const it of itens) {
    // trava: só segue quem conseguir tirar a linha de 'agendado'
    const trava = await sb.from('emails_agendados').update({ status: 'enviando', tentativas: (it.tentativas || 0) + 1 })
      .eq('id', it.id).eq('status', 'agendado').select('id')
    if (trava.error || !trava.data || !trava.data.length) continue

    const r = await enviarEmailCore({ para: it.para, cc: it.cc, assunto: it.assunto, corpo: it.corpo, numero: it.numero, inReplyTo: it.in_reply_to || '' })
    if (r.ok) {
      await sb.from('emails_agendados').update({ status: 'enviado', enviado_em: new Date().toISOString(), erro: null }).eq('id', it.id)
      // era resposta: o e-mail original passa a constar como respondido só agora
      if (it.responder_id) { try { await sb.from('emails_recebidos').update({ respondido: true, lido: true }).eq('id', it.responder_id) } catch (e) {} }
      res.push({ id: it.id, para: it.para, ok: true })
    } else {
      // repetição não é falha de infra: não adianta tentar de novo, é conteúdo já enviado hoje
      const desiste = r.repetido || (it.tentativas || 0) + 1 >= MAX_TENTATIVAS
      await sb.from('emails_agendados').update({ status: desiste ? 'falhou' : 'agendado', erro: String(r.erro || '').slice(0, 400) }).eq('id', it.id)
      res.push({ id: it.id, para: it.para, ok: false, erro: String(r.erro || '').slice(0, 160), desistiu: desiste })
    }
  }

  const n = res.filter(x => x.ok).length
  return Response.json({ ok: true, enviados: n, falhas: res.length - n, itens: res })
}
