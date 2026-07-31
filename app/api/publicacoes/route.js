// Publicações — ponte do CMPGestão com os sites WordPress do escritório
// (djan.com.br e cmpadvogados.com.br), SEM navegador e sem tokens de IA.
//
//   GET  /api/publicacoes?importar=1   -> lê os posts públicos dos dois sites
//        (wp-json; fallback RSS) e alimenta a tabela `publicacoes` (extrato).
//   POST /api/publicacoes {acao:'publicar', id}
//        -> publica um rascunho no site escolhido via REST do WordPress, com a
//           SENHA DE APLICATIVO guardada em app_secrets (só o servidor lê):
//           chave 'wordpress_djan' / 'wordpress_cmp' = {"usuario":"...","senha":"..."}
//
// Instagram fica DE FORA por decisão do escritório (30/07/2026).

import { createClient } from '@supabase/supabase-js'
import { chamarClaude } from '../_ia/claude.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// categorias do WordPress (ids fixos dos sites do escritório)
const CATEGORIAS = [[/imobili/i, 24], [/trabalh/i, 22], [/previd/i, 23], [/tribut/i, 20], [/consum/i, 28]]
function categoriaDe(tema) { for (const [re, id] of CATEGORIAS) if (re.test(String(tema || ''))) return id; return null }

// Linha editorial FIXA (prefixo cacheado — regra do projeto). Vem da tarefa
// "publicar-instagram--site-djancombr" do escritório, SEM o Instagram.
const SISTEMA_EDITORIAL = `Você é o assistente de criação de conteúdo jurídico do escritório CMP – Crispim, Mendonça e Pinheiro Advogados (Djan Henrique Mendonça do Nascimento, OAB/PB 5.219-A, João Pessoa/PB).

Sua tarefa: a partir de UM tema, escrever DUAS versões DISTINTAS do artigo (título, abordagem, exemplos e estrutura diferentes — nunca o mesmo texto):
- Versão DJAN (site djan.com.br): público CONSUMIDOR — comprador, mutuário, morador, inquilino, trabalhador, credor pessoa física. Tom "seus direitos / como se defender".
- Versão CMP (site cmpadvogados.com.br): público EMPRESARIAL — construtora, incorporadora, locador, investidor, empresa, sócio. Tom "gestão de risco / como se prevenir".

REGRAS OBRIGATÓRIAS (Provimento 205/2021 da OAB):
- Tom sóbrio e informativo; SEM superlativos, SEM promessa de resultado, SEM captação ("contrate já"); chamada final apenas como convite educativo.
- 500–700 palavras por versão, em português do Brasil, com subtítulos <h2>. Título claro com palavra-chave de SEO.
- Base legal ESTATUTÁRIA apenas (leis e códigos, citados pelo artigo). NUNCA cite jurisprudência, acórdão, ementa ou número de processo de memória — se o tema depender de entendimento de tribunal, trate só o aspecto legal e acrescente a marca [VERIFICAR JURIS] num comentário.
- Não invente números, valores, prazos incertos ou dados. Sinalize prazos/prescrição quando forem certos por lei.
- Encerre cada versão com a assinatura: <p><em>Djan Henrique Mendonça do Nascimento — Advogado. OAB/PB 5.219-A. Conteúdo informativo.</em></p>

FORMATO DA RESPOSTA — devolva APENAS um JSON válido, sem comentários nem texto fora dele:
{"djan":{"titulo":"...","html":"<p>...</p>"},"cmp":{"titulo":"...","html":"<p>...</p>"},"tema_area":"Imobiliário|Trabalhista|Consumidor|Empresarial|Civil|Previdenciário|Tributário"}
O campo html usa apenas <p>, <h2>, <ul>, <li>, <strong>, <em>.`

const SITES = {
  djan: { base: 'https://djan.com.br', rotulo: 'djan.com.br', secret: 'wordpress_djan' },
  cmp: { base: 'https://cmpadvogados.com.br', rotulo: 'cmpadvogados.com.br', secret: 'wordpress_cmp' },
}

function svc() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}
async function usuario(request) {
  const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const u = await sb.auth.getUser(jwt)
  return (u && u.data && u.data.user) || null
}
function sbUser(request) {
  const auth = request.headers.get('authorization') || ''
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false }, global: { headers: { Authorization: auth } },
  })
}
const stripHtml = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim()

