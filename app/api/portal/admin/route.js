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

/* acessos que enxergam um processo — mesma regra do portal (função no banco):
   grant explícito, contato vinculado ou nome do cliente igual sem acento. */
async function acessosDoProcesso(sb, p) {
  const { data, error } = await sb.rpc('portal_acessos_do_processo', { p_processo: p.id })
  if (error || !data) return []
  return data
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

// O WhatsApp do computador recebe o texto do link em UCS-2: tudo que passa de
// U+FFFF — ou seja, todo emoji colorido — chega como "�" na conversa (acento passa
// numa boa, porque cabe em 2 bytes). Por isso a mensagem usa negrito do próprio
// WhatsApp (*assim*) no lugar de ícones, e esta peneira impede que um emoji volte a
// entrar por descuido numa edição futura.
function semAstral(t) {
  return String(t || '').replace(/[\u{10000}-\u{10FFFF}]/gu, '')
}

// Mesma informação do e-mail, no jeito do WhatsApp: curto e sem parágrafo longo.
// O texto volta pronto para o navegador abrir o wa.me.
function textoWhatsapp({ nome, email, senha, novoProcesso }) {
  const primeiro = String(nome || '').trim().split(/\s+/)[0] || ''
  return semAstral(
    'Olá' + (primeiro ? ', ' + primeiro : '') + '!\n\n' +
    (novoProcesso
      ? 'Liberamos mais um processo no seu acesso ao aplicativo do escritório.'
      : 'Seu acesso ao aplicativo do escritório está pronto.') + '\n\n' +
    '*Endereço:* ' + URL_PUBLICA + '/portal.html\n' +
    '*Login:* ' + email + '\n' +
    (senha ? ('*Senha:* ' + senha + '\n') : '*Senha:* a que você já usa (se esqueceu, avise que enviamos outra)\n') +
    '\nNo aplicativo você acompanha as movimentações, vê os documentos oficiais (despachos, sentenças e acordos), as petições que protocolamos e o contato do cartório da Vara — e fala com a gente pelo chat de dentro do processo.\n\n' +
    'Para deixar como aplicativo no celular: abra o endereço e toque em "Instalar o aplicativo". No iPhone, use Compartilhar e depois "Adicionar à Tela de Início".\n\n' +
    'O acesso é pessoal — não compartilhe. Por segurança, o uso em muitos aparelhos diferentes bloqueia o acesso.'
  )
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

  /* ---------- e-mail e WhatsApp do cliente, para o painel já vir preenchido ---------- */
  if (acao === 'contato_por_nome') {
    const nome = String(body.nome || '').replace(/\s+/g, ' ').trim()
    const procId = String(body.processo_id || '')
    let contato = null
    if (nome) {
      const { data: cid } = await sb.rpc('portal_contato_por_nome', { p_escritorio: quem.escritorio_id, p_nome: nome })
      if (cid) {
        const { data: c } = await sb.from('contatos').select('id,nome,email,emails,telefone,telefones').eq('id', cid).maybeSingle()
        contato = c || null
      }
    }
    // sem contato pelo nome do autor, cai no cliente cadastrado no processo
    if (!contato && procId) {
      const { data: p } = await sb.from('processos').select('cliente_id').eq('id', procId).eq('escritorio_id', quem.escritorio_id).maybeSingle()
      if (p && p.cliente_id) {
        const { data: c } = await sb.from('contatos').select('id,nome,email,emails,telefone,telefones').eq('id', p.cliente_id).maybeSingle()
        contato = c || null
      }
    }
    if (!contato) return Response.json({ ok: true, contato: null })
    const email = String(contato.email || (Array.isArray(contato.emails) ? contato.emails[0] : '') || '').trim()
    const telefone = String(contato.telefone || (Array.isArray(contato.telefones) ? contato.telefones[0] : '') || '').trim()
    return Response.json({ ok: true, contato: { nome: contato.nome, email, telefone } })
  }

  /* ---------- prévia: o que este login vai mostrar ---------- */
  if (acao === 'previa') {
    const nome = String(body.nome || '').replace(/\s+/g, ' ').trim()
    const email = String(body.email || '').trim().toLowerCase()
    const procId = String(body.processo_id || '').trim()
    if (!nome) return Response.json({ ok: true, processos: [] })
    // se já existe acesso com esse e-mail, a prévia é o que ELE enxerga hoje
    let linhas = null
    if (email) {
      const { data: a } = await sb.from('portal_acessos').select('id,escritorio_id').eq('email', email).maybeSingle()
      if (a && a.escritorio_id === quem.escritorio_id) {
        const { data: ids, error: eIds } = await sb.rpc('portal_processos_ids', { p_acesso: a.id })
        if (eIds) return Response.json({ erro: 'Falha ao consultar os processos deste acesso: ' + eIds.message }, { status: 500 })
        const lista = (ids || []).map(r => (typeof r === 'string' ? r : r.processo_id)).filter(Boolean)
        if (lista.length) {
          const { data: ps } = await sb.from('processos').select('id,numero,cliente_nome,status')
            .in('id', lista).order('ultima_movimentacao', { ascending: false, nullsFirst: false })
          linhas = ps || []
        } else linhas = []
      }
    }
    if (!linhas) {
      // Erro aqui NÃO pode virar lista vazia: a tela dizia "nenhum processo casou
      // com este nome" e mandava conferir o cadastro, culpando o nome por uma
      // falha que era de consulta.
      const { data, error } = await sb.rpc('portal_previa_por_nome', { p_escritorio: quem.escritorio_id, p_nome: nome })
      if (error) return Response.json({ erro: 'Falha ao conferir os processos deste nome: ' + error.message }, { status: 500 })
      linhas = data || []
    }

    // O processo DESTA ficha entra sempre: é ele que o botão vai liberar, case o
    // nome ou não. Antes a prévia só mostrava o resultado da busca por nome, e um
    // nome gravado diferente fazia a tela parecer dizer que este processo ficaria
    // de fora — quando ele é justamente o único garantido.
    let esteProcesso = null
    if (procId) {
      const { data: p0 } = await sb.from('processos').select('id,numero,cliente_nome,status')
        .eq('id', procId).eq('escritorio_id', quem.escritorio_id).maybeSingle()
      if (p0) {
        esteProcesso = { id: p0.id, numero: p0.numero }
        if (!linhas.some(x => x.id === p0.id)) linhas = [p0, ...linhas]
      }
    }

    const emAndamento = linhas.filter(p => !/encerrad|arquivad|baixad/i.test(p.status || ''))

    // Nome PARECIDO (não idêntico): o casamento automático é por igualdade exata,
    // então "LORENA GABRIELA PINHEIRO DOS" — nome truncado na importação — não casa
    // com "Lorena Gabriela Pinheiro dos Santos" e o processo fica fora sem aviso.
    // Só sugerimos para conferência; incluir por semelhança arriscaria mostrar a um
    // cliente o processo de um homônimo.
    let parecidos = []
    try {
      const duasPalavras = nome.split(' ').slice(0, 2).join(' ')
      if (duasPalavras.length >= 6) {
        const { data: simil } = await sb.from('processos').select('id,numero,cliente_nome,status')
          .eq('escritorio_id', quem.escritorio_id).ilike('cliente_nome', '%' + duasPalavras + '%').limit(20)
        const jaTem = new Set(linhas.map(x => x.id))
        parecidos = (simil || [])
          .filter(p => !jaTem.has(p.id) && !/encerrad|arquivad|baixad/i.test(p.status || ''))
          .map(p => ({ id: p.id, numero: p.numero, cliente_nome: p.cliente_nome }))
      }
    } catch (e) { /* sugestão é acessório: nunca derruba a prévia */ }

    return Response.json({
      ok: true, processos: emAndamento, ocultos: linhas.length - emAndamento.length,
      este_processo: esteProcesso, parecidos,
    })
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

    // Vincula ao contato do escritório procurando pelo nome de QUEM VAI RECEBER o
    // acesso — nunca pelo nome do cliente do processo. Num processo com dois autores
    // os nomes são diferentes, e ligar ao contato errado faria a pessoa enxergar os
    // processos do outro (foi assim que um acesso ficou apontando para o contato de
    // outro cliente). Sem contato com esse nome, o acesso fica sem vínculo e vale só
    // o nome do titular — que é o mais restrito.
    let contatoId = String(body.contato_id || '') || null
    if (!contatoId) {
      const { data: achado } = await sb.rpc('portal_contato_por_nome', {
        p_escritorio: quem.escritorio_id, p_nome: nome,
      })
      if (achado) contatoId = achado
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

    // Entrega por WhatsApp: não manda e-mail, devolve o texto pronto para o
    // navegador abrir a conversa. Se o acesso já existia, a senha atual não é
    // conhecida (fica só o hash) — o texto sai sem senha e o painel oferece o
    // botão de senha nova. Guarda também o telefone no cadastro do contato.
    if (String(body.canal || 'email') === 'whatsapp') {
      const fone = digitos(body.whatsapp || '')
      if (contatoId && fone.length >= 10) {
        try {
          const { data: c } = await sb.from('contatos').select('id,telefone').eq('id', contatoId).maybeSingle()
          if (c && !String(c.telefone || '').trim()) await sb.from('contatos').update({ telefone: String(body.whatsapp || '').trim() }).eq('id', contatoId)
        } catch (e) {}
      }
      return Response.json({
        ok: true, criado, canal: 'whatsapp', senha,
        texto: textoWhatsapp({ nome, email, senha, novoProcesso: !criado }),
        acessos: await statusDoProcesso(sb, p),
      })
    }

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
  if (['reenviar', 'senha_whatsapp', 'desbloquear', 'revogar', 'reativar'].includes(acao)) {
    const { data: a } = await sb.from('portal_acessos').select('*').eq('id', acessoId).eq('escritorio_id', quem.escritorio_id).maybeSingle()
    if (!a) return Response.json({ erro: 'Acesso não encontrado.' }, { status: 404 })

    // senha nova para mandar pelo WhatsApp — o texto volta pronto, sem e-mail
    if (acao === 'senha_whatsapp') {
      const senha = gerarSenha()
      await sb.from('portal_acessos').update({ senha_hash: hashSenha(senha), senha_enviada_em: new Date().toISOString(), ativo: true }).eq('id', a.id)
      await sb.from('portal_sessoes').delete().eq('acesso_id', a.id)   // senha nova derruba sessão antiga
      return Response.json({ ok: true, senha, texto: textoWhatsapp({ nome: a.nome, email: a.email, senha, novoProcesso: false }) })
    }

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

  /* ---------- aviso de AUDIÊNCIA pelo chat do app ----------
     Só sai se o cliente realmente tem acesso ao app (conta ativa e não bloqueada);
     senão devolve o motivo, e o escritório segue pelo e-mail/WhatsApp de sempre.
     A trava contra repetição é a mesma tabela do aviso por e-mail
     (avisos_audiencia, único por processo+data+tipo), aqui com tipo 'app'. */
  if (acao === 'avisar_audiencia_app') {
    const { data: p } = await sb.from('processos').select('id,numero,cliente_id,cliente_nome,escritorio_id')
      .eq('id', String(body.processo_id || '')).eq('escritorio_id', quem.escritorio_id).maybeSingle()
    if (!p) return Response.json({ erro: 'Processo não encontrado.' }, { status: 404 })

    const acessos = (await acessosDoProcesso(sb, p)).filter(a => a.ativo && !a.bloqueado_em)
    if (!acessos.length) return Response.json({ ok: true, enviado: false, motivo: 'sem_acesso' })
    const logados = acessos.filter(a => a.primeiro_login_em)

    const data = String(body.data || '').slice(0, 10)
    const hora = String(body.hora || '').slice(0, 8)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return Response.json({ erro: 'data inválida' }, { status: 400 })
    const marcador = String(body.tipo || 'designacao') === 'vespera' ? 'app_vespera' : 'app'

    const mk = await sb.from('avisos_audiencia').insert({
      escritorio_id: p.escritorio_id, processo_numero: p.numero,
      data_audiencia: data, tipo: marcador, email: acessos[0].email,
    }).select('id').single()
    if (mk.error) return Response.json({ ok: true, enviado: false, motivo: 'ja_avisado' })

    const dbr = data.split('-').reverse().join('/')
    const horaTxt = (hora && hora !== 'Dia todo') ? (' às ' + hora) : ''
    const texto = String(body.texto || '').trim() || (
      marcador === 'app_vespera'
        ? ('Lembrete: sua audiência no processo nº ' + p.numero + ' é AMANHÃ, dia ' + dbr + horaTxt + '.\n\n' +
           'Sua presença é obrigatória. Qualquer dúvida, responda por aqui mesmo.')
        : ('Foi designada audiência no seu processo nº ' + p.numero + ': dia ' + dbr + horaTxt + '.\n\n' +
           'Sua presença é obrigatória. Vamos entrar em contato antes da data para combinar os detalhes — e faremos um novo aviso na véspera.\n\n' +
           'Qualquer dúvida, é só responder aqui neste chat.')
    )

    const ins = await sb.from('portal_chat').insert({
      escritorio_id: p.escritorio_id, processo_id: p.id, autor_tipo: 'escritorio',
      autor_id: quem.id, autor_nome: quem.nome || 'CMP Advogados', texto,
      lida_escritorio: true, lida_cliente: false,
    }).select('id').single()
    if (ins.error) {
      try { await sb.from('avisos_audiencia').delete().eq('id', mk.data.id) } catch (e) {}
      return Response.json({ erro: ins.error.message }, { status: 500 })
    }

    // push no celular do cliente (melhor esforço)
    try {
      const { data: v } = await sb.from('app_secrets').select('valor').eq('chave', 'vapid_chat').maybeSingle()
      if (v && v.valor) {
        webpush.setVapidDetails('mailto:contato@cmpadvogados.com.br', v.valor.public, v.valor.private)
        const { data: subs } = await sb.from('portal_push_subs').select('*').in('acesso_id', acessos.map(a => a.id))
        const payload = JSON.stringify({
          titulo: 'CMP Advogados — audiência ' + (marcador === 'app_vespera' ? 'amanhã' : 'designada'),
          corpo: 'Processo ' + p.numero + ' · ' + dbr + horaTxt,
          url: '/portal.html?proc=' + p.id,
        })
        const mortos = []
        await Promise.all((subs || []).map(async (s) => {
          try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } }, payload) }
          catch (e) { if (e && (e.statusCode === 404 || e.statusCode === 410)) mortos.push(s.endpoint) }
        }))
        if (mortos.length) { try { await sb.from('portal_push_subs').delete().in('endpoint', mortos) } catch (e) {} }
      }
    } catch (e) {}

    return Response.json({
      ok: true, enviado: true,
      clientes: acessos.map(a => a.nome || a.email),
      logados: logados.length, total: acessos.length,
    })
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
