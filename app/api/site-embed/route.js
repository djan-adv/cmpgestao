// Insere (ou só diagnostica) o embed do chat público (/cliente) na home e
// nos posts dos sites do escritório (djan.com.br / cmpadvogados.com.br),
// pela REST do WordPress — mesma senha de aplicativo que o módulo de
// Publicações usa (app_secrets: wordpress_djan / wordpress_cmp).
//
// Home: duas etapas de propósito. Quem aciona isso não vê o resultado ao
// vivo (o servidor não tem tela), então 'diagnosticar' roda ANTES de
// 'inserir' e detecta o construtor de página. Se for Elementor/Divi (que
// normalmente IGNORA o campo de conteúdo bruto — a edição não apareceria e
// ninguém perceberia o motivo), recusa inserir sozinho: melhor colar
// manualmente no editor visual (com preview) do que editar às cegas sem
// efeito nenhum.
//
// Posts: 'inserir_posts' varre TODOS os posts existentes e faz o mesmo
// diagnóstico por post (post a post pode ter construtor diferente da home),
// pulando os inseguros/já inseridos — sem etapa de confirmação por item
// (inviável pra dezenas de posts); o resumo (quantos entraram/pularam/
// falharam) é o que dá pra conferir depois. Posts NOVOS publicados pelo
// sistema (app/api/publicacoes) já saem com o embed, sem precisar rodar isto de novo.
//
//   POST { acao:'diagnosticar', site:'cmp'|'djan' }        -> home: construtor detectado, seguro?
//   POST { acao:'inserir', site:'cmp'|'djan', forcar? }     -> home: insere
//   POST { acao:'inserir_posts', site:'cmp'|'djan' }        -> todos os posts: insere onde for seguro
//   POST { acao:'remover', site:'cmp'|'djan' }              -> home: tira o embed (pedido do dono, 24/08/2026 —
//                                                               leads saindo com dado ruim, chat volta desligado)
//   POST { acao:'remover_posts', site:'cmp'|'djan' }        -> todos os posts: tira o embed de quem tiver

import { createClient } from '@supabase/supabase-js'
import { EMBED_CHAT_HTML, EMBED_CHAT_BLOCO_GUTENBERG, MARCA_EMBED_CHAT, detectarConstrutorWP, embedChatHtmlSemTitulo, removerEmbedDoConteudo } from '../../../lib/embedChat.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const SITES = {
  djan: { base: 'https://djan.com.br', rotulo: 'djan.com.br', secret: 'wordpress_djan' },
  cmp: { base: 'https://cmpadvogados.com.br', rotulo: 'cmpadvogados.com.br', secret: 'wordpress_cmp' },
}

function svc() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}
async function credencialWP(site) {
  const { data: sec } = await svc().from('app_secrets').select('valor').eq('chave', site.secret).maybeSingle()
  const cred = sec && sec.valor
  if (!cred || !cred.usuario || !cred.senha) return null
  return 'Basic ' + Buffer.from(cred.usuario + ':' + cred.senha).toString('base64')
}
async function usuario(request) {
  const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const u = await sb.auth.getUser(jwt)
  return (u && u.data && u.data.user) || null
}

// acha a página inicial: settings.page_on_front (site "página estática"),
// senão tenta slugs comuns
async function acharPaginaInicial(site, auth) {
  try {
    const rs = await fetch(site.base + '/wp-json/wp/v2/settings', { headers: { Authorization: auth, 'User-Agent': 'Mozilla/5.0 (CMPGestao)' }, cache: 'no-store' })
    if (rs.ok) {
      const s = await rs.json()
      if (s.show_on_front === 'page' && s.page_on_front) return s.page_on_front
    }
  } catch (e) {}
  for (const slug of ['home', 'inicio', 'index']) {
    try {
      const rp = await fetch(site.base + '/wp-json/wp/v2/pages?slug=' + slug, { headers: { Authorization: auth, 'User-Agent': 'Mozilla/5.0 (CMPGestao)' }, cache: 'no-store' })
      if (rp.ok) { const arr = await rp.json(); if (arr && arr[0]) return arr[0].id }
    } catch (e) {}
  }
  return null
}

