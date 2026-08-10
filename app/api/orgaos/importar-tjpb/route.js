// Lista oficial de e-mails das unidades do TJPB → contatos_orgao.
//
//   GET  /api/orgaos/importar-tjpb              → prévia (NÃO grava): mostra o que achou
//   GET  /api/orgaos/importar-tjpb?gravar=1     → grava de verdade
//   GET  /api/orgaos/importar-tjpb?url=...      → outra página (se o TJPB mudar o endereço)
//   POST /api/orgaos/importar-tjpb {html, gravar} → a página colada à mão
//
// Por que existe: o e-mail da vara é o que faz o robô de cobrança falar com o
// cartório certo. Até aqui ele vinha de um punhado de varas cadastradas na mão
// (e de um seed no sistema.html). A lista do TJPB tem todas as unidades — puxar
// dela de uma vez cobre também as varas do interior que ninguém cadastrou.
//
// Regras de convivência com o que já está no banco:
//   • e-mail que o escritório REMOVEU (contatos_orgao_removidos, com motivo) não
//     volta — se alguém apagou porque voltava erro, o robô não desfaz isso;
//   • órgão que já existe só é tocado quando está SEM e-mail, ou quando o e-mail
//     oficial mudou; whatsapp/telefones cadastrados à mão nunca são mexidos;
//   • órgão novo entra com tribunal 'tjpb' e o link do Balcão Virtual.
//
// O parser é de propósito tolerante: a página é HTML de portal (muda de tempos
// em tempos). Ele procura o e-mail e pega como nome da unidade o texto da mesma
// linha/célula/item — em tabela, lista ou parágrafo. Por isso o padrão é PRÉVIA:
// confere-se na tela antes de deixar gravar.

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0
export const maxDuration = 120

const FONTE = 'https://www.tjpb.jus.br/e-mails-das-unidades'
const BALCAO = 'https://www.tjpb.jus.br/balcaovirtual'

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}

// Acento em página de portal vem escrito de três jeitos (&iacute;, &#237; e o
// caractere mesmo). Sem desfazer isso, "1ª Vara Cível" viraria "1 Vara C vel" e
// não casaria com nada do que já está cadastrado no banco.
const ENTIDADES = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ndash: '\u2013', mdash: '\u2014',
  ordf: 'ª', ordm: 'º', deg: '°', aacute: 'á', agrave: 'à', atilde: 'ã', acirc: 'â',
  eacute: 'é', ecirc: 'ê', egrave: 'è', iacute: 'í', icirc: 'î', oacute: 'ó',
  otilde: 'õ', ocirc: 'ô', uacute: 'ú', uuml: 'ü', ccedil: 'ç', ntilde: 'ñ',
  Aacute: 'Á', Atilde: 'Ã', Acirc: 'Â', Eacute: 'É', Ecirc: 'Ê', Iacute: 'Í',
  Oacute: 'Ó', Otilde: 'Õ', Ocirc: 'Ô', Uacute: 'Ú', Ccedil: 'Ç',
}

function desentidade(s) {
  return String(s || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, n) => (ENTIDADES[n] !== undefined ? ENTIDADES[n]
      : (ENTIDADES[n.toLowerCase()] !== undefined ? ENTIDADES[n.toLowerCase()] : ' ')))
}

function limpaTexto(h) {
  return desentidade(String(h || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t\u00a0]+/g, ' ')
    .trim()
}

// Um nome de unidade tem que parecer um nome de unidade: sem isso qualquer
// migalha de menu ("Fale conosco", "Voltar ao topo") viraria uma vara no banco.
const PALAVRAS_UNIDADE = /(vara|juizado|comarca|f[oó]rum|gabinete|cart[oó]rio|secretaria|c[aâ]mara|turma|n[uú]cleo|central|distribui|infanc|justi[çc]a\s*4|colegiado|presid[eê]ncia|corregedoria|coordenadoria|ju[ií]zo|entr[aâ]ncia|plant[ãa]o|unidade|se[çc][ãa]o|dire[çc][ãa]o|prov[ei]dor)/i

function pareceUnidade(s) {
  const t = String(s || '').trim()
  if (t.length < 6 || t.length > 200) return false
  if (/@/.test(t)) return false
  return PALAVRAS_UNIDADE.test(t)
}

