// Preço do que passa do maior plano.
//
// NÃO É PÚBLICO. Não entra na página de vendas, não entra em e-mail e não pode
// ser importado por componente de tela: página e painel são compilados para o
// navegador, e tudo o que eles importam vai junto no arquivo que qualquer um
// baixa. Por isso este arquivo vive no lado do servidor e o valor chega ao
// painel-mãe pela resposta de /api/escritorios, que só responde à raiz.
//
// Serve para uma conversa, não para uma tabela: quando um escritório passar do
// Full, é com esta régua que o preço é montado — sem improviso e sem depender
// de lembrar o combinado de meses atrás.

export const EXCEDENTE = {
  processo_unitario: 1,        // R$ por processo além do limite
  acesso_mensal: 10,           // R$ por acesso/mês além do limite
  gb_bloco: 100,               // o espaço é vendido em bloco de 100 GB
  gb_bloco_preco: 1000,        // R$ por bloco de 100 GB
}

// Quanto custaria, hoje, o que este escritório usa além dos limites gravados
// nele. Devolve null quando não há teto (nada a exceder) ou quando não passou.
export function calcularExcedente({ limite_processos, limite_acessos, limite_gb }, uso) {
  if (!uso) return null
  const linhas = []
  let total = 0

  const excProc = limite_processos == null ? 0 : Math.max(0, (uso.processos || 0) - limite_processos)
  if (excProc > 0) {
    const v = excProc * EXCEDENTE.processo_unitario
    linhas.push({ o_que: 'processos', quanto: excProc, valor: v })
    total += v
  }

  const excAcc = limite_acessos == null ? 0 : Math.max(0, (uso.acessos || 0) - limite_acessos)
  if (excAcc > 0) {
    const v = excAcc * EXCEDENTE.acesso_mensal
    linhas.push({ o_que: 'acessos', quanto: excAcc, valor: v })
    total += v
  }

  // Espaço é cobrado por bloco começado: meio bloco ocupado é bloco reservado
  // no disco de qualquer jeito.
  const excGb = limite_gb == null ? 0 : Math.max(0, (uso.gb || 0) - Number(limite_gb))
  if (excGb > 0) {
    const blocos = Math.ceil(excGb / EXCEDENTE.gb_bloco)
    const v = blocos * EXCEDENTE.gb_bloco_preco
    linhas.push({ o_que: 'espaço', quanto: excGb, blocos, valor: v })
    total += v
  }

  return linhas.length ? { linhas, total } : null
}