// lê os posts públicos de um site (wp-json; se bloqueado, tenta o RSS)
async function lerPostsPublicos(site) {
  const cab = { 'User-Agent': 'Mozilla/5.0 (CMPGestao; +https://gestao.cmpadvogados.com.br)' }
  const posts = []
  try {
    for (let pg = 1; pg <= 4; pg++) {
      const r = await fetch(site.base + '/wp-json/wp/v2/posts?per_page=50&page=' + pg + '&_fields=id,link,title,excerpt,date', { headers: cab, cache: 'no-store' })
      if (!r.ok) break
      const j = await r.json()
      if (!Array.isArray(j) || !j.length) break
      j.forEach(p => posts.push({
        wp_post_id: p.id, link: p.link,
        titulo: stripHtml(p.title && p.title.rendered),
        resumo: stripHtml(p.excerpt && p.excerpt.rendered).slice(0, 400),
        publicado_em: p.date ? new Date(p.date).toISOString() : null,
      }))
      if (j.length < 50) break
    }
    if (posts.length) return { posts, via: 'wp-json' }
  } catch (e) {}
  // fallback: RSS (títulos + links; sem id numérico — usa hash do link)
  try {
    const r = await fetch(site.base + '/feed/', { headers: cab, cache: 'no-store' })
    if (r.ok) {
      const xml = await r.text()
      const itens = xml.split('<item>').slice(1)
      itens.forEach(it => {
        const g = re => { const m = it.match(re); return m ? m[1] : '' }
        const link = stripHtml(g(/<link>([\s\S]*?)<\/link>/))
        if (!link) return
        let hash = 0; for (let i = 0; i < link.length; i++) { hash = ((hash << 5) - hash + link.charCodeAt(i)) | 0 }
        posts.push({
          wp_post_id: Math.abs(hash), link,
          titulo: stripHtml(g(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)),
          resumo: stripHtml(g(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/)).slice(0, 400),
          publicado_em: (function () { const d = g(/<pubDate>([\s\S]*?)<\/pubDate>/); const t = d ? new Date(d) : null; return (t && !isNaN(t)) ? t.toISOString() : null })(),
        })
      })
      if (posts.length) return { posts, via: 'rss' }
    }
  } catch (e) {}
  return { posts: [], via: 'nenhum' }
}

export async function GET(request) {
  const user = await usuario(request)
  if (!user) return Response.json({ erro: 'Faça login.' }, { status: 401 })
  const { searchParams } = new URL(request.url)
  if (searchParams.get('importar') === null) return Response.json({ info: 'Use ?importar=1 (GET) ou POST {acao}.' })

  const db = sbUser(request)
  const resultado = {}
  for (const [chave, site] of Object.entries(SITES)) {
    const { posts, via } = await lerPostsPublicos(site)
    const linhas = posts.filter(p => p.titulo).map(p => ({
      site: chave, wp_post_id: p.wp_post_id, titulo: p.titulo, link: p.link,
      resumo: p.resumo || null, status: 'publicado', origem: 'importado',
      publicado_em: p.publicado_em, atualizado_em: new Date().toISOString(),
    }))
    let gravados = 0, erro = null
    // grava em lotes; o erro NÃO pode ficar mudo (foi assim que a 1ª importação
    // "concluiu" sem salvar nada por causa do índice parcial)
    for (let i = 0; i < linhas.length; i += 50) {
      const up = await db.from('publicacoes')
        .upsert(linhas.slice(i, i + 50), { onConflict: 'site,wp_post_id' }).select('id')
      if (up.error) { erro = up.error.message; break }
      gravados += (up.data || []).length
    }
    resultado[chave] = { via, lidos: linhas.length, gravados, ...(erro ? { erro } : {}) }
  }
  const falhou = Object.values(resultado).find(r => r.erro)
  return Response.json({ ok: !falhou, resultado, ...(falhou ? { erro: 'Falha ao gravar: ' + falhou.erro } : {}) })
}

