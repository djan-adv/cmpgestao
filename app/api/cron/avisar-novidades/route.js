// Aviso de novidade do aplicativo para quem JÁ USA o app.
//
// Não é um robô de horário: nunca dispara sozinho (não tem cada_min nem
// diario_hora no catálogo do tick). Só roda no botão "▶ rodar agora" do painel
// Robôs, ou por chamada direta. Mandar e-mail para a base inteira é decisão de
// quem assina o escritório, não de um relógio.
//
//   GET /api/cron/avisar-novidades              -> só CONTA (não envia nada)
//   GET /api/cron/avisar-novidades?liberar=sim  -> envia o lote
//   GET /api/cron/avisar-novidades?liberar=sim&limite=20
//
// Quem recebe: acesso ATIVO, não bloqueado, que já entrou no app pelo menos uma
// vez (primeiro_login_em) — "quem já tem o aplicativo". Quem nunca entrou não
// recebe: para essa pessoa a novidade não é novidade, é convite, e convite tem
// outro texto e outro momento.
//
// Só o escritório RAIZ: as novidades são as da casa, e a consulta de processos
// não existe no app dos escritórios clientes. Mandar isso para o cliente de
// outro escritório seria prometer o que ele não tem.
//
// Idempotente: cada envio vira linha em portal_avisos_novidade (único por
// acesso+campanha). Rodar de novo só alcança quem ficou de fora.

import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'
import { enviarEmailCore } from '../../enviar-email/enviar.js'
import { nomeDoEscritorio, urlPortalDoEscritorio } from '../../portal/convite-lib.js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 300

const CAMPANHA = 'novidades-2026-09'
const LOTE_PADRAO = 40

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}
function emailValido(e) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e || '').trim()) }

export function corpoNovidades({ nome, endereco, casa }) {
  const primeiro = String(nome || '').trim().split(/\s+/)[0] || ''
  return (primeiro ? 'Olá, ' + primeiro + '!' : 'Olá!') + '\n\n' +
    'Duas novidades no aplicativo que você já usa para acompanhar seu processo.\n\n' +
    '1) NÃO PRECISA MAIS DIGITAR LOGIN E SENHA A CADA VEZ\n' +
    'O aplicativo mantém você conectado. Abre e já está lá dentro, como qualquer aplicativo do celular.\n\n' +
    '2) CONSULTA DE PROCESSOS NO SEU NOME\n' +
    'Dentro do aplicativo você pode consultar processos publicados no seu nome, inclusive os que não são conduzidos por nós. Basta informar seu nome e seu CPF ou CNPJ.\n\n' +
    'Endereço do aplicativo: ' + endereco + '\n\n' +
    'Atenciosamente,\n' + casa
}

export async function GET(request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ erro: 'falta service key' }, { status: 500 })
  const { searchParams } = new URL(request.url)
  const enviar = searchParams.get('liberar') === 'sim'
  const limite = Math.max(1, Math.min(200, parseInt(searchParams.get('limite') || String(LOTE_PADRAO), 10) || LOTE_PADRAO))
  const sb = admin()

  const { data: raiz } = await sb.from('escritorios').select('id,nome,marca').eq('raiz', true).maybeSingle()
  if (!raiz) return Response.json({ erro: 'escritório raiz não encontrado' }, { status: 500 })

  const { data: acessos } = await sb.from('portal_acessos')
    .select('id,nome,email,ativo,bloqueado_em,primeiro_login_em')
    .eq('escritorio_id', raiz.id).eq('ativo', true).is('bloqueado_em', null)
    .not('primeiro_login_em', 'is', null)
  const alvo = (acessos || []).filter(a => emailValido(a.email))

  const { data: jaFoi } = await sb.from('portal_avisos_novidade')
    .select('acesso_id').eq('escritorio_id', raiz.id).eq('campanha', CAMPANHA)
  const feitos = new Set((jaFoi || []).map(x => String(x.acesso_id)))
  const pendentes = alvo.filter(a => !feitos.has(String(a.id)))

  if (!enviar) {
    return Response.json({
      ok: true, simulacao: true, campanha: CAMPANHA,
      usam_o_app: alvo.length, ja_avisados: alvo.length - pendentes.length, a_enviar: pendentes.length,
      aviso: 'Nada foi enviado. Para enviar de verdade, chame com ?liberar=sim.',
    })
  }

  const casa = await nomeDoEscritorio(sb, raiz.id)
  const endereco = await urlPortalDoEscritorio(sb, raiz.id)

  // push é acessório: quem não ligou os avisos recebe só o e-mail
  let podePush = false
  try {
    const { data: v } = await sb.from('app_secrets').select('valor').eq('chave', 'vapid_chat').maybeSingle()
    if (v && v.valor) { webpush.setVapidDetails('mailto:' + (process.env.SMTP_USER || 'contato@localhost'), v.valor.public, v.valor.private); podePush = true }
  } catch (e) {}

  const lote = pendentes.slice(0, limite)
  const rel = { ok: true, campanha: CAMPANHA, enviados: 0, com_aviso_no_celular: 0, falhas: 0, detalhe: [] }

  for (const a of lote) {
    try {
      const env = await enviarEmailCore({
        para: a.email,
        assunto: 'Duas novidades no aplicativo — ' + casa,
        corpo: corpoNovidades({ nome: a.nome, endereco, casa }),
        numero: '', dedup: false, convidarApp: false, escritorioId: null,
      })
      if (env && env.erro) { rel.falhas++; rel.detalhe.push({ email: a.email, erro: String(env.erro).slice(0, 140) }); continue }
      await sb.from('portal_avisos_novidade').insert({
        escritorio_id: raiz.id, acesso_id: a.id, campanha: CAMPANHA, email: a.email, canal: 'email',
      })
      rel.enviados++

      if (podePush) {
        const { data: subs } = await sb.from('portal_push_subs').select('*').eq('acesso_id', a.id)
        const payload = JSON.stringify({
          titulo: casa + ' — duas novidades no aplicativo',
          corpo: 'Não precisa mais digitar senha a cada vez, e agora dá para consultar processos no seu nome.',
          url: '/portal.html',
        })
        const mortos = []
        let entregou = false
        await Promise.all((subs || []).map(async (s) => {
          try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } }, payload); entregou = true }
          catch (e) { if (e && (e.statusCode === 404 || e.statusCode === 410)) mortos.push(s.endpoint) }
        }))
        if (mortos.length) { try { await sb.from('portal_push_subs').delete().in('endpoint', mortos) } catch (e) {} }
        if (entregou) rel.com_aviso_no_celular++
      }
    } catch (e) {
      rel.falhas++
      rel.detalhe.push({ email: a.email, erro: String((e && e.message) || e).slice(0, 140) })
    }
  }

  rel.restantes = pendentes.length - lote.length
  rel.resumo = rel.enviados + ' e-mail(s), ' + rel.com_aviso_no_celular + ' aviso(s) no celular, ' +
    rel.falhas + ' falha(s), ' + rel.restantes + ' restante(s)'
  return Response.json(rel)
}
