// Catálogo de planos.
//
// Fica no código porque é a oferta do dono do sistema, igual para todos — e não
// dado de inquilino. Mas os limites são COPIADOS para o escritório no momento
// da contratação: quem assinou o Full de hoje continua com o Full de hoje
// quando o Full de amanhã for outro. É isso que permite subir preço e mexer na
// oferta sem mexer em contrato antigo, e sem exceção escrita no código.
//
// `preco_mensal` é o preço DE LANÇAMENTO — o que a página de vendas anuncia hoje
// e o que o painel sugere ao contratar. `preco_cheio` é o valor de tabela que
// passa a valer quando o lançamento acabar; a página mostra os dois, para o
// desconto ser verificável em vez de adjetivo. O que o escritório realmente paga continua sendo
// `mensalidade`, gravada nele: é ela que permite desconto, cortesia e o preço
// antigo de quem entrou antes de a tabela subir. Mudar o número aqui muda a
// oferta de amanhã, nunca o contrato de ontem.

export const PLANOS = [
  {
    codigo: 'full',
    preco_cheio: 10000,
    preco_mensal: 3000,
    nome: 'Full',
    limite_processos: 10000,
    limite_acessos: 100,
    limite_gb: 10,
    resumo: 'Sistema inteiro, sem restrição de módulo.',
  },
  {
    codigo: 'intermediario',
    preco_cheio: 5000,
    preco_mensal: 1500,
    nome: 'Intermediário',
    limite_processos: 5000,
    limite_acessos: 50,
    limite_gb: 5,
    resumo: 'Metade dos limites do Full.',
  },
  {
    codigo: 'starter',
    preco_cheio: 2300,
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

// ————— período de teste —————
//
// Não se escolhe plano para testar: testa-se o sistema INTEIRO. O plano é
// escolhido na hora de contratar, e aí os limites sobem — sem que nada tenha
// sido apagado no caminho. O que o teste limita é tamanho, não função.
//
// Os números existem para proteger o disco e o banco de todos os outros: um
// teste que traga um acervo inteiro consumiria sozinho o que sustenta os
// clientes que pagam.
export const DIAS_TESTE = 30

// Depois de o teste vencer, o acesso para mas os robôs continuam COLETANDO por
// este tanto de dias. É o que impede o fim do teste de virar prazo perdido:
// quem contratar depois encontra o histórico do período inteiro no lugar.
export const DIAS_CARENCIA_COLETA = 10

export const LIMITES_TESTE = {
  limite_acessos: 10,
  limite_processos: 200,
  limite_gb: 1,
  // Teto de IA do período, em reais. O teste dá acesso às rotinas de IA
  // (Estagiário, Secretária, suporte), e elas custam dinheiro de verdade a
  // cada rodada — sem teto próprio, um teste consome o orçamento de IA da casa
  // inteira. Este valor é custo de aquisição, não prejuízo.
  ia_teto_brl: 30,
}

// A data em que um teste começado hoje vence.
export function fimDoTeste(dias) {
  const d = new Date()
  d.setDate(d.getDate() + (Number(dias) || DIAS_TESTE))
  return d.toISOString().slice(0, 10)
}

// Quantos dias faltam para a data (negativo = já venceu). Conta em dias de
// calendário, não em horas: "falta 1 dia" tem de valer o dia inteiro.
export function diasAte(data) {
  if (!data) return null
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0)
  const alvo = new Date(String(data) + 'T00:00:00'); alvo.setHours(0, 0, 0, 0)
  return Math.round((alvo - hoje) / 86400000)
}