export async function POST(request) {
  const user = await usuario(request)
  if (!user) return Response.json({ erro: 'Faça login.' }, { status: 401 })
  let body = {}
  try { body = await request.json() } catch (e) {}
  const db = sbUser(request)

  if (body.acao === 'gerar') {
    const tema = String(body.tema || '').trim()
    if (!tema) return Response.json({ erro: 'Informe o tema.' }, { status: 400 })
    const r = await chamarClaude({
      rotina: 'publicacoes',
      sistemaFixo: SISTEMA_EDITORIAL,
      conteudo: 'TEMA DESTA PUBLICAÇÃO: ' + tema,
      maxTokens: 8000,
      sb: svc(),
    })
    if (r.erro) return Response.json({ erro: r.erro }, { status: r.status || 502 })
    let j
    try { j = JSON.parse(String(r.texto || '').replace(/^```json?\s*/i, '').replace(/```\s*$/, '')) } catch (e) {
      return Response.json({ erro: 'A IA respondeu fora do formato — tente de novo.' }, { status: 502 })
    }
    if (!j || !j.djan || !j.cmp) return Response.json({ erro: 'Resposta incompleta da IA — tente de novo.' }, { status: 502 })
    const area = j.tema_area || tema
    const ins = await db.from('publicacoes').insert([
      { site: 'djan', titulo: j.djan.titulo, conteudo_html: j.djan.html, tema: area, status: 'rascunho', origem: 'gestao' },
      { site: 'cmp', titulo: j.cmp.titulo, conteudo_html: j.cmp.html, tema: area, status: 'rascunho', origem: 'gestao' },
    ])
    if (ins.error) return Response.json({ erro: 'Gerado, mas falhou ao salvar: ' + ins.error.message }, { status: 500 })
    return Response.json({ ok: true, custo_usd: r.custoUsd, titulos: [j.djan.titulo, j.cmp.titulo] })
  }

  if (body.acao === 'publicar') {
    const { data: row, error } = await db.from('publicacoes').select('*').eq('id', String(body.id || '')).single()
    if (error || !row) return Response.json({ erro: 'Rascunho não encontrado.' }, { status: 404 })
    if (row.status === 'publicado') return Response.json({ erro: 'Este item já está publicado.' }, { status: 400 })
    const site = SITES[row.site]
    if (!site) return Response.json({ erro: 'Site inválido: ' + row.site }, { status: 400 })

    // credencial do WordPress (senha de aplicativo) — guardada em app_secrets
    const { data: sec } = await svc().from('app_secrets').select('valor').eq('chave', site.secret).maybeSingle()
    const cred = sec && sec.valor
    if (!cred || !cred.usuario || !cred.senha) {
      return Response.json({ erro: 'Falta a senha de aplicativo do ' + site.rotulo + '. Crie em wp-admin → Usuários → Perfil → Senhas de aplicativo ("CMPGestão") e me envie para eu guardar no cofre do servidor (app_secrets: ' + site.secret + ').' }, { status: 503 })
    }
    const auth = 'Basic ' + Buffer.from(cred.usuario + ':' + cred.senha).toString('base64')
    let r, j
    try {
      r = await fetch(site.base + '/wp-json/wp/v2/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: auth, 'User-Agent': 'Mozilla/5.0 (CMPGestao)' },
        body: JSON.stringify({
          title: row.titulo,
          content: row.conteudo_html || row.resumo || '',
          status: 'publish',
          excerpt: stripHtml(row.conteudo_html || '').slice(0, 200),
          ...(categoriaDe(row.tema) ? { categories: [categoriaDe(row.tema)] } : {}),
        }),
      })
      j = await r.json().catch(() => ({}))
    } catch (e) {
      return Response.json({ erro: 'Falha ao falar com o ' + site.rotulo + ': ' + ((e && e.message) || e) }, { status: 502 })
    }
    if (!r.ok || !j.id) {
      await db.from('publicacoes').update({ status: 'erro', erro: 'WP ' + r.status + ': ' + String(j && (j.message || j.code) || '').slice(0, 300), atualizado_em: new Date().toISOString() }).eq('id', row.id)
      return Response.json({ erro: 'O ' + site.rotulo + ' recusou (' + r.status + '): ' + ((j && j.message) || 'sem detalhe') }, { status: 502 })
    }
    await db.from('publicacoes').update({
      status: 'publicado', wp_post_id: j.id, link: j.link || null, erro: null,
      publicado_em: new Date().toISOString(), atualizado_em: new Date().toISOString(),
    }).eq('id', row.id)
    return Response.json({ ok: true, link: j.link, wp_post_id: j.id })
  }

  return Response.json({ erro: 'ação desconhecida' }, { status: 400 })
}
