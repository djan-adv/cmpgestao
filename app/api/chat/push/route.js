// Notificação push do Chat da equipe — o "alarme" no celular mesmo com o app
// fechado. Funciona no /chat instalado na tela de início (Android sempre;
// iPhone a partir do iOS 16.4, desde que adicionado à tela de início).
//
//   GET  /api/chat/push                -> devolve a chave pública VAPID (para subscribe)
//   POST /api/chat/push {acao:'subscribe',   subscription}      -> grava a inscrição deste aparelho
//   POST /api/chat/push {acao:'unsubscribe', endpoint}          -> remove a inscrição
//   POST /api/chat/push {acao:'notificar', autor_id, autor_nome, texto, para_id}
//        -> dispara o alarme para quem deve receber (chamado pelo cliente logo após enviar)

import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function svc() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}
function sbUser(request) {
  const auth = request.headers.get('authorization') || ''
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false }, global: { headers: { Authorization: auth } },
  })
}
async function usuario(request) {
  const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const u = await sb.auth.getUser(jwt)
  return (u && u.data && u.data.user) || null
}
// ——— Férias ———
// Quem está de férias não recebe chat: nem privado, nem do grupo. O período é
// registrado na tela de Acessos e mora em produtividade_config → 'assentos'
// (mesma fonte que a tela usa), casado com a conta por e-mail e, na falta dele,
// pelo nome. Falhando a leitura, o filtro devolve vazio: ninguém deixa de
// receber mensagem por causa de um erro de infraestrutura.
function _hojeBR() {
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10)
}
function _norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
}
// Lê os assentos e devolve os dois conjuntos que interessam ao push: quem está
// de férias (não recebe nada) e quem está fora do grupo (só recebe privado).
async function _assentos(admin, escritorioId) {
  try {
    const { data: cfg } = await admin.from('produtividade_config').select('valor')
      .eq('escritorio_id', escritorioId).eq('chave', 'assentos').maybeSingle()
    if (!cfg || !cfg.valor) return []
    const arr = JSON.parse(cfg.valor)
    return Array.isArray(arr) ? arr : []
  } catch (e) { return [] }
}
async function _contasPorAssento(admin, escritorioId, assentos) {
  const ids = new Set()
  if (!assentos.length) return ids
  const emails = new Set(assentos.map(a => String(a.email || '').toLowerCase()).filter(Boolean))
  const nomes = new Set(assentos.map(a => _norm(a.nome)).filter(Boolean))
  const { data: contas } = await admin.from('usuarios').select('id,nome,email').eq('escritorio_id', escritorioId)
  ;(contas || []).forEach(c => {
    if (emails.has(String(c.email || '').toLowerCase()) || nomes.has(_norm(c.nome))) ids.add(c.id)
  })
  return ids
}
// Fora do grupo: mensagem sem destinatário (o "Todos") não chega para essas
// pessoas. As privadas continuam chegando normalmente.
//
// A fonte é a coluna usuarios.so_privado — a MESMA que a política de leitura do
// chat consulta. Ter duas fontes (aqui o JSON de assentos, lá a coluna) abriria
// espaço para a pessoa parar de receber o alarme mas continuar lendo a conversa,
// que foi o problema encontrado.
async function idsSoPrivado(admin, escritorioId) {
  try {
    const { data } = await admin.from('usuarios').select('id,so_privado').eq('escritorio_id', escritorioId)
    const fora = new Set()
    ;(data || []).forEach(u => { if (u && u.so_privado) fora.add(u.id) })
    return fora
  } catch (e) { return new Set() }
}
async function idsEmFerias(admin, escritorioId) {
  const fora = new Set()
  try {
    const { data: cfg } = await admin.from('produtividade_config').select('valor')
      .eq('escritorio_id', escritorioId).eq('chave', 'assentos').maybeSingle()
    if (!cfg || !cfg.valor) return fora
    const assentos = JSON.parse(cfg.valor)
    if (!Array.isArray(assentos)) return fora
    const hoje = _hojeBR()
    const emFerias = assentos.filter(a => {
      const f = a && a.ferias
      return f && f.fim && (!f.ini || hoje >= f.ini) && hoje <= f.fim
    })
    if (!emFerias.length) return fora
    const emails = new Set(emFerias.map(a => String(a.email || '').toLowerCase()).filter(Boolean))
    const nomes = new Set(emFerias.map(a => _norm(a.nome)).filter(Boolean))
    const { data: contas } = await admin.from('usuarios').select('id,nome,email').eq('escritorio_id', escritorioId)
    ;(contas || []).forEach(c => {
      if (emails.has(String(c.email || '').toLowerCase()) || nomes.has(_norm(c.nome))) fora.add(c.id)
    })
  } catch (e) { /* nunca bloqueia o envio */ }
  return fora
}
async function vapid() {
  const { data } = await svc().from('app_secrets').select('valor').eq('chave', 'vapid_chat').maybeSingle()
  return data && data.valor
}

