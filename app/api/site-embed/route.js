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

import { createClient } from '@supabase/supabase-js'
import { EMBED_CHAT_HTML, EMBED_CHAT_BLOCO_GUTENBERG, MARCA_EMBED_CHAT, detectarConstrutorWP } from '../../../lib/embedChat.js'

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

export async function POST(request) {
  let body
  try { body = await request.json() } catch (e) { return Response.json({ erro: 'json inválido' }, { status: 400 }) }
  const u = await usuario(request)
  if (!u) return Response.json({ erro: 'não autorizado' }, { status: 401 })

  const site = SITES[body.site]
  if (!site) return Response.json({ erro: 'site inválido' }, { status: 400 })
  const auth = await credencialWP(site)
  if (!auth) return Response.json({ erro: 'credencial do WordPress não configurada para ' + site.rotulo }, { status: 500 })

  // ===== todos os posts (varredura em massa, sem etapa de diagnóstico separada) =====
  if (body.acao === 'inserir_posts') {
    const rel = { total: 0, inseridos: 0, ja_tinha: 0, pulados_construtor: 0, falhas: 0 }
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
          if (conteudo.includes(MARCA_EMBED_CHAT)) { rel.ja_tinha++; continue }
          const construtor = detectarConstrutorWP(conteudo)
          if (construtor !== 'gutenberg' && construtor !== 'classico') { rel.pulados_construtor++; continue }
          const novoConteudo = conteudo + (construtor === 'gutenberg' ? EMBED_CHAT_BLOCO_GUTENBERG : ('\n' + EMBED_CHAT_HTML + '\n'))
          const ru = await fetch(site.base + '/wp-json/wp/v2/posts/' + p.id, {
            method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (CMPGestao)' },
            body: JSON.stringify({ content: novoConteudo }),
          })
          if (!ru.ok) { rel.falhas++; continue }
          rel.inseridos++
        } catch (e) { rel.falhas++ }
      }
      if (lista.length < 100) break
    }
    return Response.json({ ok: true, ...rel })
  }

  // ===== home (diagnosticar / inserir) =====
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

  return Response.json({ erro: 'ação inválida' }, { status: 400 })
}
