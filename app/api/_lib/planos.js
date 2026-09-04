// Catálogo de planos.
//
// Fica no código porque é a oferta do dono do sistema, igual para todos — e não
// dado de inquilino. Mas os limites são COPIADOS para o escritório no momento
// da contratação: quem assinou o Full de hoje continua com o Full de hoje
// quando o Full de amanhã for outro. É isso que permite subir preço e mexer na
// oferta sem mexer em contrato antigo, e sem exceção escrita no código.
//
// `preco_mensal` é o preço DE TABELA — o que a página de vendas anuncia e o que
// o painel sugere ao contratar. O que o escritório realmente paga continua sendo
// `mensalidade`, gravada nele: é ela que permite desconto, cortesia e o preço
// antigo de quem entrou antes de a tabela subir. Mudar o número aqui muda a
// oferta de amanhã, nunca o contrato de ontem.

export const PLANOS = [
  {
    codigo: 'full',
    preco_mensal: 3000,
    nome: 'Full',
    limite_processos: 10000,
    limite_acessos: 100,
    limite_gb: 10,
    resumo: 'Sistema inteiro, sem restrição de módulo.',
  },
  {
    codigo: 'intermediario',
    preco_mensal: 1500,
    nome: 'Intermediário',
    limite_processos: 5000,
    limite_acessos: 50,
    limite_gb: 5,
    resumo: 'Metade dos limites do Full.',
  },
  {
    codigo: 'starter',
    preco_mensal: 700,
    nome: 'Starter',
    limite_processos: 2500,
    limite_acessos: 25,
    limite_gb: 2.5,
    resumo: 'Metade dos limites do Intermediário. Entrada para escritório pequeno.',
  },
]

export function plano(codigo) {
  return PLANOS.find(p => p.codigo === String(codigo || '').toLowerCase()) || null
}

// Os limites que devem ser gravados no escritório ao contratar/mudar de degrau.
export function limitesDoPlano(codigo) {
  const p = plano(codigo)
  if (!p) return null
  return {
    plano_codigo: p.codigo,
    // mensalidade NÃO entra aqui de propósito: esta função é chamada toda vez
    // que o degrau muda, e devolver o preço de tabela junto apagaria em silêncio
    // o desconto de quem negociou. Quem decide o valor é o painel.
    limite_processos: p.limite_processos,
    limite_acessos: p.limite_acessos,
    limite_gb: p.limite_gb,
  }
}
