// Insere (ou só diagnostica) o embed do chat público (/cliente) na home dos
// sites do escritório (djan.com.br / cmpadvogados.com.br), pela REST do
// WordPress — mesma senha de aplicativo que o módulo de Publicações usa
// (app_secrets: wordpress_djan / wordpress_cmp).
//
// Duas etapas de propósito: quem aciona isso não vê o resultado ao vivo (o
// servidor não tem tela), então 'diagnosticar' roda ANTES de 'inserir' e
// detecta o construtor de página. Se for Elementor/Divi (que normalmente
// IGNORA o campo de conteúdo bruto — a edição não apareceria e ninguém
// perceberia o motivo), recusa inserir sozinho: melhor colar manualmente no
// editor visual (com preview) do que editar às cegas sem efeito nenhum.
//
//   POST { acao:'diagnosticar', site:'cmp'|'djan' }  -> construtor detectado, seguro?
//   POST { acao:'inserir', site:'cmp'|'djan', forcar? }

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const SITES = {
  djan: { base: 'https://djan.com.br', rotulo: 'djan.com.br', secret: 'wordpress_djan' },
  cmp: { base: 'https://cmpadvogados.com.br', rotulo: 'cmpadvogados.com.br', secret: 'wordpress_cmp' },
}
const MARCA_EMBED = 'gestao.cmpadvogados.com.br/cliente'
const EMBED_HTML = '<div style="max-width:480px;margin:50px auto;text-align:center;font-family:system-ui,-apple-system,sans-serif;padding:0 16px">'
  + '<h2 style="color:#2E3A4B;font-size:22px;margin:0 0 6px">Fale agora com o escritório</h2>'
  + '<p style="color:#697180;font-size:14px;margin:0 0 18px">Conte sua situação no chat abaixo — sem sair da página.</p>'
  + '<iframe src="https://' + MARCA_EMBED + '" title="Chat com o escritório" style="width:100%;height:620px;border:0;border-radius:16px;box-shadow:0 10px 34px rgba(20,28,40,.18)" loading="lazy"></iframe>'
  + '</div>'
const EMBED_BLOCO_GUTENBERG = '\n<!-- wp:html -->\n' + EMBED_HTML + '\n<!-- /wp:html -->\n'

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
function detectarConstrutor(html) {
  const h = String(html || '')
  if (/<!--\s*wp:/i.test(h)) return 'gutenberg'
  if (/elementor|data-elementor/i.test(h)) return 'elementor'
  if (/et_pb_section|et_pb_row/i.test(h)) return 'divi'
  if (h.trim().length < 20) return 'vazio_ou_construtor_externo'
  return 'classico'
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

  const paginaId = await acharPaginaInicial(site, auth)
  if (!paginaId) return Response.json({ erro: 'não achei a página inicial de ' + site.rotulo }, { status: 404 })

  const rp = await fetch(site.base + '/wp-json/wp/v2/pages/' + paginaId + '?context=edit', { headers: { Authorization: auth, 'User-Agent': 'Mozilla/5.0 (CMPGestao)' }, cache: 'no-store' })
  if (!rp.ok) return Response.json({ erro: 'não consegui ler a página inicial (HTTP ' + rp.status + ')' }, { status: 502 })
  const pag = await rp.json()
  const conteudoAtual = (pag.content && pag.content.raw) || ''
  const construtor = detectarConstrutor(conteudoAtual)
  const jaTemEmbed = conteudoAtual.includes(MARCA_EMBED)
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
    const novoConteudo = (construtor === 'gutenberg' ? EMBED_BLOCO_GUTENBERG : ('\n' + EMBED_HTML + '\n')) + conteudoAtual
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
