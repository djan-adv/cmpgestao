// API do Portal do Cliente — lado do ESCRITÓRIO (chamada pelo sistema.html).
// É aqui que vive o botão "Dar acesso ao app": cria o login do cliente, manda a
// senha por e-mail (motor SMTP do escritório) e informa o estado do botão
// (aguardando 1º login / logado / bloqueado). Exige usuário do escritório (JWT).
//
//   POST /api/portal/admin  (Authorization: Bearer <jwt do Supabase>)
//     {acao:'status',   processo_id}                    -> acessos deste processo + estado
//     {acao:'conceder', processo_id, nome, email, contato_id?} -> cria/vincula acesso + e-mail
//     {acao:'reenviar', acesso_id}                      -> nova senha + novo e-mail
//     {acao:'desbloquear', acesso_id}                   -> limpa bloqueio de aparelhos
//     {acao:'revogar',  acesso_id}                      -> desativa o login (derruba sessões)
//     {acao:'reativar', acesso_id}                      -> reativa o login
//     {acao:'notificar_cliente', processo_id, texto}    -> push no celular do cliente
//        (o sistema chama depois de responder no chat — o insert é direto no banco)

import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'
import { enviarEmailCore, URL_PUBLICA } from '../../enviar-email/enviar.js'
import { svc, hashSenha, gerarSenha, digitos } from '../lib.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function usuarioEscritorio(request) {
  const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const u = await anon.auth.getUser(jwt)
  const user = (u && u.data && u.data.user) || null
  if (!user) return null
  const { data } = await svc().from('usuarios').select('id,nome,email,escritorio_id,papel').eq('id', user.id).maybeSingle()
  if (!data || !data.escritorio_id) return null
  return data
}

/* estado do acesso, na ordem que importa para o botão */
function estadoDo(a) {
  if (!a.ativo) return 'revogado'
  if (a.bloqueado_em) return 'bloqueado'
  if (a.primeiro_login_em) return 'logado'
  if (a.senha_enviada_em) return 'enviado'
  return 'criado'
}

/* acessos que enxergam um processo: grant explícito OU contato do processo */
async function acessosDoProcesso(sb, p) {
  const { data: todos } = await sb.from('portal_acessos').select('*').eq('escritorio_id', p.escritorio_id).limit(1000)
  const { data: grants } = await sb.from('portal_acesso_processos').select('acesso_id').eq('processo_id', p.id)
  const setGrant = new Set((grants || []).map(g => g.acesso_id))
  const nomes = {}
  const contatoIds = (todos || []).map(a => a.contato_id).filter(Boolean)
  if (contatoIds.length) {
    const { data: cts } = await sb.from('contatos').select('id,nome').in('id', contatoIds)
    ;(cts || []).forEach(c => { nomes[c.id] = String(c.nome || '').trim().toLowerCase() })
  }
  const cliNome = String(p.cliente_nome || '').trim().toLowerCase()
  return (todos || []).filter(a =>
    setGrant.has(a.id) ||
    (a.contato_id && a.contato_id === p.cliente_id) ||
    (a.contato_id && cliNome && nomes[a.contato_id] === cliNome)
  )
}

async function statusDoProcesso(sb, p) {
  const acessos = await acessosDoProcesso(sb, p)
  const ids = acessos.map(a => a.id)
  const devs = {}
  if (ids.length) {
    const { data: d } = await sb.from('portal_dispositivos').select('acesso_id').in('acesso_id', ids)
    ;(d || []).forEach(x => { devs[x.acesso_id] = (devs[x.acesso_id] || 0) + 1 })
  }
  return acessos.map(a => ({
    id: a.id, nome: a.nome || '', email: a.email, estado: estadoDo(a),
    primeiro_login_em: a.primeiro_login_em, ultimo_login_em: a.ultimo_login_em,
    senha_enviada_em: a.senha_enviada_em, bloqueado_em: a.bloqueado_em,
    bloqueio_motivo: a.bloqueio_motivo, aparelhos: devs[a.id] || 0,
  }))
}