export async function GET() {
  const v = await vapid()
  if (!v) return Response.json({ erro: 'push não configurado no servidor' }, { status: 501 })
  return Response.json({ ok: true, publicKey: v.public })
}

export async function POST(request) {
  const user = await usuario(request)
  if (!user) return Response.json({ erro: 'Faça login.' }, { status: 401 })
  let body = {}
  try { body = await request.json() } catch (e) {}

  if (body.acao === 'subscribe') {
    const s = body.subscription
    if (!s || !s.endpoint || !s.keys) return Response.json({ erro: 'inscrição inválida' }, { status: 400 })
    const db = sbUser(request)
    const r = await db.from('chat_push_subs').upsert({
      user_id: user.id, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth_key: s.keys.auth,
    }, { onConflict: 'endpoint' })
    if (r.error) return Response.json({ erro: r.error.message }, { status: 500 })
    return Response.json({ ok: true })
  }

  if (body.acao === 'unsubscribe') {
    const db = sbUser(request)
    await db.from('chat_push_subs').delete().eq('endpoint', String(body.endpoint || ''))
    return Response.json({ ok: true })
  }

  // Teste do alarme: dispara o push para os aparelhos de QUEM PEDIU — é o único
  // jeito de conferir o caminho inteiro (servidor → Apple/Google → aparelho)
  // sem depender de outra pessoa mandar mensagem. A rota de 'notificar' exclui
  // o autor de propósito, por isso o teste é uma ação à parte.
  if (body.acao === 'testar') {
    const v = await vapid()
    if (!v) return Response.json({ erro: 'push não configurado no servidor' }, { status: 400 })
    webpush.setVapidDetails('mailto:contato@cmpadvogados.com.br', v.public, v.private)
    const admin = svc()
    const { data: subs } = await admin.from('chat_push_subs').select('*').eq('user_id', user.id)
    if (!subs || !subs.length) return Response.json({ ok: true, enviados: 0, motivo: 'nenhum aparelho seu com alarme ativo' })
    const payload = JSON.stringify({ titulo: '🔔 Teste do alarme', corpo: 'Funcionou! É assim que mensagens e chamadas vão chegar.', url: '/chat' })
    let enviados = 0
    const expirados = []
    await Promise.all(subs.map(async (s2) => {
      try { await webpush.sendNotification({ endpoint: s2.endpoint, keys: { p256dh: s2.p256dh, auth: s2.auth_key } }, payload); enviados++ }
      catch (e) { if (e && (e.statusCode === 404 || e.statusCode === 410)) expirados.push(s2.endpoint) }
    }))
    if (expirados.length) { try { await admin.from('chat_push_subs').delete().in('endpoint', expirados) } catch (e) {} }
    return Response.json({ ok: true, enviados })
  }

  if (body.acao === 'notificar') {
    if (body.autor_id !== user.id) return Response.json({ erro: 'autor não confere com a sessão' }, { status: 403 })
    const v = await vapid()
    if (!v) return Response.json({ ok: true, enviados: 0 }) // push não configurado — não trava o chat
    webpush.setVapidDetails('mailto:contato@cmpadvogados.com.br', v.public, v.private)

    // Quem recebe: só os OUTROS. Nada do que a pessoa escreve volta para ela.
    //
    // Isto REVERTE o commit 05cf422 ("alarme também nos outros aparelhos de quem
    // escreve"), que mandava a mensagem para o próprio autor em outro aparelho —
    // era útil para testar, mas na prática virou barulho: quem escreve no
    // computador recebia alarme no celular da própria frase. Pedido do dono:
    // alertar apenas mensagem de outra pessoa (colegas e clientes).
    //
    // origem_endpoint continua sendo descartado logo abaixo; agora é redundante
    // para o autor, mas segue valendo se um dia o próprio voltar a ser destino.
    const admin = svc()
    const { data: eu } = await admin.from('usuarios').select('escritorio_id').eq('id', user.id).single()
    const escritorioId = eu && eu.escritorio_id
    let destinatarios = []
    if (body.para_id) {
      destinatarios = [body.para_id]
    } else {
      const { data: todos } = await admin.from('usuarios').select('id').eq('escritorio_id', escritorioId)
      destinatarios = (todos || []).map(u => u.id)
    }
    // A regra do autor fica DEPOIS dos dois ramos, no único ponto por onde todos
    // os caminhos passam (chat da equipe no sistema, app /chat, e o que vier
    // depois) — assim um caminho novo não tem como esquecer dela. Antes o filtro
    // existia só no broadcast, e o envio privado ia direto.
    //
    // Filtrar por user_id e não por aparelho é o que importa: quem escreve no
    // computador não pode receber alarme em NENHUM aparelho seu.
    destinatarios = [...new Set(destinatarios.filter(id => id && id !== user.id))]
    // Férias entra no MESMO ponto único, pelo mesmo motivo: privado e grupo
    // passam os dois por aqui, então não há caminho que escape da regra.
    const deFerias = await idsEmFerias(admin, escritorioId)
    if (deFerias.size) destinatarios = destinatarios.filter(id => !deFerias.has(id))
    // Fora do grupo: só se aplica ao broadcast. Mensagem privada para essa
    // pessoa continua chegando — é justamente o canal que sobrou para ela.
    if (!body.para_id) {
      const soPriv = await idsSoPrivado(admin, escritorioId)
      if (soPriv.size) destinatarios = destinatarios.filter(id => !soPriv.has(id))
    }
    if (!destinatarios.length) return Response.json({ ok: true, enviados: 0, motivo: 'sem destinatário (autor, ou todos de férias)' })

    const origem = String(body.origem_endpoint || '')
    const { data: todasSubs } = await admin.from('chat_push_subs').select('*').in('user_id', destinatarios)
    const subs = (todasSubs || []).filter(s => s.endpoint !== origem)
    const ehChamada = !!body.chamada
    const titulo = body.para_id ? ('🔒 ' + (body.autor_nome || 'Colega')) : ('💬 ' + (body.autor_nome || 'Colega'))
    const payload = JSON.stringify({ titulo, corpo: String(body.texto || '').slice(0, 140), url: '/chat', tipo: ehChamada ? 'chamada' : 'mensagem' })
    // urgency alta pede pro provedor (FCM no Android; a Apple decide por conta
    // própria, não respeita o cabeçalho) entregar sem enfileirar. TTL curto na
    // chamada: se não entregar dentro da janela de toque, não faz sentido
    // aparecer depois — a ligação já acabou.
    const opcoes = { urgency: 'high', TTL: ehChamada ? 50 : 86400 }

    let enviados = 0, expirados = []
    await Promise.all((subs || []).map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } }, payload, opcoes)
        enviados++
      } catch (e) {
        if (e && (e.statusCode === 404 || e.statusCode === 410)) expirados.push(s.endpoint)
      }
    }))
    if (expirados.length) { try { await admin.from('chat_push_subs').delete().in('endpoint', expirados) } catch (e) {} }
    return Response.json({ ok: true, enviados })
  }

  return Response.json({ erro: 'ação desconhecida' }, { status: 400 })
}