// varre a árvore de elementos do Elementor (seções > colunas > widgets,
// aninhados) e junta um "caminho" (índices) até cada nó — usado tanto pra
// listar botões quanto, depois, pra achar de volta o mesmo nó e trocar o link
function _andaElementor(nos, caminho, fn) {
  (nos || []).forEach((no, i) => {
    const aqui = caminho.concat(i)
    fn(no, aqui)
    if (Array.isArray(no.elements) && no.elements.length) _andaElementor(no.elements, aqui, fn)
  })
}
function _achaNoCaminho(nos, caminho) {
  let atual = nos
  let no = null
  for (const i of caminho) {
    no = (atual || [])[i]
    if (!no) return null
    atual = no.elements
  }
  return no
}
// devolve TODO link (settings.link.url e variantes conhecidas) de um widget —
// diferentes widgets do Elementor guardam link em campos com nomes diferentes
const CAMPOS_LINK = ['link', 'button_link', 'url', 'select_link']
function _linksDoNo(no) {
  const s = (no && no.settings) || {}
  const achados = []
  for (const campo of CAMPOS_LINK) {
    const v = s[campo]
    if (v && typeof v === 'object' && typeof v.url === 'string' && v.url) achados.push({ campo, url: v.url })
    else if (typeof v === 'string' && v) achados.push({ campo, url: v })
  }
  return achados
}
function _textoDoNo(no) {
  const s = (no && no.settings) || {}
  let base = String(s.text || s.title || s.editor || s.button_text || '')
  // formulários (Elementor Form, WPForms, CF7 embutido…) não têm um "texto"
  // único — junta os rótulos de campo (form_fields) e o shortcode, se houver
  if (Array.isArray(s.form_fields)) base += ' ' + s.form_fields.map(f => f && f.field_label).filter(Boolean).join(', ')
  if (s.shortcode) base += ' ' + s.shortcode
  return base.replace(/<[^>]+>/g, ' ').trim().slice(0, 120)
}
// heurística pra achar "aquele formulário quebrado" sem saber o widgetType
// exato do plugin — casa pelo texto visível (rótulos) OU pelo tipo do widget
function _pareceFormulario(no) {
  const tipo = String((no && (no.widgetType || no.elType)) || '').toLowerCase()
  if (/form|contact-form|wpforms|gravityforms|ninja|forminator/.test(tipo)) return true
  const texto = _textoDoNo(no).toLowerCase()
  return /nome completo|e-mail|enviar/.test(texto) && (no.widgetType || '') !== 'html'
}
// nó novo do tipo "html" do Elementor — id no mesmo formato que o Elementor usa
// (7 caracteres hex/alfanum), pra não colidir com os ids existentes na árvore
function _novoWidgetHtml(html) {
  const id = Math.random().toString(36).slice(2, 9)
  return { id, elType: 'widget', isInner: false, settings: { html }, elements: [], widgetType: 'html' }
}
function _substituiNoCaminho(nos, caminho, novoNo) {
  let atual = nos
  for (let i = 0; i < caminho.length - 1; i++) {
    const no = (atual || [])[caminho[i]]
    if (!no) return false
    atual = no.elements
  }
  const ultimo = caminho[caminho.length - 1]
  if (!atual || !atual[ultimo]) return false
  atual[ultimo] = novoNo
  return true
}
// junta o carregamento da home + parse do _elementor_data, comum às 4 ações
// que mexem nos widgets da página (listar/trocar link, listar/substituir widget)
async function _carregarElementorHome(site, auth) {
  const paginaId = await acharPaginaInicial(site, auth)
  if (!paginaId) return { erro: 'não achei a página inicial de ' + site.rotulo, status: 404 }
  const rm = await fetch(site.base + '/wp-json/wp/v2/pages/' + paginaId + '?context=edit', { headers: { Authorization: auth, 'User-Agent': 'Mozilla/5.0 (CMPGestao)' }, cache: 'no-store' })
  if (!rm.ok) return { erro: 'não consegui ler a página inicial (HTTP ' + rm.status + ')', status: 502 }
  const pag = await rm.json()
  const bruto = pag.meta && pag.meta._elementor_data
  if (!bruto || typeof bruto !== 'string' || !bruto.trim()) {
    return { semAcesso: true, pag }
  }
  let arvore
  try { arvore = JSON.parse(bruto) } catch (e) { return { erro: 'não consegui interpretar os dados do Elementor (JSON inválido)', status: 502 } }
  return { paginaId, pag, arvore }
}
async function _gravarElementorHome(site, auth, paginaId, arvore) {
  return fetch(site.base + '/wp-json/wp/v2/pages/' + paginaId, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (CMPGestao)' },
    body: JSON.stringify({ meta: { _elementor_data: JSON.stringify(arvore) } }),
  })
}

