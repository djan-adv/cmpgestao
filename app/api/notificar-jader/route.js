// Notificações para Jader (e-mail) — NÃO REMOVER / NÃO DESFAZER (pedido expresso do dono).
// Alerta sobre (1) novos leads: aviso imediato e a cada 30 min ATÉ que o card seja
// movimentado/editado/lido; e (2) reuniões agendadas: de manhã, 1h antes e 30 min antes.
//
//   GET /api/notificar-jader        -> faz uma varredura (idempotente) e envia o que estiver devido
//   GET /api/notificar-jader?lead=<id>  -> força o aviso imediato de UM lead recém-criado
//   GET /api/notificar-jader?debug=1
//
// Chamado pelo crontab do VPS a cada ~15-30 min (ver ops/). É idempotente: a trava
// notificacoes_jader impede repetir a mesma janela de reunião; os leads respeitam
// a cadência de 30 min pelo campo notif_ultimo. Sem custo (SMTP próprio).

import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const JADER = ['jadergabrielpinheiro.adv@gmail.com', 'jaderpinheiroadv@gmail.com']
const REMIND_MS = 29 * 60 * 1000   // reenvia lembrete de lead a cada ~30 min
const OFF_BR = -3                  // Brasília = UTC-3 (sem horário de verão hoje)

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}
function transporter() {
  const host = process.env.SMTP_HOST, port = parseInt(process.env.SMTP_PORT || '465', 10)
  const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS
  if (!host || !user || !pass) return null
  return { t: nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } }), user }
}
async function enviar(assunto, corpoHtml, corpoTxt) {
  const tp = transporter()
  if (!tp) return { ok: false, motivo: 'SMTP não configurado' }
  const fromName = process.env.SMTP_FROM_NAME || 'CMPGestão — Avisos'
  try {
    await tp.t.sendMail({ from: '"' + fromName + '" <' + tp.user + '>', to: JADER, subject: assunto, text: corpoTxt || '', html: corpoHtml })
    return { ok: true }
  } catch (e) { return { ok: false, motivo: (e && e.message) || String(e) } }
}
function localAgora() {
  const d = new Date(Date.now() + OFF_BR * 3600 * 1000)
  return { data: d.toISOString().slice(0, 10), h: d.getUTCHours(), m: d.getUTCMinutes(), minutosDia: d.getUTCHours() * 60 + d.getUTCMinutes() }
}
function parseHora(s) {
  const mm = String(s || '').match(/(\d{1,2})[:h](\d{2})/)
  if (!mm) return null
  const h = parseInt(mm[1], 10), mi = parseInt(mm[2], 10)
  if (h > 23 || mi > 59) return null
  return h * 60 + mi
}
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }
function wrap(titulo, blocos) {
  return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1e2733;max-width:600px;margin:0 auto">' +
    '<div style="border-top:3px solid #b8912e;padding:14px 6px"><h2 style="color:#2E3A4B;font-size:17px;margin:0 0 10px">' + esc(titulo) + '</h2>' + blocos + '</div>' +
    '<div style="font-size:11px;color:#8a8f98;text-align:center;padding:10px 0;border-top:1px solid #eee">CMPGestão · aviso automático</div></div>'
}

