// Robô que PLANEJA os avisos de audiência no app do cliente.
//
//   GET /api/cron/audiencias           → enfileira o que faltar
//   GET /api/cron/audiencias?dias=15   → olha mais longe (padrão: 10 dias)
//   GET /api/cron/audiencias?debug=1   → detalha cada audiência vista
//
// Antes, os avisos saíam de duas varreduras no NAVEGADOR (varreAudienciasAuto e
// varreAvisosVespera, na carga do sistema). Quem não abrisse o sistema no dia
// certo simplesmente não avisava o cliente — audiência às 9h de segunda dependia
// de alguém ter aberto a tela no domingo. Agora é robô.
//
// Ele só ENFILEIRA (avisos_app_fila) com hora marcada; quem dispara é o
// /api/cron/avisos-app, que roda curto. É essa separação que permite avisar 30 e
// 10 minutos antes mesmo com este robô rodando de hora em hora.

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0
export const maxDuration = 120

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}

// O Brasil não tem mais horário de verão desde 2019, então o fuso é fixo. Sem
// isto os avisos sairiam 3 horas fora — o de 10 minutos antes chegaria depois da
// audiência ter começado.
const BR = '-03:00'

// Silêncio noturno: nada sai para o cliente antes das 06:00 nem depois das 18:30.
export const JANELA_INI = 6 * 60          // 06:00
export const JANELA_FIM = 18 * 60 + 30    // 18:30
// minutos desde a meia-noite, no horário de Brasília
function minutosBR(d) {
  const local = new Date(d.getTime() - 3 * 3600000)
  return local.getUTCHours() * 60 + local.getUTCMinutes()
}
function dentroDaJanela(d) {
  const m = minutosBR(d)
  return m >= JANELA_INI && m <= JANELA_FIM
}
// Empurra para as 06:00 do próximo dia permitido. Só faz sentido para aviso que
// continua útil depois (véspera); o de 30/10 minutos, atrasado, não serve.
function proximaJanela(d) {
  const local = new Date(d.getTime() - 3 * 3600000)
  const m = local.getUTCHours() * 60 + local.getUTCMinutes()
  if (m < JANELA_INI) local.setUTCHours(6, 0, 0, 0)
  else { local.setUTCDate(local.getUTCDate() + 1); local.setUTCHours(6, 0, 0, 0) }
  return new Date(local.getTime() + 3 * 3600000)
}
function instante(dataISO, hora) {
  const h = /^\d{1,2}:\d{2}/.test(String(hora || '')) ? String(hora).slice(0, 5) : '09:00'
  const d = new Date(`${dataISO}T${h.padStart(5, '0')}:00${BR}`)
  return isNaN(d.getTime()) ? null : d
}
function iso(d) { return d.toISOString() }
function brData(s) { return String(s).split('-').reverse().join('/') }
// 11 processos estão gravados com o número sem pontuação. Na tela o fmtCNJ
// disfarça, mas o aviso vai para o CLIENTE — e "08264547920268150001" não é
// número de processo para ninguém.
function fmtCNJ(n) {
  const d = String(n == null ? '' : n).replace(/\D/g, '')
  if (d.length !== 20) return String(n == null ? '' : n)
  return d.slice(0, 7) + '-' + d.slice(7, 9) + '.' + d.slice(9, 13) + '.' + d.slice(13, 14) + '.' + d.slice(14, 16) + '.' + d.slice(16)
}

