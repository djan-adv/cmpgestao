// Robô que ENTREGA os avisos de audiência no app do cliente.
//
//   GET /api/cron/avisos-app             → envia o que já venceu
//   GET /api/cron/avisos-app?limite=3    → limita o lote desta rodada
//
// A fila (avisos_app_fila) é montada pelo /api/cron/audiencias, que roda de hora
// em hora. Este aqui roda curto e só dispara o que venceu — é o que torna
// possível avisar 30 e 10 minutos antes sem o planejador rodar a cada minuto.
//
// Nunca reenvia: a linha sai de 'agendado' ANTES do envio (para 'enviando'),
// então duas rodadas simultâneas não pegam o mesmo item. Mesmo desenho da fila de
// e-mails, que já funciona.

import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0
export const maxDuration = 60

const LOTE = 10
const MAX_TENTATIVAS = 3

// Silêncio noturno: nada chega ao cliente antes das 06:00 nem depois das 18:30.
// A checagem existe TAMBÉM aqui, e não só no planejador, de propósito: se o robô
// ficar fora do ar e voltar às 4h da manhã, ele encontra a fila vencida e
// dispararia tudo de uma vez na cabeça do cliente. Aqui ele espera amanhecer.
const JANELA_INI = 6 * 60
const JANELA_FIM = 18 * 60 + 30
function foraDoHorario(d) {
  const local = new Date(d.getTime() - 3 * 3600000)   // Brasília, sem horário de verão
  const m = local.getUTCHours() * 60 + local.getUTCMinutes()
  return m < JANELA_INI || m > JANELA_FIM
}

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}

export async function GET(request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ erro: 'falta service key' }, { status: 500 })
  const { searchParams } = new URL(request.url)
  const limite = Math.max(1, Math.min(LOTE, parseInt(searchParams.get('limite') || String(LOTE), 10) || LOTE))
  const sb = admin()

  if (foraDoHorario(new Date()) && !searchParams.get('forcar')) {
    return Response.json({ ok: true, enviados: 0, silencio: true, motivo: 'fora da janela 06:00–18:30' })
  }

  // item preso em 'enviando' (queda no meio do envio) volta para a fila depois de
  // 10 minutos, senão ficaria parado para sempre
  try {
    await sb.from('avisos_app_fila').update({ status: 'agendado' })
      .eq('status', 'enviando').lt('enviar_em', new Date(Date.now() - 10 * 60000).toISOString())
  } catch (e) {}

  const fila = await sb.from('avisos_app_fila')
    .select('id,escritorio_id,processo_id,processo_numero,data_audiencia,etapa,titulo,corpo,url,tentativas')
    .eq('status', 'agendado').lte('enviar_em', new Date().toISOString())
    .order('enviar_em', { ascending: true }).limit(limite)
  if (fila.error) return Response.json({ erro: fila.error.message }, { status: 500 })
  const itens = fila.data || []
  if (!itens.length) return Response.json({ ok: true, enviados: 0, semDestino: 0, falhas: 0 })

  const { data: v } = await sb.from('app_secrets').select('valor').eq('chave', 'vapid_chat').maybeSingle()
  if (!(v && v.valor)) return Response.json({ ok: true, enviados: 0, erro: 'VAPID não configurado' })
  webpush.setVapidDetails('mailto:contato@cmpadvogados.com.br', v.valor.public, v.valor.private)

  const rel = { ok: true, enviados: 0, semDestino: 0, falhas: 0, detalhe: [] }

  for (const it of itens) {
    // trava: só segue quem conseguir mudar de 'agendado' para 'enviando'
    const lock = await sb.from('avisos_app_fila').update({ status: 'enviando' })
      .eq('id', it.id).eq('status', 'agendado').select('id')
    if (lock.error || !lock.data || !lock.data.length) continue

    try {
      const { data: acessos } = await sb.rpc('portal_acessos_do_processo', { p_processo: it.processo_id })
      const ids = (acessos || []).filter(a => a.ativo && !a.bloqueado_em).map(a => a.id)
      if (!ids.length) {
        await sb.from('avisos_app_fila').update({ status: 'sem_destino', erro: 'cliente sem acesso ativo ao app', enviado_em: new Date().toISOString() }).eq('id', it.id)
        rel.semDestino++
        continue
      }
      const { data: subs } = await sb.from('portal_push_subs').select('*').in('acesso_id', ids)
      if (!subs || !subs.length) {
        await sb.from('avisos_app_fila').update({ status: 'sem_destino', erro: 'cliente não ativou os avisos no celular', enviado_em: new Date().toISOString() }).eq('id', it.id)
        rel.semDestino++
        continue
      }

      const payload = JSON.stringify({ titulo: 'CMP Advogados — ' + it.titulo, corpo: it.corpo, url: it.url || '/portal.html' })
      let ok = 0
      const mortos = []
      for (const s of subs) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } }, payload)
          ok++
        } catch (e) {
          // 404/410 = inscrição morta (app desinstalado, navegador limpo)
          if (e && (e.statusCode === 404 || e.statusCode === 410)) mortos.push(s.endpoint)
        }
      }
      if (mortos.length) { try { await sb.from('portal_push_subs').delete().in('endpoint', mortos) } catch (e) {} }

      if (!ok) {
        const t = (it.tentativas || 0) + 1
        await sb.from('avisos_app_fila').update({ status: t >= MAX_TENTATIVAS ? 'falhou' : 'agendado', tentativas: t, erro: 'nenhum aparelho aceitou o aviso' }).eq('id', it.id)
        rel.falhas++
        continue
      }

      await sb.from('avisos_app_fila').update({ status: 'enviado', enviado_em: new Date().toISOString(), erro: null }).eq('id', it.id)
      rel.enviados++
      rel.detalhe.push({ numero: it.processo_numero, etapa: it.etapa, aparelhos: ok })

      // Confirmação no NOSSO histórico. Fica com fonte 'app', que não está em
      // FONTES_OFICIAIS — então serve de comprovante para o escritório sem
      // poluir a lista de movimentações que o cliente vê.
      try {
        const rotulo = it.etapa === 'vespera' ? 'véspera (1 dia antes)' : (it.etapa === 't30' ? '30 minutos antes' : '10 minutos antes')
        await sb.rpc('robot_add_andamento_fonte', {
          p_num: String(it.processo_numero || '').replace(/\D/g, ''),
          p_data: new Date().toISOString().slice(0, 10),
          p_texto: '[App] Aviso de audiência enviado ao cliente — ' + rotulo + ' (' + String(it.data_audiencia).split('-').reverse().join('/') + ') · ' + ok + ' aparelho(s)',
          p_fonte: 'app',
        })
      } catch (e) { /* o comprovante é acessório: nunca desfaz um aviso já entregue */ }
    } catch (e) {
      const t = (it.tentativas || 0) + 1
      await sb.from('avisos_app_fila').update({ status: t >= MAX_TENTATIVAS ? 'falhou' : 'agendado', tentativas: t, erro: String((e && e.message) || e).slice(0, 300) }).eq('id', it.id)
      rel.falhas++
    }
  }

  return Response.json(rel)
}