export async function GET(request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ erro: 'falta SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })
  const { searchParams } = new URL(request.url)
  const debug = searchParams.get('debug') != null
  const soLead = searchParams.get('lead')
  const sb = admin()
  const agora = new Date()
  const nowIso = agora.toISOString()
  const loc = localAgora()
  const resumo = { leads_avisados: 0, reunioes_avisadas: 0, enviados: [], erros: [] }

  // ===== 1) LEADS: imediato + a cada 30 min até atender =====
  try {
    let q = sb.from('crm_leads').select('id,nome,canal,tel,email,estagio,obs,acao,criado_em,notif_ultimo,notif_ack')
      .is('apagado_em', null).eq('notif_ack', false).eq('estagio', 'novo')
      .gte('criado_em', new Date(Date.now() - 14 * 86400000).toISOString())
    if (soLead) q = sb.from('crm_leads').select('id,nome,canal,tel,email,estagio,obs,acao,criado_em,notif_ultimo,notif_ack').eq('id', soLead)
    const { data: leads } = await q
    const devidos = (leads || []).filter(l => {
      if (l.notif_ack) return false
      if (!l.notif_ultimo) return true                         // nunca avisado → imediato
      return (agora - new Date(l.notif_ultimo)) >= REMIND_MS   // passou ~30 min
    })
    if (devidos.length && !debug) {
      const linhas = devidos.map(l => {
        const det = [l.canal && ('canal: ' + l.canal), l.tel && ('tel: ' + l.tel), l.email && ('e-mail: ' + l.email)].filter(Boolean).join(' · ')
        const resumoTxt = l.acao || (l.obs ? String(l.obs).split('\n')[0].slice(0, 120) : '')
        return '<div style="padding:8px 0;border-top:1px dashed #e4e8ef"><b>' + esc(l.nome || 'Novo lead') + '</b>' +
          (det ? '<div style="color:#697180;font-size:12.5px">' + esc(det) + '</div>' : '') +
          (resumoTxt ? '<div style="font-size:13px;margin-top:2px">' + esc(resumoTxt) + '</div>' : '') + '</div>'
      }).join('')
      const html = wrap('🟢 ' + devidos.length + ' lead(s) aguardando atendimento', linhas +
        '<p style="font-size:12px;color:#697180;margin-top:12px">Você recebe este aviso a cada 30 min até abrir/mover/editar o card no funil Comercial. (' + loc.data.split('-').reverse().join('/') + ' ' + String(loc.h).padStart(2, '0') + ':' + String(loc.m).padStart(2, '0') + ')</p>')
      const r = await enviar('Novos leads aguardando — CMPGestão', html, devidos.map(l => l.nome).join(', '))
      if (r.ok) {
        resumo.leads_avisados = devidos.length
        resumo.enviados.push('leads(' + devidos.length + ')')
        for (const l of devidos) { try { await sb.from('crm_leads').update({ notif_ultimo: nowIso }).eq('id', l.id) } catch (e) {} }
      } else resumo.erros.push('leads: ' + r.motivo)
    } else if (debug) resumo.leads_devidos = devidos.map(l => ({ id: l.id, nome: l.nome, notif_ultimo: l.notif_ultimo }))
  } catch (e) { resumo.erros.push('leads: ' + ((e && e.message) || e)) }

  // ===== 2) REUNIÕES: manhã + 1h antes + 30 min antes =====
  try {
    const { data: evs } = await sb.from('agenda_eventos').select('id,data,hora,tipo,titulo,resp,local_evento,descricao')
      .eq('data', loc.data)
    const reunioes = (evs || []).filter(e => /reuni/i.test((e.tipo || '') + ' ' + (e.titulo || '') + ' ' + (e.descricao || '')))
    for (const ev of reunioes) {
      const tmin = parseHora(ev.hora)
      const faltam = (tmin != null) ? (tmin - loc.minutosDia) : null
      const janelas = []
      // manhã: entre 7h e o horário da reunião (uma vez)
      if (loc.h >= 7 && (tmin == null || tmin > loc.minutosDia)) janelas.push('manha')
      if (faltam != null && faltam >= 30 && faltam <= 75) janelas.push('h1')     // ~1h antes
      if (faltam != null && faltam > 0 && faltam <= 35) janelas.push('h30')      // ~30 min antes
      for (const jn of janelas) {
        const chave = 'reuniao:' + ev.id + ':' + jn
        if (!debug) {
          const trava = await sb.from('notificacoes_jader').insert({ chave, dia: loc.data }).select('chave')
          if (trava.error) continue   // já enviado nesta janela hoje
        }
        const quando = ev.hora ? (' às ' + ev.hora) : ''
        const lugar = ev.local_evento ? ('<div style="font-size:12.5px;color:#697180">Local/link: ' + esc(ev.local_evento) + '</div>') : ''
        const rotulo = jn === 'manha' ? 'Reunião HOJE' : (jn === 'h1' ? 'Reunião em ~1 hora' : 'Reunião em ~30 minutos')
        const html = wrap('📅 ' + rotulo + quando, '<div style="padding:6px 0"><b>' + esc(ev.titulo || 'Reunião') + '</b>' + lugar +
          (ev.descricao ? '<div style="font-size:13px;margin-top:4px">' + esc(ev.descricao) + '</div>' : '') + '</div>')
        if (!debug) {
          const r = await enviar(rotulo + quando + ' — CMPGestão', html, (ev.titulo || 'Reunião') + quando)
          if (r.ok) { resumo.reunioes_avisadas++; resumo.enviados.push(chave) }
          else { resumo.erros.push(chave + ': ' + r.motivo); try { await sb.from('notificacoes_jader').delete().eq('chave', chave).eq('dia', loc.data) } catch (e) {} }
        } else resumo.enviados.push('[debug] ' + chave)
      }
    }
  } catch (e) { resumo.erros.push('reunioes: ' + ((e && e.message) || e)) }

  return Response.json({ ok: true, local: loc.data + ' ' + String(loc.h).padStart(2, '0') + ':' + String(loc.m).padStart(2, '0'), ...resumo })
}
