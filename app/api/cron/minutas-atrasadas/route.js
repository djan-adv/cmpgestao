// Escalonamento do Estagiário Virtual (caso novo): a tarefa de revisar o
// rascunho automático (origem 'minuta_caso_novo', ver /api/assinatura/sync)
// tem prazo de 2 dias úteis para Rita. Passado o prazo e ainda aberta, avisa
// Rita + Djan + Jader (e-mail + push no chat) — pedido do dono, 20/08/2026.
//
//   GET /api/cron/minutas-atrasadas   (chamado pelo /api/cron/tick, 1x/dia)
//
// Idempotente: uma trava por tarefa+dia em notificacoes_jader (mesma tabela
// que os outros avisos do escritório já usam) — nunca avisa duas vezes no
// mesmo dia pela mesma tarefa.

import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'
import webpush from 'web-push'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const ESCRITORIO_CMP = '908f77fc-19f5-4d86-9576-f5590af09e0a'
const ALVOS = [/djan\.adv@gmail\.com/i, /mariaritahenriq@gmail\.com/i, /jadergabrielpinheiro\.adv@gmail\.com/i, /jaderpinheiroadv@gmail\.com/i]

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }

async function enviarEmailAlerta(titulo, linhasHtml) {
  const host = process.env.SMTP_HOST, port = parseInt(process.env.SMTP_PORT || '465', 10)
  const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS
  if (!host || !user || !pass) return { ok: false, motivo: 'SMTP não configurado' }
  const t = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } })
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1e2733;max-width:600px;margin:0 auto">' +
    '<div style="border-top:3px solid #b8912e;padding:14px 6px"><h2 style="color:#2E3A4B;font-size:17px;margin:0 0 10px">' + esc(titulo) + '</h2>' +
    linhasHtml.join('') + '</div>' +
    '<div style="font-size:11px;color:#8a8f98;text-align:center;padding:10px 0;border-top:1px solid #eee">CMPGestão · aviso automático</div></div>'
  try {
    await t.sendMail({ from: '"CMPGestão — Avisos" <' + user + '>', to: ['djan.adv@gmail.com', 'mariaritahenriq@gmail.com', 'jadergabrielpinheiro.adv@gmail.com'], subject: titulo, html })
    return { ok: true }
  } catch (e) { return { ok: false, motivo: (e && e.message) || String(e) } }
}

async function avisarNoCelular(sb, titulo, corpo) {
  try {
    const { data: v } = await sb.from('app_secrets').select('valor').eq('chave', 'vapid_chat').maybeSingle()
    if (!v || !v.valor) return
    webpush.setVapidDetails('mailto:contato@cmpadvogados.com.br', v.valor.public, v.valor.private)
    const { data: eqp } = await sb.from('usuarios').select('id,email').eq('escritorio_id', ESCRITORIO_CMP)
    const alvo = (eqp || []).filter(u => ALVOS.some(re => re.test(u.email || ''))).map(u => u.id)
    if (!alvo.length) return
    const { data: subs } = await sb.from('chat_push_subs').select('*').in('user_id', alvo)
    if (!subs || !subs.length) return
    const payload = JSON.stringify({ titulo, corpo, url: '/chat' })
    const expirados = []
    await Promise.all(subs.map(async (s) => {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } }, payload, { urgency: 'high', TTL: 86400 }) }
      catch (e) { if (e && (e.statusCode === 404 || e.statusCode === 410)) expirados.push(s.endpoint) }
    }))
    if (expirados.length) { try { await sb.from('chat_push_subs').delete().in('endpoint', expirados) } catch (e) {} }
  } catch (e) { /* alarme é reforço — nunca derruba o resto */ }
}

async function avisarNoChat(sb, texto) {
  try {
    const { data: eqp } = await sb.from('usuarios').select('id,email').eq('escritorio_id', ESCRITORIO_CMP)
    const dono = (eqp || []).find(u => /djan\.adv@gmail\.com/i.test(u.email || '')) || (eqp || [])[0]
    if (!dono) return
    await sb.from('chat_mensagens').insert({ escritorio_id: ESCRITORIO_CMP, autor_id: dono.id, autor_nome: '🤖 CMPGestão', para_id: null, texto })
  } catch (e) {}
}

export async function GET() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ erro: 'falta service key' }, { status: 500 })
  const sb = admin()
  const hoje = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10)

  const { data: tarefas, error } = await sb.from('kanban_tarefas')
    .select('id,titulo,cliente,numero,prazo,coluna,arquivada')
    .eq('origem', 'minuta_caso_novo').lt('prazo', hoje)
  if (error) return Response.json({ ok: false, erro: error.message }, { status: 500 })
  const devidas = (tarefas || []).filter(t => t.coluna !== 'finalizado' && t.arquivada !== true)
  if (!devidas.length) return Response.json({ ok: true, avisadas: 0 })

  const novas = []
  for (const t of devidas) {
    const chave = 'minuta_atraso:' + t.id + ':' + hoje
    const trava = await sb.from('notificacoes_jader').insert({ chave, dia: hoje })
    if (!trava.error) novas.push(t)
  }
  if (!novas.length) return Response.json({ ok: true, avisadas: 0, ja_avisadas_hoje: devidas.length })

  const linhasHtml = novas.map(t =>
    '<div style="padding:8px 0;border-top:1px dashed #e4e8ef"><b>' + esc(t.titulo || 'Revisar rascunho') + '</b>' +
    '<div style="color:#697180;font-size:12.5px">' + esc(t.cliente || '') + (t.numero ? (' · ' + esc(t.numero)) : '') + ' · prazo era ' + esc(String(t.prazo).split('-').reverse().join('/')) + '</div></div>'
  )
  const emailR = await enviarEmailAlerta('⚠ ' + novas.length + ' rascunho(s) sem revisão há mais de 2 dias', linhasHtml)
  const textoResumo = novas.map(t => (t.cliente || '') + (t.numero ? (' — ' + t.numero) : '')).join('; ')
  await avisarNoCelular(sb, '⚠ Rascunho(s) atrasado(s)', novas.length + ' peça(s) esperando revisão — ' + textoResumo)
  await avisarNoChat(sb, '⚠ ' + novas.length + ' rascunho(s) do Estagiário Virtual sem revisão há mais de 2 dias:\n' +
    novas.map(t => '• ' + (t.titulo || '') + ' (' + (t.cliente || '') + ')').join('\n') +
    '\n→ Kanban · coluna "A distribuir". @Djan @Rita @Jader')

  return Response.json({ ok: true, avisadas: novas.length, email: emailR.ok })
}
