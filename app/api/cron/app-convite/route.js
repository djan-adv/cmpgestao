// Robô que COBRA o cliente a entrar no aplicativo — a cada 2 dias ÚTEIS, até
// a pessoa entrar de verdade (primeiro login) ou o escritório mandar parar.
//
//   GET /api/cron/app-convite              → cobra quem está vencido
//   GET /api/cron/app-convite?limite=5     → limita o lote desta rodada
//   GET /api/cron/app-convite?forcar=1     → ignora dia útil/horário (teste)
//
// De onde vem a fila (portal_convites):
//   • do e-mail comum: todo e-mail de cliente confere o acesso e, se faltar,
//     já convida e abre a linha aqui (enviar-email/enviar.js);
//   • da semeadura desta rotina: quem recebeu senha pelo botão "Dar acesso ao
//     app" e nunca entrou entra na fila mesmo sem ter recebido outro e-mail.
//
// Para de cobrar quando: a pessoa logou (portal/route.js encerra a linha), o
// acesso foi revogado/bloqueado, ou já foram 5 cobranças — insistir além disso
// deixa de ser lembrete e vira incômodo; aí o assunto volta para a mão humana.

import { createClient } from '@supabase/supabase-js'
import { enviarEmailCore } from '../../enviar-email/enviar.js'
import { estadoConvite, ehDiaUtil, diasUteisEntre, URL_PORTAL } from '../../portal/convite-lib.js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0
export const maxDuration = 60

const LOTE = 8
const INTERVALO_DIAS_UTEIS = 2
const MAX_COBRANCAS = 5

// janela educada: nada sai antes das 9h nem depois das 18h de Brasília
const HORA_INI = 9
const HORA_FIM = 18

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}

function horaBrasilia(d) { return new Date(d.getTime() - 3 * 3600000).getUTCHours() }

function corpoCobranca({ nome, email, situacao, faltaTelefone, numero, envios }) {
  const primeiro = String(nome || '').trim().split(/\s+/)[0] || ''
  const ola = primeiro ? ('Olá, ' + primeiro + '!') : 'Olá!'
  const proc = numero
    ? ('\n\nProcesso: ' + numero.replace(/^(\d{7})(\d{2})(\d{4})(\d)(\d{2})(\d{4})$/, '$1-$2.$3.$4.$5.$6'))
    : ''
  const miolo = situacao === 'parado'
    ? 'Passando para lembrar que o seu acesso ao aplicativo do escritório já está liberado, '
      + 'mas ainda não foi usado nenhuma vez.\n\n'
      + 'No aplicativo você acompanha o andamento do processo em tempo real, recebe os avisos de audiência '
      + 'e fala direto com o escritório — sem precisar ligar ou esperar retorno.\n\n'
      + 'Endereço: ' + URL_PORTAL + '\n'
      + 'Login: ' + email + '\n'
      + 'Senha: a que enviamos no e-mail de acesso. Se não achar ou não funcionar, é só responder esta '
      + 'mensagem que enviamos outra na hora.'
    : 'Passando para lembrar que temos um aplicativo em que você acompanha o seu processo de perto: '
      + 'andamento atualizado, avisos de audiência e conversa direta com o escritório.\n\n'
      + 'Ainda não identificamos um acesso em seu nome. Para liberar, basta responder esta mensagem '
      + 'com um "quero o acesso" — enviamos a senha em seguida.\n\n'
      + 'Endereço: ' + URL_PORTAL
  const tel = faltaTelefone
    ? '\n\nAproveitando: o seu telefone/WhatsApp ainda não consta no nosso cadastro. '
      + 'Responda este e-mail com o número (com DDD) que registramos na sua ficha — '
      + 'é por ele que avisamos de audiência com antecedência.'
    : ''
  const fecho = envios >= MAX_COBRANCAS - 1
    ? '\n\nEste é o último lembrete automático sobre o aplicativo — não queremos incomodar. '
      + 'Quando quiser o acesso, é só pedir a qualquer momento.'
    : '\n\nSe preferir acompanhar só por e-mail mesmo, é só nos dizer que paramos os lembretes.'
  return ola + '\n\n' + miolo + proc + tel + fecho + '\n\nAtenciosamente,\nCrispim Mendonça e Pinheiro Advogados'
}