// Link da sala virtual, procurado no histórico do processo. A mesma ideia do
// _achaLinkAudiencia da tela, mas aqui no servidor: o aviso de 10 minutos antes
// só serve se levar o link junto.
const PROVEDORES = /(zoom\.us|meet\.google|teams\.microsoft|teams\.live|webex|whereby|jitsi|gov\.br|jus\.br|cisco)/i
function achaLink(textos) {
  for (const t of textos) {
    const txt = String(t || '')
    if (!/audi[êe]ncia|videoconfer|sala virtual|telepresen|link/i.test(txt)) continue
    const m = txt.match(/https?:\/\/[^\s<>"')]+/g)
    if (!m) continue
    for (const u of m) {
      const url = u.replace(/[.,;)]+$/, '')
      if (PROVEDORES.test(url)) return url
    }
  }
  return null
}

export async function GET(request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ erro: 'falta service key' }, { status: 500 })
  const { searchParams } = new URL(request.url)
  const dias = Math.max(1, Math.min(60, parseInt(searchParams.get('dias') || '10', 10) || 10))
  const debug = !!searchParams.get('debug')
  const sb = admin()

  const hoje = new Date()
  const ini = new Date(hoje.getTime() - 86400000)   // ontem, para pegar audiência de hoje cedo
  const fim = new Date(hoje.getTime() + dias * 86400000)
  const dISO = (d) => d.toISOString().slice(0, 10)

  const ag = await sb.from('agenda_eventos')
    .select('id,escritorio_id,data,hora,tipo,titulo,processo_numero')
    .gte('data', dISO(ini)).lte('data', dISO(fim))
    .order('data', { ascending: true }).limit(500)
  if (ag.error) return Response.json({ erro: ag.error.message }, { status: 500 })

  const audiencias = (ag.data || []).filter(e =>
    e && e.processo_numero && (e.tipo === 'az' || /audi[êe]ncia/i.test(e.titulo || '')))

  const rel = { ok: true, audiencias: audiencias.length, enfileirados: 0, jaTinha: 0, semProcesso: 0, passou: 0, erros: 0, detalhe: [] }
  const agora = Date.now()

  for (const e of audiencias) {
    const quando = instante(e.data, e.hora)
    if (!quando) { rel.erros++; continue }

    const dig = String(e.processo_numero || '').replace(/\D/g, '')
    // o processo é procurado DENTRO do escritório dono do compromisso: número de
    // processo se repete entre tribunais, e sem isto a audiência de um
    // escritório avisaria o cliente de outro (ou o maybeSingle quebraria)
    const pr = await sb.from('processos').select('id,numero,cliente_nome,escritorio_id,audiencia_link')
      .eq('escritorio_id', e.escritorio_id).eq('numero_digitos', dig).maybeSingle()
    const p = pr && pr.data
    if (!p) { rel.semProcesso++; if (debug) rel.detalhe.push({ numero: e.processo_numero, erro: 'processo não cadastrado' }); continue }

    // 18/08/2026: o link automático (achaLink no histórico) errava — agora só o
    // campo MANUAL da ficha vale, e ele aparece no app apenas no dia. O push de
    // 10 min leva o link SÓ se foi inserido à mão; senão aponta pro app.
    const link = /^https?:\/\//i.test(String(p.audiencia_link || '')) ? String(p.audiencia_link) : null
    const t10 = new Date(quando.getTime() - 10 * 60000)

    // tarefa-alerta na VÉSPERA (Kanban): conferir/atualizar o link na ficha.
    // Dedup por processo+data da audiência — remarcou, nasce outra.
    try {
      const vespISO = new Date(quando.getTime() - 86400000).toISOString().slice(0, 10)
      const jaT = await sb.from('kanban_tarefas').select('id').eq('numero', p.numero).eq('origem', 'robo_aud_link').eq('prazo', e.data).limit(1)
      if (!jaT.data || !jaT.data.length) {
        await sb.from('kanban_tarefas').insert({
          escritorio_id: p.escritorio_id || e.escritorio_id,
          titulo: 'Conferir/atualizar o LINK da audiência de ' + brData(e.data) + ((e.hora && e.hora !== 'Dia todo') ? (' às ' + String(e.hora).slice(0, 5)) : '') + ' na ficha',
          cliente: p.cliente_nome || '—', numero: p.numero, coluna: 'distribuir',
          data: vespISO, prazo: e.data, tipo: 'tarefa', origem: 'robo_aud_link',
          descricao: 'Cole o link da sala (Meet/Zoom/Teams/balcão) no campo "🔗 Link da audiência" da ficha do processo — é ele que o cliente vê no app, só no dia. Inserção manual, com registro de quem inseriu. Há uma sugestão achada no histórico na própria ficha, para conferir.',
        })
      }
    } catch (eT) {}

    const hTxt = (e.hora && e.hora !== 'Dia todo') ? (' às ' + String(e.hora).slice(0, 5)) : ''
    const numTxt = fmtCNJ(p.numero)
    const base = { escritorio_id: p.escritorio_id || e.escritorio_id, processo_id: p.id, processo_numero: p.numero, data_audiencia: e.data, hora_audiencia: e.hora || null, url: '/portal.html?proc=' + p.id }

    // Véspera às 9h da manhã do dia anterior: cedo o bastante para o cliente se
    // organizar, tarde o bastante para não acordar ninguém.
    const vesp = new Date(quando.getTime())
    vesp.setUTCDate(vesp.getUTCDate() - 1)
    const vespera = instante(dISO(new Date(vesp.getTime())), '09:00')

    const etapas = [
      { etapa: 'vespera', quando: vespera, titulo: 'Sua audiência é amanhã', corpo: 'Processo ' + numTxt + ' — ' + brData(e.data) + hTxt + '. Qualquer dúvida, fale com o escritório pelo app.' },
      { etapa: 't30', quando: new Date(quando.getTime() - 30 * 60000), titulo: 'Sua audiência é em 30 minutos', corpo: 'Processo ' + numTxt + hTxt + '. Prepare-se: documento com foto em mãos e um lugar silencioso.' },
      { etapa: 't10', quando: t10, titulo: 'Sua audiência começa em 10 minutos', corpo: link ? ('Toque aqui para entrar na sala. Processo ' + numTxt + hTxt + '.') : ('Processo ' + numTxt + hTxt + '. Se for por videoconferência, use o link que a vara enviou.') },
    ]

    for (const et of etapas) {
      if (!et.quando) continue
      let quandoEnviar = et.quando
      // Silêncio noturno. A véspera é lembrete e pode esperar: vai para as 06:00
      // do próximo dia permitido. Os de 30 e 10 minutos estão amarrados à hora da
      // audiência — adiar não faz sentido e mandar fora de hora, também. Então
      // esses simplesmente não saem (audiência às 5h ou às 20h não existe na
      // prática; se existir, o aviso por e-mail continua valendo).
      if (!dentroDaJanela(quandoEnviar)) {
        if (et.etapa === 'vespera') quandoEnviar = proximaJanela(quandoEnviar)
        else { rel.foraDaJanela = (rel.foraDaJanela || 0) + 1; continue }
      }
      // já passou da hora: não enfileira. Aviso atrasado é pior que aviso nenhum —
      // o cliente receberia "sua audiência é em 30 minutos" depois dela acabar.
      if (quandoEnviar.getTime() <= agora) { rel.passou++; continue }
      const linha = Object.assign({}, base, {
        etapa: et.etapa, enviar_em: iso(quandoEnviar), titulo: et.titulo, corpo: et.corpo,
        url: (et.etapa === 't10' && link) ? link : base.url,
      })
      const ins = await sb.from('avisos_app_fila').insert(linha)
      if (ins.error) {
        // 23505 = já enfileirado numa rodada anterior; é o caso normal
        if (String(ins.error.code) === '23505' || /duplicate key/i.test(ins.error.message || '')) rel.jaTinha++
        else { rel.erros++; if (debug) rel.detalhe.push({ numero: p.numero, etapa: et.etapa, erro: ins.error.message }) }
      } else {
        rel.enfileirados++
        if (debug) rel.detalhe.push({ numero: p.numero, etapa: et.etapa, enviar_em: iso(quandoEnviar), adiado: quandoEnviar.getTime() !== et.quando.getTime(), comLink: !!(et.etapa === 't10' && link) })
      }
    }
  }

  return Response.json(rel)
}