/* e-mail com as credenciais (sai pelo motor SMTP com o rodapé padrão do escritório) */
async function emailCredenciais({ nome, email, senha, numero, novoProcesso }) {
  const linhaSenha = senha
    ? ('LOGIN (seu e-mail): ' + email + '\nSENHA: ' + senha + '\n')
    : ('LOGIN (seu e-mail): ' + email + '\nSENHA: a mesma que você já usa no portal (se esqueceu, peça ao escritório uma nova).\n')
  const corpo =
    'Olá' + (nome ? ', ' + nome : '') + '!\n\n' +
    (novoProcesso
      ? 'Um novo processo foi liberado no seu acesso ao aplicativo do escritório.\n\n'
      : 'Seu acesso ao aplicativo do escritório está pronto!\n\n') +
    'Pelo aplicativo você acompanha seu processo em tempo real: as movimentações, os documentos oficiais (despachos, sentenças e acordos), as petições que protocolamos e o contato do cartório da Vara. E, se precisar falar com a gente sobre o processo, é só usar o chat de dentro do próprio processo.\n\n' +
    'ENDEREÇO: ' + URL_PUBLICA + '/portal.html\n' +
    linhaSenha + '\n' +
    'COMO COLOCAR NA TELA DO CELULAR (recomendado):\n' +
    '• Android: abra o endereço acima no Chrome e toque no botão "Instalar o aplicativo".\n' +
    '• iPhone: abra no Safari, toque em Compartilhar e depois em "Adicionar à Tela de Início".\n' +
    'Dentro do portal também há um botão que mostra o passo a passo certinho para o seu aparelho.\n\n' +
    'IMPORTANTE:\n' +
    '• O acesso é pessoal e protegido por senha — não compartilhe.\n' +
    '• Por segurança, o uso em muitos aparelhos diferentes bloqueia o acesso automaticamente.\n' +
    '• Qualquer dúvida, é só responder este e-mail.'
  return enviarEmailCore({
    para: email,
    assunto: 'Seu acesso ao aplicativo do escritório — CMP Advogados',
    corpo, numero: numero || '', dedup: false,
  })
}