export async function POST(request) {
  let body
  try { body = await request.json() } catch (e) { return Response.json({ erro: 'json inválido' }, { status: 400 }) }
  const u = await usuario(request)
  if (!u) return Response.json({ erro: 'não autorizado' }, { status: 401 })

  const site = SITES[body.site]
  if (!site) return Response.json({ erro: 'site inválido' }, { status: 400 })
  const auth = await credencialWP(site)
  if (!auth) return Response.json({ erro: 'credencial do WordPress não configurada para ' + site.rotulo }, { status: 500 })

  // ===== widgets do Elementor na home: listar (link ou geral) / trocar link / substituir por chat =====
  const ACOES_ELEMENTOR = ['listar_botoes_elementor', 'trocar_link_botao', 'listar_elementos_elementor', 'substituir_widget_por_chat']
  if (ACOES_ELEMENTOR.includes(body.acao)) {
    const carregado = await _carregarElementorHome(site, auth)
    if (carregado.erro) return Response.json({ erro: carregado.erro }, { status: carregado.status })
    if (carregado.semAcesso) {
      return Response.json({ ok: true, elementor_data_acessivel: false, aviso: 'O WordPress não devolveu o campo _elementor_data pela API (meta protegido, comum por padrão) — não dá pra ler nem editar por aqui. Precisa ser no editor visual mesmo.' })
    }
    const { paginaId, pag, arvore } = carregado

    if (body.acao === 'listar_botoes_elementor') {
      const botoes = []
      _andaElementor(arvore, [], (no, caminho) => {
        const links = _linksDoNo(no)
        if (links.length) botoes.push({ caminho: caminho.join('.'), tipo: no.widgetType || no.elType, texto: _textoDoNo(no), links })
      })
      return Response.json({ ok: true, elementor_data_acessivel: true, pagina_id: paginaId, total_com_link: botoes.length, botoes: botoes.slice(0, 40) })
    }

    if (body.acao === 'listar_elementos_elementor') {
      const todos = []
      _andaElementor(arvore, [], (no, caminho) => {
        if (no.elType !== 'widget') return   // seções/colunas só servem de estrutura — não dá pra "trocar" elas por um widget
        todos.push({ caminho: caminho.join('.'), tipo: no.widgetType || no.elType, texto: _textoDoNo(no), suspeito_formulario: _pareceFormulario(no) })
      })
      todos.sort((a, b) => (b.suspeito_formulario ? 1 : 0) - (a.suspeito_formulario ? 1 : 0))
      return Response.json({ ok: true, elementor_data_acessivel: true, pagina_id: paginaId, total: todos.length, widgets: todos.slice(0, 60) })
    }

    if (body.acao === 'trocar_link_botao') {
      const caminho = String(body.caminho || '').split('.').filter(x => x !== '').map(Number)
      if (!caminho.length) return Response.json({ erro: 'informe o caminho (devolvido por listar_botoes_elementor)' }, { status: 400 })
      const novoLink = String(body.novo_link || '').trim()
      if (!novoLink) return Response.json({ erro: 'informe novo_link' }, { status: 400 })
      const no = _achaNoCaminho(arvore, caminho)
      if (!no) return Response.json({ erro: 'não achei mais esse botão nesse caminho (a página pode ter mudado) — rode listar_botoes_elementor de novo' }, { status: 404 })
      const s = no.settings || {}
      let trocou = false
      for (const campo of CAMPOS_LINK) {
        const v = s[campo]
        if (v && typeof v === 'object' && 'url' in v) { v.url = novoLink; trocou = true; break }
        if (typeof v === 'string' && v) { s[campo] = novoLink; trocou = true; break }
      }
      if (!trocou) return Response.json({ erro: 'esse botão não tem um campo de link reconhecido' }, { status: 400 })
      const ru2 = await _gravarElementorHome(site, auth, paginaId, arvore)
      if (!ru2.ok) { const t = await ru2.text().catch(() => ''); return Response.json({ erro: 'falha ao gravar (HTTP ' + ru2.status + '): ' + t.slice(0, 300) }, { status: 502 }) }
      return Response.json({ ok: true, link_pagina: pag.link })
    }

    if (body.acao === 'substituir_widget_por_chat') {
      const caminho = String(body.caminho || '').split('.').filter(x => x !== '').map(Number)
      if (!caminho.length) return Response.json({ erro: 'informe o caminho (devolvido por listar_elementos_elementor)' }, { status: 400 })
      const trocou = _substituiNoCaminho(arvore, caminho, _novoWidgetHtml(embedChatHtmlSemTitulo(body.altura)))
      if (!trocou) return Response.json({ erro: 'não achei mais esse widget nesse caminho (a página pode ter mudado) — rode listar_elementos_elementor de novo' }, { status: 404 })
      const ru3 = await _gravarElementorHome(site, auth, paginaId, arvore)
      if (!ru3.ok) { const t = await ru3.text().catch(() => ''); return Response.json({ erro: 'falha ao gravar (HTTP ' + ru3.status + '): ' + t.slice(0, 300) }, { status: 502 }) }
      return Response.json({ ok: true, link_pagina: pag.link })
    }
  }

  // ===== todos os posts (varredura em massa, sem etapa de diagnóstico separada) =====
  // Além de inserir o chat, fecha os comentários nativos do WordPress: a caixa
  // "Deixe um comentário" é do TEMA (renderizada quando comment_status='open'),
  // não faz parte do conteúdo do post — por isso um campo próprio da API
  // resolve, sem precisar mexer no HTML/Elementor pra tirá-la da tela.
  if (body.acao === 'inserir_posts') {
    const rel = { total: 0, inseridos: 0, ja_tinha: 0, pulados_construtor: 0, comentarios_fechados: 0, falhas: 0 }
    for (let pagina = 1; pagina <= 20; pagina++) {
      let lista
      try {
        const rl = await fetch(site.base + '/wp-json/wp/v2/posts?per_page=100&page=' + pagina + '&_fields=id', { headers: { Authorization: auth, 'User-Agent': 'Mozilla/5.0 (CMPGestao)' }, cache: 'no-store' })
        if (!rl.ok) break
        lista = await rl.json()
      } catch (e) { break }
      if (!Array.isArray(lista) || !lista.length) break
      for (const p of lista) {
        rel.total++
        try {
          const rp = await fetch(site.base + '/wp-json/wp/v2/posts/' + p.id + '?context=edit', { headers: { Authorization: auth, 'User-Agent': 'Mozilla/5.0 (CMPGestao)' }, cache: 'no-store' })
          if (!rp.ok) { rel.falhas++; continue }
          const post = await rp.json()
          const conteudo = (post.content && post.content.raw) || ''
          const jaTinha = conteudo.includes(MARCA_EMBED_CHAT)
          const construtor = detectarConstrutorWP(conteudo)
          const seguroConteudo = !jaTinha && (construtor === 'gutenberg' || construtor === 'classico')
          const fecharComentario = post.comment_status !== 'closed'
          if (jaTinha) rel.ja_tinha++
          else if (!seguroConteudo) rel.pulados_construtor++

          const patch = {}
          if (seguroConteudo) patch.content = conteudo + (construtor === 'gutenberg' ? EMBED_CHAT_BLOCO_GUTENBERG : ('\n' + EMBED_CHAT_HTML + '\n'))
          if (fecharComentario) patch.comment_status = 'closed'
          if (!Object.keys(patch).length) continue

          const ru = await fetch(site.base + '/wp-json/wp/v2/posts/' + p.id, {
            method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (CMPGestao)' },
            body: JSON.stringify(patch),
          })
          if (!ru.ok) { rel.falhas++; continue }
          if (patch.content) rel.inseridos++
          if (patch.comment_status) rel.comentarios_fechados++
        } catch (e) { rel.falhas++ }
      }
      if (lista.length < 100) break
    }
    return Response.json({ ok: true, ...rel })
  }

  // ===== todos os posts: tira o embed de quem tiver =====
  if (body.acao === 'remover_posts') {
    const rel = { total: 0, removidos: 0, nao_tinha: 0, falhas: 0 }
    for (let pagina = 1; pagina <= 20; pagina++) {
      let lista
      try {
        const rl = await fetch(site.base + '/wp-json/wp/v2/posts?per_page=100&page=' + pagina + '&_fields=id', { headers: { Authorization: auth, 'User-Agent': 'Mozilla/5.0 (CMPGestao)' }, cache: 'no-store' })
        if (!rl.ok) break
        lista = await rl.json()
      } catch (e) { break }
      if (!Array.isArray(lista) || !lista.length) break
      for (const p of lista) {
        rel.total++
        try {
          const rp = await fetch(site.base + '/wp-json/wp/v2/posts/' + p.id + '?context=edit', { headers: { Authorization: auth, 'User-Agent': 'Mozilla/5.0 (CMPGestao)' }, cache: 'no-store' })
          if (!rp.ok) { rel.falhas++; continue }
          const post = await rp.json()
          const conteudo = (post.content && post.content.raw) || ''
          const { conteudo: limpo, mudou } = removerEmbedDoConteudo(conteudo)
          if (!mudou) { rel.nao_tinha++; continue }
          const ru = await fetch(site.base + '/wp-json/wp/v2/posts/' + p.id, {
            method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (CMPGestao)' },
            body: JSON.stringify({ content: limpo }),
          })
          if (!ru.ok) { rel.falhas++; continue }
          rel.removidos++
        } catch (e) { rel.falhas++ }
      }
      if (lista.length < 100) break
    }
    return Response.json({ ok: true, ...rel })
  }

  // ===== home (diagnosticar / inserir / remover) =====
  const paginaId = await acharPaginaInicial(site, auth)
  if (!paginaId) return Response.json({ erro: 'não achei a página inicial de ' + site.rotulo }, { status: 404 })

  const rp = await fetch(site.base + '/wp-json/wp/v2/pages/' + paginaId + '?context=edit', { headers: { Authorization: auth, 'User-Agent': 'Mozilla/5.0 (CMPGestao)' }, cache: 'no-store' })
  if (!rp.ok) return Response.json({ erro: 'não consegui ler a página inicial (HTTP ' + rp.status + ')' }, { status: 502 })
  const pag = await rp.json()
  const conteudoAtual = (pag.content && pag.content.raw) || ''
  const construtor = detectarConstrutorWP(conteudoAtual)
  const jaTemEmbed = conteudoAtual.includes(MARCA_EMBED_CHAT)
  const seguro = (construtor === 'gutenberg' || construtor === 'classico') && !jaTemEmbed

  if (body.acao === 'diagnosticar') {
    return Response.json({
      ok: true, pagina_id: paginaId, construtor, ja_tem_embed: jaTemEmbed,
      tamanho_conteudo: conteudoAtual.length, trecho: conteudoAtual.slice(0, 500),
      seguro_para_auto_insercao: seguro, link_pagina: pag.link,
    })
  }

  if (body.acao === 'inserir') {
    if (jaTemEmbed) return Response.json({ erro: 'a página já tem o embed — nada a fazer', link_pagina: pag.link }, { status: 409 })
    if (!seguro && !body.forcar) {
      return Response.json({ erro: 'construtor "' + construtor + '" detectado — inserção automática pode não aparecer na página ao vivo. Use o método manual (colar no editor) ou repita com forcar:true.', construtor }, { status: 409 })
    }
    const novoConteudo = (construtor === 'gutenberg' ? EMBED_CHAT_BLOCO_GUTENBERG : ('\n' + EMBED_CHAT_HTML + '\n')) + conteudoAtual
    const ru = await fetch(site.base + '/wp-json/wp/v2/pages/' + paginaId, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (CMPGestao)' },
      body: JSON.stringify({ content: novoConteudo }),
    })
    if (!ru.ok) { const t = await ru.text().catch(() => ''); return Response.json({ erro: 'falha ao atualizar (HTTP ' + ru.status + '): ' + t.slice(0, 300) }, { status: 502 }) }
    const atualizado = await ru.json()
    return Response.json({ ok: true, pagina_id: paginaId, link_pagina: atualizado.link, construtor })
  }

  if (body.acao === 'remover') {
    if (!jaTemEmbed) return Response.json({ erro: 'a página não tem o embed (ou entrou por um caminho que não dá pra desfazer por aqui, como substituição de widget do Elementor) — nada a fazer', link_pagina: pag.link }, { status: 409 })
    const { conteudo: limpo, mudou } = removerEmbedDoConteudo(conteudoAtual)
    if (!mudou) return Response.json({ erro: 'não consegui achar o bloco exato pra remover — provavelmente foi editado manualmente depois de inserido. Remova pelo editor visual do WordPress.', link_pagina: pag.link }, { status: 409 })
    const ru2 = await fetch(site.base + '/wp-json/wp/v2/pages/' + paginaId, {
      method: 'POST',
      headers: { Authorization: auth, 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (CMPGestao)' },
      body: JSON.stringify({ content: limpo }),
    })
    if (!ru2.ok) { const t = await ru2.text().catch(() => ''); return Response.json({ erro: 'falha ao atualizar (HTTP ' + ru2.status + '): ' + t.slice(0, 300) }, { status: 502 }) }
    const atualizado2 = await ru2.json()
    return Response.json({ ok: true, pagina_id: paginaId, link_pagina: atualizado2.link })
  }

  return Response.json({ erro: 'ação inválida' }, { status: 400 })
}
