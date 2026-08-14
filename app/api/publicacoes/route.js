// Publicações — ponte do CMPGestão com os sites WordPress do escritório
// (djan.com.br e cmpadvogados.com.br), SEM navegador e sem tokens de IA.
//
//   GET  /api/publicacoes?importar=1   -> lê os posts públicos dos dois sites
//        (wp-json; fallback RSS) e alimenta a tabela `publicacoes` (extrato).
//   POST /api/publicacoes {acao:'publicar', id}
//        -> publica um rascunho no site escolhido via REST do WordPress, com a
//           SENHA DE APLICATIVO guardada em app_secrets (só o servidor lê):
//           chave 'wordpress_djan' / 'wordpress_cmp' = {"usuario":"...","senha":"..."}
//   POST /api/publicacoes {acao:'conteudo', id}
//        -> busca o conteúdo (título + HTML) de um post JÁ publicado direto no
//           WordPress (o extrato importado só guarda um resumo) — usada para
//           preencher o formulário de edição com o texto de verdade.
//   POST /api/publicacoes {acao:'editar', id, titulo, conteudo_html, tema}
//        -> edita direto pelo portal: se já está publicado, atualiza o post
//           no WordPress (mesma senha de aplicativo); se é rascunho, só
//           atualiza aqui mesmo (ainda não existe lá).
//
// Instagram fica DE FORA por decisão do escritório (30/07/2026).

import { createClient } from '@supabase/supabase-js'
import { chamarClaude } from '../_ia/claude.js'
import { EMBED_CHAT_HTML } from '../../../lib/embedChat.js'

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

// Notícia a partir de decisão REAL (sentença/acórdão do histórico do processo).
// Prefixo FIXO e cacheado — a decisão (variável) vai sempre depois, no conteúdo.
const SISTEMA_NOTICIA = `Você é o redator de notícias jurídicas do escritório CMP – Crispim, Mendonça e Pinheiro Advogados (João Pessoa/PB). Você recebe o inteiro teor de uma decisão judicial REAL (sentença ou acórdão) e a transforma em notícia para os sites do escritório.

ANONIMATO — REGRA MAIS IMPORTANTE (se violar, a resposta é inútil):
- NUNCA cite nomes de pessoas, empresas, marcas, advogados, juízes ou testemunhas.
- NUNCA cite o número do processo, CPF/CNPJ, endereços, matrículas, placas ou qualquer dado que identifique as partes.
- Refira-se às partes apenas pelo papel genérico: "o consumidor", "a construtora", "o trabalhador", "a empresa", "o banco", "o condomínio".
- PODE (e deve) dizer: a cidade/comarca, a vara/órgão julgador, o tribunal, a área do direito e o resultado do julgamento.
- Valores: só se não identificarem o caso; prefira arredondar ("cerca de R$ 40 mil").

Escreva DUAS versões DISTINTAS da notícia (título, abordagem e estrutura diferentes):
- Versão DJAN (site djan.com.br): público CONSUMIDOR — o que a decisão significa para quem vive situação parecida.
- Versão CMP (site cmpadvogados.com.br): público EMPRESARIAL — o que a decisão sinaliza em gestão de risco e prevenção.

REGRAS (Provimento 205/2021 da OAB): tom sóbrio, jornalístico e informativo; SEM sensacionalismo, SEM promessa de resultado, SEM "vitória do escritório", SEM captação. A notícia relata o que foi decidido e explica o direito envolvido. 350–550 palavras por versão, subtítulos <h2>, título com a cidade ou tribunal (ex.: "Justiça da Paraíba condena construtora por atraso na entrega de imóvel"). Baseie-se APENAS no que está na decisão — não invente fatos, valores nem fundamentos. Se a decisão não for definitiva, registre que ainda cabe recurso.
Encerre cada versão com: <p><em>Conteúdo informativo — caso real julgado, com os dados das partes preservados. CMP Advogados.</em></p>

FORMATO DA RESPOSTA — devolva APENAS um JSON válido, sem texto fora dele:
{"djan":{"titulo":"...","html":"<p>...</p>"},"cmp":{"titulo":"...","html":"<p>...</p>"},"tema_area":"Imobiliário|Trabalhista|Consumidor|Empresarial|Civil|Previdenciário|Tributário"}
O campo html usa apenas <p>, <h2>, <ul>, <li>, <strong>, <em>.`