export async function POST(request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ erro: 'Servidor sem SUPABASE_SERVICE_ROLE_KEY.' }, { status: 500 })
  }
  const quem = await usuarioEscritorio(request)
  if (!quem) return Response.json({ erro: 'Faça login no sistema.' }, { status: 401 })

  let body = {}
  try { body = await request.json() } catch (e) {}
  const acao = String(body.acao || '')
  const sb = svc()

  /* ---------- status do botão na ficha ---------- */
  if (acao === 'status') {
    const { data: p } = await sb.from('processos').select('id,numero,cliente_id,cliente_nome,escritorio_id')
      .eq('id', String(body.processo_id || '')).eq('escritorio_id', quem.escritorio_id).maybeSingle()
    if (!p) return Response.json({ erro: 'Processo não encontrado.' }, { status: 404 })
    return Response.json({ ok: true, acessos: await statusDoProcesso(sb, p) })
  }

  /* ---------- dar acesso (o botão) ---------- */
  if (acao === 'conceder') {
    const { data: p } = await sb.from('processos').select('id,numero,cliente_id,cliente_nome,escritorio_id')
      .eq('id', String(body.processo_id || '')).eq('escritorio_id', quem.escritorio_id).maybeSingle()
    if (!p) return Response.json({ erro: 'Processo não encontrado.' }, { status: 404 })
    const email = String(body.email || '').trim().toLowerCase()
    const nome = String(body.nome || '').replace(/\s+/g, ' ').trim()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return Response.json({ erro: 'E-mail inválido.' }, { status: 400 })
    if (!nome || nome.length < 3) return Response.json({ erro: 'Informe o nome do cliente.' }, { status: 400 })

    // vincula ao contato quando for o cliente principal do processo
    let contatoId = String(body.contato_id || '') || null
    if (!contatoId && p.cliente_id && p.cliente_nome &&
        nome.toLowerCase() === String(p.cliente_nome).trim().toLowerCase()) {
      contatoId = p.cliente_id
    }
    // guarda o e-mail no cadastro do contato se lá estiver vazio (ajuda o escritório)
    if (contatoId) {
      try {
        const { data: c } = await sb.from('contatos').select('id,email').eq('id', contatoId).maybeSingle()
        if (c && !String(c.email || '').trim()) await sb.from('contatos').update({ email }).eq('id', contatoId)
      } catch (e) {}
    }

    const { data: existente } = await sb.from('portal_acessos').select('*').eq('email', email).maybeSingle()
    let acessoId, senha = null, criado = false
    if (existente) {
      if (existente.escritorio_id !== quem.escritorio_id) {
        return Response.json({ erro: 'Este e-mail já está em uso em outro escritório.' }, { status: 409 })
      }
      acessoId = existente.id
      const upd = { senha_enviada_em: new Date().toISOString() }
      if (!existente.nome && nome) upd.nome = nome
      if (!existente.contato_id && contatoId) upd.contato_id = contatoId
      if (!existente.ativo) upd.ativo = true
      await sb.from('portal_acessos').update(upd).eq('id', acessoId)
    } else {
      criado = true
      senha = gerarSenha()
      const ins = await sb.from('portal_acessos').insert({
        escritorio_id: quem.escritorio_id, contato_id: contatoId, nome, email,
        senha_hash: hashSenha(senha), criado_por: quem.nome || quem.email,
        senha_enviada_em: new Date().toISOString(),
      }).select('id').single()
      if (ins.error) return Response.json({ erro: ins.error.message }, { status: 500 })
      acessoId = ins.data.id
    }
    // grant explícito deste processo (vale para o 2º autor sem cadastro)
    await sb.from('portal_acesso_processos').upsert({ acesso_id: acessoId, processo_id: p.id }, { onConflict: 'acesso_id,processo_id' })

    const env = await emailCredenciais({ nome, email, senha, numero: digitos(p.numero), novoProcesso: !criado })
    if (env && env.erro) {
      return Response.json({
        ok: true, aviso: 'Acesso criado, mas o e-mail NÃO saiu: ' + env.erro +
          (senha ? (' — anote e repasse a senha ao cliente: ' + senha) : ''),
        acessos: await statusDoProcesso(sb, p),
      })
    }
    return Response.json({ ok: true, criado, acessos: await statusDoProcesso(sb, p) })
  }

  /* ---------- ações sobre um acesso existente ---------- */
  const acessoId = String(body.acesso_id || '')
  if (['reenviar', 'desbloquear', 'revogar', 'reativar'].includes(acao)) {
    const { data: a } = await sb.from('portal_acessos').select('*').eq('id', acessoId).eq('escritorio_id', quem.escritorio_id).maybeSingle()
    if (!a) return Response.json({ erro: 'Acesso não encontrado.' }, { status: 404 })

    if (acao === 'reenviar') {
      const senha = gerarSenha()
      await sb.from('portal_acessos').update({ senha_hash: hashSenha(senha), senha_enviada_em: new Date().toISOString(), ativo: true }).eq('id', a.id)
      await sb.from('portal_sessoes').delete().eq('acesso_id', a.id)   // senha nova derruba sessão antiga
      const env = await emailCredenciais({ nome: a.nome, email: a.email, senha, numero: '', novoProcesso: false })
      if (env && env.erro) return Response.json({ ok: true, aviso: 'Senha trocada, mas o e-mail NÃO saiu: ' + env.erro + ' — repasse ao cliente: ' + senha })
      return Response.json({ ok: true })
    }
    if (acao === 'desbloquear') {
      await sb.from('portal_dispositivos').delete().eq('acesso_id', a.id)
      await sb.from('portal_acessos').update({ bloqueado_em: null, bloqueio_motivo: null }).eq('id', a.id)
      return Response.json({ ok: true })
    }
    if (acao === 'revogar') {
      await sb.from('portal_acessos').update({ ativo: false }).eq('id', a.id)
      await sb.from('portal_sessoes').delete().eq('acesso_id', a.id)
      return Response.json({ ok: true })
    }
    if (acao === 'reativar') {
      await sb.from('portal_acessos').update({ ativo: true }).eq('id', a.id)
      return Response.json({ ok: true })
    }
  }

  /* ---------- push no celular do cliente após resposta do escritório ---------- */
  if (acao === 'notificar_cliente') {
    const { data: p } = await sb.from('processos').select('id,numero,cliente_id,cliente_nome,escritorio_id')
      .eq('id', String(body.processo_id || '')).eq('escritorio_id', quem.escritorio_id).maybeSingle()
    if (!p) return Response.json({ erro: 'Processo não encontrado.' }, { status: 404 })
    const { data: v } = await sb.from('app_secrets').select('valor').eq('chave', 'vapid_chat').maybeSingle()
    if (!(v && v.valor)) return Response.json({ ok: true, enviados: 0 })
    webpush.setVapidDetails('mailto:contato@cmpadvogados.com.br', v.valor.public, v.valor.private)
    const acessos = await acessosDoProcesso(sb, p)
    const ids = acessos.filter(a => a.ativo && !a.bloqueado_em).map(a => a.id)
    if (!ids.length) return Response.json({ ok: true, enviados: 0 })
    const { data: subs } = await sb.from('portal_push_subs').select('*').in('acesso_id', ids)
    const payload = JSON.stringify({
      titulo: 'CMP Advogados — mensagem no seu processo',
      corpo: String(body.texto || 'Nova mensagem do escritório.').slice(0, 140),
      url: '/portal.html?proc=' + p.id,
    })
    let enviados = 0
    const mortos = []
    await Promise.all((subs || []).map(async (s) => {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } }, payload); enviados++ }
      catch (e) { if (e && (e.statusCode === 404 || e.statusCode === 410)) mortos.push(s.endpoint) }
    }))
    if (mortos.length) { try { await sb.from('portal_push_subs').delete().in('endpoint', mortos) } catch (e) {} }
    return Response.json({ ok: true, enviados })
  }

  return Response.json({ erro: 'Ação desconhecida.' }, { status: 400 })
}

export async function GET() {
  return Response.json({ info: 'Use POST autenticado (Bearer) para gerenciar o Portal do Cliente.' })
}