export async function GET(request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ erro: 'falta service key' }, { status: 500 })
  const { searchParams } = new URL(request.url)
  const forcar = !!searchParams.get('forcar')
  const limite = Math.max(1, Math.min(LOTE, parseInt(searchParams.get('limite') || String(LOTE), 10) || LOTE))
  const sb = admin()
  const agora = new Date()

  if (!forcar) {
    if (!ehDiaUtil(agora)) return Response.json({ ok: true, enviados: 0, silencio: true, motivo: 'fim de semana/feriado' })
    const h = horaBrasilia(agora)
    if (h < HORA_INI || h >= HORA_FIM) return Response.json({ ok: true, enviados: 0, silencio: true, motivo: 'fora de 9h–18h' })
  }

  const rel = { ok: true, semeados: 0, enviados: 0, encerrados: 0, adiados: 0, falhas: 0, detalhe: [] }

  // ——— semeadura: quem ganhou senha e nunca entrou ———
  // Sem isto, um cliente que recebeu o acesso pelo botão e nunca mais recebeu
  // outro e-mail ficaria fora da cobrança para sempre.
  try {
    const { data: parados } = await sb.from('portal_acessos')
      .select('id,escritorio_id,contato_id,email,nome,senha_enviada_em')
      .eq('ativo', true).is('bloqueado_em', null).is('primeiro_login_em', null)
      .not('senha_enviada_em', 'is', null).limit(200)
    for (const a of (parados || [])) {
      const { data: ja } = await sb.from('portal_convites').select('id')
        .eq('escritorio_id', a.escritorio_id).eq('email', a.email).maybeSingle()
      if (ja) continue
      // ultimo_envio_em = quando a senha saiu: a 1ª cobrança cai 2 dias úteis depois
      const ins = await sb.from('portal_convites').insert({
        escritorio_id: a.escritorio_id, email: a.email, contato_id: a.contato_id,
        nome: a.nome || null, tem_acesso: true, envios: 1, ultimo_envio_em: a.senha_enviada_em,
      })
      if (!ins.error) rel.semeados++
    }
  } catch (e) { /* semeadura é acessória */ }

  // ——— fila de cobrança ———
  const { data: fila, error } = await sb.from('portal_convites')
    .select('id,escritorio_id,email,nome,processo_numero,envios,ultimo_envio_em,pediu_telefone')
    .is('concluido_em', null).order('ultimo_envio_em', { ascending: true, nullsFirst: true }).limit(60)
  if (error) return Response.json({ erro: error.message }, { status: 500 })

  for (const c of (fila || [])) {
    if (rel.enviados >= limite) break

    if (diasUteisEntre(c.ultimo_envio_em, agora) < INTERVALO_DIAS_UTEIS) { rel.adiados++; continue }
    if ((c.envios || 0) >= MAX_COBRANCAS) {
      await sb.from('portal_convites').update({ concluido_em: agora.toISOString(), concluido_motivo: 'limite' }).eq('id', c.id)
      rel.encerrados++
      continue
    }

    // reconfere na hora: pode ter entrado, ter sido revogado ou o telefone já ter chegado
    const est = await estadoConvite(sb, { email: c.email, numero: c.processo_numero })
    if (est.situacao === 'usa' || est.situacao === 'bloqueado') {
      await sb.from('portal_convites').update({
        concluido_em: agora.toISOString(),
        concluido_motivo: est.situacao === 'usa' ? 'logou' : 'revogado',
      }).eq('id', c.id)
      rel.encerrados++
      continue
    }

    const env = await enviarEmailCore({
      para: c.email,
      assunto: est.situacao === 'parado'
        ? 'Seu acesso ao aplicativo do escritório está esperando por você'
        : 'Acompanhe seu processo pelo aplicativo — CMP Advogados',
      corpo: corpoCobranca({
        nome: est.nome || c.nome, email: c.email, situacao: est.situacao,
        faltaTelefone: est.falta_telefone, numero: c.processo_numero, envios: c.envios || 0,
      }),
      numero: c.processo_numero || '',
      // dedup: false porque a cobrança é a MESMA mensagem de propósito; quem
      // segura a repetição aqui é o intervalo de 2 dias úteis, não o hash.
      // convidarApp: false porque este e-mail já é o convite.
      dedup: false, convidarApp: false,
    })
    if (env.erro) {
      rel.falhas++
      rel.detalhe.push({ email: c.email, erro: String(env.erro).slice(0, 120) })
      continue
    }
    await sb.from('portal_convites').update({
      envios: (c.envios || 0) + 1, ultimo_envio_em: agora.toISOString(),
      tem_acesso: est.situacao === 'parado',
      pediu_telefone: c.pediu_telefone || !!est.falta_telefone,
    }).eq('id', c.id)
    rel.enviados++
    rel.detalhe.push({ email: c.email, situacao: est.situacao, cobranca: (c.envios || 0) + 1 })
  }

  return Response.json(rel)
}