// Muitas listas do TJPB vêm como "Comarca de Alhandra – 1ª Vara" ou
// "1ª Vara Cível da Capital - João Pessoa". Separa o que dá para separar; o que
// não dá fica só no nome do órgão, que é como o resto do sistema já casa.
function partirComarca(nome) {
  const t = String(nome || '').replace(/\s+/g, ' ').trim()
  let m = t.match(/^comarca\s+(?:de\s+|do\s+|da\s+)?([^–\-—:]{2,60})\s*[–\-—:]\s*(.+)$/i)
  if (m) return { comarca: m[1].trim(), orgao: m[2].trim() }
  m = t.match(/^(.+?)\s*[–\-—]\s*comarca\s+(?:de\s+|do\s+|da\s+)?(.{2,60})$/i)
  if (m) return { comarca: m[2].trim(), orgao: m[1].trim() }
  return { comarca: null, orgao: t }
}

// Extrai pares (unidade, e-mail). Vai do mais estruturado (linha de tabela,
// item de lista) para o mais solto (o texto que vem antes do e-mail).
function extrair(html) {
  const achados = []
  const vistos = new Set()
  const guarda = (nomeBruto, email) => {
    const mail = String(email || '').toLowerCase().trim().replace(/[.,;)]+$/, '')
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return
    const nome = limpaTexto(nomeBruto).replace(/\s*[-–—:]\s*$/, '').replace(/^\s*[-–—:]\s*/, '')
    if (!pareceUnidade(nome)) return
    const chave = nome.toLowerCase() + '|' + mail
    if (vistos.has(chave)) return
    vistos.add(chave)
    const { comarca, orgao } = partirComarca(nome)
    achados.push({ orgao, comarca, email: mail })
  }

  // 1) linhas de tabela: <tr><td>unidade</td><td>e-mail</td></tr>
  const linhas = String(html).match(/<tr[\s\S]*?<\/tr>/gi) || []
  for (const tr of linhas) {
    const celulas = (tr.match(/<t[dh][\s\S]*?<\/t[dh]>/gi) || []).map(limpaTexto)
    if (celulas.length < 2) continue
    const iMail = celulas.findIndex(c => /@/.test(c))
    if (iMail < 0) continue
    const mails = celulas[iMail].match(/[^\s<>"']+@[^\s<>"']+/g) || []
    // nome = a célula não-vazia mais próxima à esquerda do e-mail
    let nome = ''
    for (let i = iMail - 1; i >= 0; i--) { if (pareceUnidade(celulas[i])) { nome = celulas[i]; break } }
    if (!nome) continue
    // linha com comarca numa coluna e unidade noutra: junta as duas
    const comarcaCol = celulas.slice(0, iMail).find(c => /^comarca\b/i.test(c))
    const nomeCheio = (comarcaCol && comarcaCol !== nome) ? (comarcaCol + ' – ' + nome) : nome
    for (const m of mails) guarda(nomeCheio, m)
  }

  // 2) itens de lista / parágrafos: <li>unidade: e-mail</li>
  const itens = String(html).match(/<(li|p|div)[^>]*>[\s\S]{0,400}?<\/\1>/gi) || []
  for (const it of itens) {
    const txt = limpaTexto(it)
    const mails = txt.match(/[^\s<>"']+@[^\s<>"']+/g) || []
    if (!mails.length) continue
    for (const m of mails) {
      const antes = txt.slice(0, txt.indexOf(m))
      guarda(antes.split(/[|•·]/).pop(), m)
    }
  }

  // 3) último recurso: texto corrido — pega o trecho antes de cada e-mail
  if (!achados.length) {
    const txt = limpaTexto(html)
    const re = /([^\n@]{8,160}?)\s*[:\-–—]?\s*([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g
    let m
    while ((m = re.exec(txt))) guarda(m[1], m[2])
  }

  return achados
}

const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[ªº°]/g, '').replace(/\b(\d+)[ao]s?\b/g, '$1')
  .replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim()

async function processar({ html, gravar, sb }) {
  const achados = extrair(html)
  const soTjpb = achados.filter(a => /@tjpb\.jus\.br$/i.test(a.email))
  const fora = achados.length - soTjpb.length

  const esc = await sb.from('escritorios').select('id').order('criado_em', { ascending: true }).limit(1).single()
  if (esc.error || !esc.data) return { erro: 'escritório não encontrado', status: 500 }
  const escritorioId = esc.data.id

  const [{ data: atuais }, { data: removidos }] = await Promise.all([
    sb.from('contatos_orgao').select('id,tribunal,orgao,comarca,email').eq('escritorio_id', escritorioId),
    sb.from('contatos_orgao_removidos').select('valor').eq('escritorio_id', escritorioId),
  ])
  const vetados = new Set((removidos || []).map(r => String(r.valor || '').toLowerCase()))
  const porNome = new Map()
  ;(atuais || []).forEach(c => { if (c.orgao) porNome.set(norm(c.orgao), c) })
  const porEmail = new Map()
  ;(atuais || []).forEach(c => { if (c.email) porEmail.set(String(c.email).toLowerCase(), c) })

  const novos = [], atualizar = [], iguais = [], vetadosFora = []
  for (const a of soTjpb) {
    if (vetados.has(a.email)) { vetadosFora.push(a); continue }
    const ja = porNome.get(norm(a.orgao)) || porEmail.get(a.email)
    if (!ja) { novos.push(a); continue }
    if (!ja.email) { atualizar.push({ id: ja.id, de: null, ...a }); continue }
    if (String(ja.email).toLowerCase() !== a.email) { atualizar.push({ id: ja.id, de: ja.email, ...a }); continue }
    iguais.push(a)
  }

  const rel = {
    ok: true, fonte_itens: achados.length, do_tjpb: soTjpb.length, fora_do_dominio: fora,
    novos: novos.length, atualizados: atualizar.length, ja_iguais: iguais.length,
    vetados: vetadosFora.length, gravou: !!gravar,
  }
  if (!gravar) {
    rel.previa = true
    rel.exemplos_novos = novos.slice(0, 40)
    rel.exemplos_atualizar = atualizar.slice(0, 20).map(x => ({ orgao: x.orgao, de: x.de, para: x.email }))
    rel.exemplos_vetados = vetadosFora.slice(0, 10)
    return rel
  }

  let inseridos = 0, mexidos = 0
  for (let i = 0; i < novos.length; i += 100) {
    const lote = novos.slice(i, i + 100).map(a => ({
      escritorio_id: escritorioId, tribunal: 'tjpb', orgao: a.orgao, comarca: a.comarca,
      email: a.email, balcao_link: BALCAO,
    }))
    const r = await sb.from('contatos_orgao').insert(lote)
    if (!r.error) inseridos += lote.length
  }
  for (const u of atualizar) {
    const r = await sb.from('contatos_orgao').update({ email: u.email }).eq('id', u.id)
    if (!r.error) mexidos++
  }
  rel.inseridos = inseridos
  rel.email_corrigido = mexidos
  return rel
}

export async function GET(request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ erro: 'falta service key' }, { status: 500 })
  const { searchParams } = new URL(request.url)
  const url = searchParams.get('url') || FONTE
  const gravar = !!searchParams.get('gravar')

  let html
  try {
    const r = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; CMPGestao/1.0; +https://gestao.cmpadvogados.com.br)', accept: 'text/html' },
      cache: 'no-store',
    })
    if (!r.ok) return Response.json({ erro: 'TJPB respondeu ' + r.status, url }, { status: 502 })
    html = await r.text()
  } catch (e) {
    return Response.json({
      erro: 'não consegui abrir a página do TJPB: ' + ((e && e.message) || e),
      dica: 'se a rede do servidor bloquear o tjpb.jus.br, salve a página e mande o HTML por POST neste mesmo endereço',
      url,
    }, { status: 502 })
  }

  const rel = await processar({ html, gravar, sb: admin() })
  return Response.json(rel, { status: rel.status || 200 })
}

// A mesma coisa com a página colada à mão — serve quando o portal do TJPB
// bloqueia acesso automático (Cloudflare e afins).
export async function POST(request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ erro: 'falta service key' }, { status: 500 })
  let body = {}
  try { body = await request.json() } catch (e) {}
  const html = String(body.html || '')
  if (html.length < 200) return Response.json({ erro: 'mande o HTML da página em {html}' }, { status: 400 })
  const rel = await processar({ html, gravar: !!body.gravar, sb: admin() })
  return Response.json(rel, { status: rel.status || 200 })
}
