// Busca de processos por NOME DA PARTE no Diário de Justiça Eletrônico Nacional
// (DJEN/Comunica, do CNJ) — UMA fonte só.
//
// Por que por nome, e não por CPF/CNPJ: a API pública do CNJ **não aceita**
// documento, só `nomeParte`. Isso já foi testado e descartado no projeto; o
// CPF/CNPJ serve para identificar e responsabilizar quem pede, e para a
// cobrança — a consulta em si é sempre pelo nome. Consequência que precisa
// estar escrita na tela de quem usa: homônimo aparece.
//
// Estava copiada em monitoramento/route.js e monitoramento/robo/route.js, com
// diferenças pequenas entre as cópias.

const DJEN = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao'
const UA = 'Mozilla/5.0 (compatible; CMPGestao/1.0)'
const MAX_PAGINAS = 10

export function soDig(s) { return String(s || '').replace(/\D/g, '') }
function iso(d) { return new Date(d).toISOString().slice(0, 10) }

/**
 * Processos com publicação no período, agrupados por número (fica a publicação
 * mais recente de cada um), do mais novo para o mais antigo.
 * @param {string} nome  nome da parte, como sai no diário
 * @param {number} dias  janela de busca para trás (ex.: 365)
 * @param {{resumo?:number}} [op] tamanho do trecho de texto devolvido
 */
export async function buscaDjenPorNome(nome, dias, op) {
  const corte = (op && op.resumo) || 200
  const alvo = String(nome || '').trim()
  if (!alvo) return []
  const fim = new Date(), ini = new Date(Date.now() - dias * 86400000)
  const base = `${DJEN}?nomeParte=${encodeURIComponent(alvo)}&dataDisponibilizacaoInicio=${iso(ini)}&dataDisponibilizacaoFim=${iso(fim)}&meio=D`
  let itens = [], pagina = 1
  while (pagina <= MAX_PAGINAS) {
    let r
    try { r = await fetch(`${base}&pagina=${pagina}&itensPorPagina=100`, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(25000) }) }
    catch (e) { break }
    if (!r.ok) break
    const d = await r.json().catch(() => ({}))
    const lote = d.items || d.content || d.comunicacoes || []
    if (!lote.length) break
    itens = itens.concat(lote)
    if (lote.length < 100) break
    pagina++
  }
  const por = {}
  for (const p of itens) {
    const dig = soDig(p.numeroProcesso || p.numero_processo || p.numero)
    if (dig.length < 16) continue
    const data = String(p.dataDisponibilizacao || p.data_disponibilizacao || '').slice(0, 10)
    const trib = p.siglaTribunal || p.sigla_tribunal || ''
    const texto = String(p.texto || p.teor || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    if (!por[dig] || data > por[dig].data) por[dig] = { numero: dig, tribunal: trib, data, resumo: texto.slice(0, corte) }
  }
  return Object.values(por).sort((a, b) => String(b.data).localeCompare(String(a.data)))
}

/* CPF e CNPJ conferidos pelos dígitos verificadores. Não prova que o documento
   é de quem digitou — isso é a declaração de responsabilidade —, mas impede que
   número inventado gaste uma das buscas e vire linha no registro. */
export function cpfValido(v) {
  const d = soDig(v)
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false
  for (const [ate, pos] of [[9, 10], [10, 11]]) {
    let soma = 0
    for (let i = 0; i < ate; i++) soma += parseInt(d[i], 10) * (pos - i)
    let dv = (soma * 10) % 11
    if (dv === 10) dv = 0
    if (dv !== parseInt(d[ate], 10)) return false
  }
  return true
}
export function cnpjValido(v) {
  const d = soDig(v)
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false
  const pesos = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  for (const ate of [12, 13]) {
    const p = pesos.slice(13 - ate)
    let soma = 0
    for (let i = 0; i < ate; i++) soma += parseInt(d[i], 10) * p[i]
    const resto = soma % 11
    const dv = resto < 2 ? 0 : 11 - resto
    if (dv !== parseInt(d[ate], 10)) return false
  }
  return true
}
export function docValido(v) {
  const d = soDig(v)
  return d.length === 14 ? cnpjValido(d) : cpfValido(d)
}
