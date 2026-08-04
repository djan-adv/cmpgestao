// Sonda: o DJEN aceita busca por CPF/CNPJ?
//
//   GET /api/djen/testa-doc?doc=33000167000101[&nome=ARCO IRIS][&dias=30]
//
// Por que isto existe. O CLAUDE.md registra que buscar parte por CPF/CNPJ no
// DJEN foi "testado e descartado — a API só aceita nome". Só que o nosso código
// NUNCA mandou parâmetro de documento: em todas as chamadas vão apenas
// `nomeParte` e `numeroProcesso`. Ou seja, a conclusão pode estar certa, mas não
// foi este robô que a produziu — e uma API pública muda com o tempo.
//
// Em vez de discutir a partir de uma nota antiga, esta rota TENTA os nomes de
// parâmetro plausíveis, um por vez, e diz o que cada um respondeu. O resultado
// resolve a questão com dado, não com memória.
//
// Não grava nada e não altera processo nenhum: é só leitura.

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0
export const maxDuration = 60

const DJEN = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao'
const UA = 'Mozilla/5.0 (compatible; CMPGestao/1.0)'
const iso = (d) => d.toISOString().slice(0, 10)

// Nomes que a Comunica já usou ou que aparecem na documentação em versões
// diferentes. Testar todos custa poucos segundos e elimina o achismo.
const CANDIDATOS = [
  'numeroDocumentoParte',
  'cpfCnpjParte',
  'documentoParte',
  'numeroDocumento',
  'cpfCnpj',
  'documento',
]

function soDigitos(v) { return String(v == null ? '' : v).replace(/\D/g, '') }

async function tenta(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(15000) })
    const txt = await r.text()
    let j = null
    try { j = JSON.parse(txt) } catch (e) {}
    const itens = (j && (j.items || j.content || j.dados)) || (Array.isArray(j) ? j : null)
    return {
      http: r.status,
      ok: r.ok,
      itens: Array.isArray(itens) ? itens.length : null,
      // um pedaço do corpo ajuda a ver "parâmetro ignorado" x "parâmetro rejeitado"
      amostra: txt.slice(0, 220),
    }
  } catch (e) {
    return { http: 0, ok: false, erro: String((e && e.message) || e) }
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const doc = soDigitos(searchParams.get('doc') || '')
  const nome = (searchParams.get('nome') || '').trim()
  const dias = Math.max(1, Math.min(90, parseInt(searchParams.get('dias') || '30', 10) || 30))

  if (!doc) return Response.json({ erro: 'informe ?doc=<CPF ou CNPJ>' }, { status: 400 })

  const fim = new Date()
  const ini = new Date(fim.getTime() - dias * 86400000)
  const janela = `dataDisponibilizacaoInicio=${iso(ini)}&dataDisponibilizacaoFim=${iso(fim)}`

  const rel = { doc, dias, janela: { de: iso(ini), ate: iso(fim) }, testes: [] }

  // 1) Referência: a busca por NOME, que é a que o robô usa hoje. Sem ela não dá
  //    para interpretar o resto — se o nome também vier vazio, o período é que
  //    não tem publicação, e nenhum parâmetro de documento pareceria funcionar.
  if (nome) {
    const r = await tenta(`${DJEN}?${janela}&nomeParte=${encodeURIComponent(nome)}&itensPorPagina=5`)
    rel.testes.push(Object.assign({ parametro: 'nomeParte (referência, é o que usamos hoje)', valor: nome }, r))
  }

  // 2) Um por vez, os candidatos a parâmetro de documento
  for (const p of CANDIDATOS) {
    const r = await tenta(`${DJEN}?${janela}&${p}=${encodeURIComponent(doc)}&itensPorPagina=5`)
    rel.testes.push(Object.assign({ parametro: p, valor: doc }, r))
  }

  // Leitura do resultado, para não sobrar interpretação ao usuário.
  const comItens = rel.testes.filter(t => t.parametro !== 'nomeParte (referência, é o que usamos hoje)' && t.itens > 0)
  const refe = rel.testes.find(t => String(t.parametro).startsWith('nomeParte'))
  rel.veredito = comItens.length
    ? ('FUNCIONA por documento: ' + comItens.map(t => t.parametro + ' (' + t.itens + ' item(ns))').join(', '))
    : (nome && refe && refe.itens > 0
        ? 'Nenhum parâmetro de documento trouxe resultado, e a busca por NOME trouxe — então o DJEN realmente não filtra por CPF/CNPJ, e a nota do CLAUDE.md está certa.'
        : 'Nada voltou em nenhum caminho. Inconclusivo: pode ser que não haja publicação neste período. Repita passando &nome=<nome da parte> para ter referência.')

  return Response.json(rel)
}