// tribunal por extenso a partir do número CNJ (segmento J.TR) — dado seguro de
// citar na notícia; o número em si NUNCA vai para o texto
const UFS_TJ = { '01': 'do Acre', '02': 'de Alagoas', '03': 'do Amapá', '04': 'do Amazonas', '05': 'da Bahia', '06': 'do Ceará', '07': 'do Distrito Federal e dos Territórios', '08': 'do Espírito Santo', '09': 'de Goiás', '10': 'do Maranhão', '11': 'de Mato Grosso', '12': 'de Mato Grosso do Sul', '13': 'de Minas Gerais', '14': 'do Pará', '15': 'da Paraíba', '16': 'do Paraná', '17': 'de Pernambuco', '18': 'do Piauí', '19': 'do Rio de Janeiro', '20': 'do Rio Grande do Norte', '21': 'do Rio Grande do Sul', '22': 'de Rondônia', '23': 'de Roraima', '24': 'de Santa Catarina', '25': 'de Sergipe', '26': 'de São Paulo', '27': 'do Tocantins' }
function tribunalDoNumero(numero) {
  const m = String(numero || '').match(/\.(\d)\.(\d{2})\./)
  if (!m) return ''
  if (m[1] === '8') return UFS_TJ[m[2]] ? 'Tribunal de Justiça ' + UFS_TJ[m[2]] : ''
  if (m[1] === '5') return 'Tribunal Regional do Trabalho da ' + Number(m[2]) + 'ª Região'
  if (m[1] === '4') return 'Tribunal Regional Federal da ' + Number(m[2]) + 'ª Região'
  return ''
}

const SITES = {
  djan: { base: 'https://djan.com.br', rotulo: 'djan.com.br', secret: 'wordpress_djan' },
  cmp: { base: 'https://cmpadvogados.com.br', rotulo: 'cmpadvogados.com.br', secret: 'wordpress_cmp' },
}

