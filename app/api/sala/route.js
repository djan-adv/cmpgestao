// Sala de reunião por vídeo com o cliente.
//
// O cliente entra por um link e não tem login: quem autoriza é o TOKEN da sala,
// conferido aqui no servidor. Por isso o navegador nunca fala direto com as
// tabelas (RLS ligada, sem política) — tudo passa por esta rota.
//
// Áudio e vídeo não passam por aqui: vão direto de um navegador ao outro
// (WebRTC). O que esta rota guarda é a TRANSCRIÇÃO em texto, que cada aparelho
// produz do próprio microfone. O escritório fica com o registro do que foi
// combinado, sem armazenar a gravação da conversa.
//
//   POST /api/sala { acao: 'criar', titulo, cliente_nome, processo_numero }   (exige login)
//   POST /api/sala { acao: 'entrar', token }                                   (público)
//   POST /api/sala { acao: 'fala', token, quem, lado, texto }                  (público)
//   POST /api/sala { acao: 'encerrar', token }                                 (público — quem estiver na sala)
//   GET  /api/sala?token=...&transcricao=1                                     (exige login)

import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const URL_SB = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY

function admin() {
  return createClient(URL_SB, SERVICE, { auth: { persistSession: false } })
}
async function usuario(request) {
  const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const anon = createClient(URL_SB, ANON)
  const u = await anon.auth.getUser(jwt)
  const user = (u && u.data && u.data.user) || null
  if (!user) return null
  const sb = admin()
  const { data } = await sb.from('usuarios').select('id,nome,email,escritorio_id').eq('id', user.id).maybeSingle()
  return data || null
}
// token curto o bastante para caber num WhatsApp e longo o bastante para não
// ser adivinhado (22 caracteres do uuid, sem hífens)
function novoToken() {
  return randomUUID().replace(/-/g, '').slice(0, 22)
}

export async function POST(request) {
  if (!SERVICE) return Response.json({ erro: 'servidor sem chave de serviço' }, { status: 500 })
  let body = {}
  try { body = await request.json() } catch (e) {}
  const acao = String(body.acao || '')
  const sb = admin()

  try {
    if (acao === 'criar') {
      const quem = await usuario(request)
      if (!quem) return Response.json({ erro: 'Faça login no sistema.' }, { status: 401 })
      const token = novoToken()
      const { data, error } = await sb.from('salas_reuniao').insert({
        escritorio_id: quem.escritorio_id || null,
        token,
        titulo: String(body.titulo || '').trim() || 'Reunião com o escritório',
        cliente_nome: String(body.cliente_nome || '').trim() || null,
        processo_numero: String(body.processo_numero || '').trim() || null,
        criada_por: quem.nome || quem.email || null,
      }).select('id,token,titulo').single()
      if (error) throw new Error(error.message)
      return Response.json({ ok: true, token: data.token, titulo: data.titulo })
    }

    const token = String(body.token || '').trim()
    if (!token) return Response.json({ erro: 'sala não informada' }, { status: 400 })
    const { data: sala } = await sb.from('salas_reuniao')
      .select('id,titulo,cliente_nome,processo_numero,criada_por,encerrada_em').eq('token', token).maybeSingle()
    if (!sala) return Response.json({ erro: 'Sala não encontrada. Confira o link.' }, { status: 404 })

    if (acao === 'entrar') {
      if (sala.encerrada_em) return Response.json({ erro: 'Esta reunião já foi encerrada.' }, { status: 410 })
      // marca o início na primeira entrada — serve de registro de quando
      // aconteceu, sem depender de ninguém apertar "começar"
      if (!body.somenteLer) {
        try { await sb.from('salas_reuniao').update({ iniciada_em: new Date().toISOString() }).eq('id', sala.id).is('iniciada_em', null) } catch (e) {}
      }
      return Response.json({ ok: true, titulo: sala.titulo, cliente_nome: sala.cliente_nome, escritorio: sala.criada_por })
    }

    if (acao === 'fala') {
      const texto = String(body.texto || '').trim()
      if (!texto) return Response.json({ ok: true, vazio: true })
      const { error } = await sb.from('reuniao_falas').insert({
        sala_id: sala.id,
        quem: String(body.quem || '').trim().slice(0, 80) || 'participante',
        lado: body.lado === 'cliente' ? 'cliente' : 'escritorio',
        texto: texto.slice(0, 2000),
      })
      if (error) throw new Error(error.message)
      return Response.json({ ok: true })
    }

    if (acao === 'encerrar') {
      const { data: falas } = await sb.from('reuniao_falas').select('quem,lado,texto,em').eq('sala_id', sala.id).order('id')
      const linhas = (falas || []).map(f => f.quem + ': ' + f.texto)
      const transcricao = linhas.join('\n')
      await sb.from('salas_reuniao').update({ encerrada_em: new Date().toISOString() }).eq('id', sala.id)

      // a transcrição vira andamento no processo, quando a sala nasceu de um
      // (é ali que ela vai ser procurada depois, não numa tela de reuniões)
      let noHistorico = false
      if (sala.processo_numero && linhas.length) {
        try {
          const dig = String(sala.processo_numero).replace(/\D/g, '')
          const { data: p } = await sb.from('processos').select('id').eq('numero_digitos', dig).limit(1)
          if (p && p[0]) {
            await sb.from('andamentos').insert({
              processo_id: p[0].id,
              data: new Date().toISOString().slice(0, 10),
              fonte: 'manual',
              texto: '[Reunião por vídeo — ' + (sala.titulo || 'com o cliente') + ']\n\n' + transcricao,
            })
            noHistorico = true
          }
        } catch (e) { /* a transcrição já está salva na sala; o histórico é conveniência */ }
      }
      return Response.json({ ok: true, falas: linhas.length, no_historico: noHistorico })
    }

    return Response.json({ erro: 'ação desconhecida' }, { status: 400 })
  } catch (e) {
    return Response.json({ erro: String((e && e.message) || e) }, { status: 500 })
  }
}

export async function GET(request) {
  if (!SERVICE) return Response.json({ erro: 'servidor sem chave de serviço' }, { status: 500 })
  const quem = await usuario(request)
  if (!quem) return Response.json({ erro: 'Faça login no sistema.' }, { status: 401 })
  const { searchParams } = new URL(request.url)
  const token = String(searchParams.get('token') || '').trim()
  const sb = admin()
  if (token) {
    const { data: sala } = await sb.from('salas_reuniao').select('*').eq('token', token).maybeSingle()
    if (!sala) return Response.json({ erro: 'sala não encontrada' }, { status: 404 })
    const { data: falas } = await sb.from('reuniao_falas').select('quem,lado,texto,em').eq('sala_id', sala.id).order('id')
    return Response.json({ ok: true, sala, falas: falas || [] })
  }
  const { data } = await sb.from('salas_reuniao').select('token,titulo,cliente_nome,processo_numero,criada_em,iniciada_em,encerrada_em')
    .eq('escritorio_id', quem.escritorio_id).order('criada_em', { ascending: false }).limit(30)
  return Response.json({ ok: true, salas: data || [] })
}