function svc() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}
// credencial do WordPress (senha de aplicativo) do site — guardada em app_secrets
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

  // decisão do histórico -> notícia anonimizada (2 rascunhos, um por site)
  if (body.acao === 'noticia') {
    const texto = String(body.texto || '').trim()
    if (texto.length < 200) return Response.json({ erro: 'O texto da decisão está muito curto — abra um andamento que tenha o inteiro teor (sentença/acórdão).' }, { status: 400 })
    const numero = String(body.numero || '').trim()
    // este processo já virou notícia antes? devolve a lista pro usuário decidir
    // se gera outra mesmo assim (forcar) ou se edita/mescla o rascunho existente
    if (numero && !body.forcar) {
      const ja = await db.from('publicacoes').select('id,site,titulo,status,criado_em').eq('processo_numero', numero).order('criado_em', { ascending: false })
      if (!ja.error && (ja.data || []).length) return Response.json({ ja_existe: ja.data }, { status: 409 })
    }
    const tribunal = tribunalDoNumero(numero)
    const contexto = [
      body.orgao ? 'Órgão julgador: ' + String(body.orgao).slice(0, 200) : '',
      tribunal ? 'Tribunal: ' + tribunal : '',
      body.classe ? 'Classe processual: ' + String(body.classe).slice(0, 200) : '',
      body.assunto ? 'Assunto: ' + String(body.assunto).slice(0, 200) : '',
    ].filter(Boolean).join('\n')
    const r = await chamarClaude({
      rotina: 'publicacoes',
      sistemaFixo: SISTEMA_NOTICIA,
      conteudo: 'DADOS DO CASO (cite só o que a regra de anonimato permite):\n' + (contexto || '(sem dados extras — extraia comarca/vara do próprio teor)') + '\n\nINTEIRO TEOR DA DECISÃO:\n' + texto.slice(0, 28000),
      maxTokens: 8000,
      sb: svc(),
    })
    if (r.erro) return Response.json({ erro: r.erro }, { status: r.status || 502 })
    let j
    try { j = JSON.parse(String(r.texto || '').replace(/^```json?\s*/i, '').replace(/```\s*$/, '')) } catch (e) {
      return Response.json({ erro: 'A IA respondeu fora do formato — tente de novo.' }, { status: 502 })
    }
    if (!j || !j.djan || !j.cmp) return Response.json({ erro: 'Resposta incompleta da IA — tente de novo.' }, { status: 502 })
    // trava de anonimato: se o nº do processo escapar (com ou sem pontuação), sai daqui
    const dig = numero.replace(/\D/g, '')
    const reNum = dig.length >= 10 ? new RegExp(dig.split('').join('[\\.\\-\\s\\/]?'), 'g') : null
    const scrub = s => reNum ? String(s || '').replace(reNum, '[processo preservado]') : String(s || '')
    const area = j.tema_area || body.assunto || null
    const linhas = [
      { site: 'djan', titulo: scrub(j.djan.titulo), conteudo_html: scrub(j.djan.html), tema: area, status: 'rascunho', origem: 'gestao', processo_numero: numero || null },
      { site: 'cmp', titulo: scrub(j.cmp.titulo), conteudo_html: scrub(j.cmp.html), tema: area, status: 'rascunho', origem: 'gestao', processo_numero: numero || null },
    ]
    const ins = await db.from('publicacoes').insert(linhas).select('id,site,titulo')
    if (ins.error) return Response.json({ erro: 'Gerado, mas falhou ao salvar: ' + ins.error.message }, { status: 500 })
    return Response.json({ ok: true, custo_usd: r.custoUsd, ids: (ins.data || []).map(x => x.id), titulos: (ins.data || []).map(x => x.titulo) })
  }

  if (body.acao === 'publicar') {
    const { data: row, error } = await db.from('publicacoes').select('*').eq('id', String(body.id || '')).single()
    if (error || !row) return Response.json({ erro: 'Rascunho não encontrado.' }, { status: 404 })
    if (row.status === 'publicado') return Response.json({ erro: 'Este item já está publicado.' }, { status: 400 })
    const site = SITES[row.site]
    if (!site) return Response.json({ erro: 'Site inválido: ' + row.site }, { status: 400 })

    const auth = await credencialWP(site)
    if (!auth) {
      return Response.json({ erro: 'Falta a senha de aplicativo do ' + site.rotulo + '. Crie em wp-admin → Usuários → Perfil → Senhas de aplicativo ("CMPGestão") e me envie para eu guardar no cofre do servidor (app_secrets: ' + site.secret + ').' }, { status: 503 })
    }
    let r, j
    try {
      r = await fetch(site.base + '/wp-json/wp/v2/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: auth, 'User-Agent': 'Mozilla/5.0 (CMPGestao)' },
        body: JSON.stringify({
          title: row.titulo,
          content: (row.conteudo_html || row.resumo || '') + '\n' + EMBED_CHAT_HTML,
          status: 'publish',
          comment_status: 'closed',   // a caixa "Deixe um comentário" do tema sai, o chat entra no lugar
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

  if (body.acao === 'conteudo') {
    const { data: row, error } = await db.from('publicacoes').select('*').eq('id', String(body.id || '')).single()
    if (error || !row) return Response.json({ erro: 'Publicação não encontrada.' }, { status: 404 })
    // rascunho ainda não publicado: o texto já está aqui mesmo, não tem nada pra buscar no WP
    if (!row.wp_post_id) return Response.json({ ok: true, titulo: row.titulo, conteudo_html: row.conteudo_html || '' })
    const site = SITES[row.site]
    if (!site) return Response.json({ erro: 'Site inválido: ' + row.site }, { status: 400 })
    const auth = await credencialWP(site)
    try {
      // context=edit devolve title.raw/content.raw (o HTML de verdade, sem os filtros de exibição do tema)
      const r = await fetch(site.base + '/wp-json/wp/v2/posts/' + row.wp_post_id + '?context=edit', {
        headers: { ...(auth ? { Authorization: auth } : {}), 'User-Agent': 'Mozilla/5.0 (CMPGestao)' }, cache: 'no-store',
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) return Response.json({ erro: 'O ' + site.rotulo + ' recusou (' + r.status + '): ' + ((j && j.message) || 'sem detalhe') }, { status: 502 })
      const titulo = (j.title && (j.title.raw || j.title.rendered)) || row.titulo
      const conteudo_html = (j.content && (j.content.raw || j.content.rendered)) || row.conteudo_html || ''
      return Response.json({ ok: true, titulo, conteudo_html })
    } catch (e) {
      return Response.json({ erro: 'Falha ao buscar o conteúdo no ' + site.rotulo + ': ' + ((e && e.message) || e) }, { status: 502 })
    }
  }

  if (body.acao === 'editar') {
    const { data: row, error } = await db.from('publicacoes').select('*').eq('id', String(body.id || '')).single()
    if (error || !row) return Response.json({ erro: 'Publicação não encontrada.' }, { status: 404 })
    const titulo = String(body.titulo || '').trim()
    const conteudo_html = String(body.conteudo_html || '')
    const tema = body.tema != null ? String(body.tema).trim() : row.tema
    if (!titulo) return Response.json({ erro: 'Informe o título.' }, { status: 400 })
    // ainda é rascunho (nunca foi publicado): só atualiza aqui, não existe post no WP pra editar
    if (!row.wp_post_id) {
      const up = await db.from('publicacoes').update({ titulo, conteudo_html, tema: tema || null, atualizado_em: new Date().toISOString() }).eq('id', row.id)
      if (up.error) return Response.json({ erro: up.error.message }, { status: 500 })
      return Response.json({ ok: true })
    }
    const site = SITES[row.site]
    if (!site) return Response.json({ erro: 'Site inválido: ' + row.site }, { status: 400 })
    const auth = await credencialWP(site)
    if (!auth) return Response.json({ erro: 'Falta a senha de aplicativo do ' + site.rotulo + ' (app_secrets: ' + site.secret + ').' }, { status: 503 })
    let r, j
    try {
      r = await fetch(site.base + '/wp-json/wp/v2/posts/' + row.wp_post_id, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: auth, 'User-Agent': 'Mozilla/5.0 (CMPGestao)' },
        body: JSON.stringify({
          title: titulo, content: conteudo_html, excerpt: stripHtml(conteudo_html).slice(0, 200),
          ...(categoriaDe(tema) ? { categories: [categoriaDe(tema)] } : {}),
        }),
      })
      j = await r.json().catch(() => ({}))
    } catch (e) {
      return Response.json({ erro: 'Falha ao falar com o ' + site.rotulo + ': ' + ((e && e.message) || e) }, { status: 502 })
    }
    if (!r.ok || !j.id) return Response.json({ erro: 'O ' + site.rotulo + ' recusou (' + r.status + '): ' + ((j && j.message) || 'sem detalhe') }, { status: 502 })
    await db.from('publicacoes').update({
      titulo, conteudo_html, tema: tema || null, link: j.link || row.link, erro: null, atualizado_em: new Date().toISOString(),
    }).eq('id', row.id)
    return Response.json({ ok: true, link: j.link || row.link })
  }

  return Response.json({ erro: 'ação desconhecida' }, { status: 400 })
}
