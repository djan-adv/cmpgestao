// Ler a planilha que o escritório trouxe do sistema antigo.
//
// Quem vende para quem já usa outro sistema de gestão (ou uma planilha de controle)
// esbarra sempre na mesma porta: o acervo já existe, e ninguém redigita mil
// processos. Este arquivo é a parte chata disso — abrir CSV e XLSX de origens
// que não combinaram nada entre si, e adivinhar o que cada coluna significa.
//
// Três teimosias do mundo real estão tratadas aqui, e cada uma já quebrou
// importação de alguém:
//   - CSV brasileiro sai com ponto-e-vírgula, não com vírgula;
//   - exportação de sistema velho vem em windows-1252, e lida como UTF-8 vira
//     "JoÃ£o"; gravar isso no banco é pior do que não importar;
//   - data em planilha pode chegar como texto (31/12/2025), como Date (XLSX) ou
//     como número de série do Excel (45657). As três precisam virar a mesma coisa.
//
// Nada aqui grava: só interpreta. Quem decide o que fazer com o resultado é a
// rota, depois que o advogado conferiu na tela.

import ExcelJS from 'exceljs'

// ---------------------------------------------------------------------------
// Campos de destino. É a lista fechada do que a migração sabe preencher — o que
// não estiver aqui, o advogado deixa em "não importar" e resolve depois.
export const CAMPOS = [
  { chave: 'numero', rotulo: 'Número do processo', obrigatorio: true,
    sin: ['numero do processo', 'n do processo', 'no do processo', 'numero cnj', 'processo cnj', 'cnj', 'processo', 'numero', 'num processo', 'codigo do processo'] },
  { chave: 'cliente_nome', rotulo: 'Cliente',
    sin: ['cliente', 'nome do cliente', 'clientes', 'autor', 'requerente', 'exequente', 'reclamante', 'parte'] },
  { chave: 'oponente', rotulo: 'Parte contrária',
    sin: ['parte contraria', 'parte adversa', 'adverso', 'adversa', 'oponente', 'reu', 'requerido', 'executado', 'reclamado', 'contrario'] },
  { chave: 'classe', rotulo: 'Classe / ação',
    sin: ['classe', 'classe judicial', 'acao', 'tipo de acao', 'tipo de processo', 'natureza'] },
  { chave: 'assunto', rotulo: 'Assunto',
    sin: ['assunto', 'assunto principal', 'materia', 'area', 'area de atuacao', 'especialidade'] },
  { chave: 'orgao', rotulo: 'Órgão julgador / vara',
    sin: ['orgao julgador', 'vara', 'juizo', 'orgao', 'unidade judiciaria', 'serventia'] },
  { chave: 'foro', rotulo: 'Foro / comarca',
    sin: ['foro', 'comarca', 'tribunal', 'justica', 'seccional'] },
  { chave: 'fase', rotulo: 'Fase',
    sin: ['fase', 'fase processual', 'etapa', 'instancia', 'grau'] },
  { chave: 'status', rotulo: 'Situação',
    sin: ['situacao', 'status', 'estado', 'situacao do processo'] },
  { chave: 'responsavel', rotulo: 'Responsável',
    sin: ['responsavel', 'advogado responsavel', 'advogado', 'profissional', 'titular'] },
  { chave: 'valor_causa', rotulo: 'Valor da causa', tipo: 'numero',
    sin: ['valor da causa', 'valor causa', 'valor'] },
  { chave: 'distribuido_em', rotulo: 'Distribuição', tipo: 'data',
    sin: ['data de distribuicao', 'distribuicao', 'distribuido em', 'data distribuicao', 'ajuizamento', 'data de ajuizamento', 'data de cadastro'] },
  { chave: 'ultima_movimentacao', rotulo: 'Última movimentação', tipo: 'data',
    sin: ['ultima movimentacao', 'data da ultima movimentacao', 'ultimo andamento', 'data do ultimo andamento', 'ultima atualizacao'] },
  { chave: 'hon_pct_contratual', rotulo: 'Honorários contratuais (%)', tipo: 'numero',
    sin: ['honorarios contratuais', 'percentual de honorarios', 'percentual', 'honorarios'] },
  { chave: 'observacoes', rotulo: 'Observações',
    sin: ['observacoes', 'observacao', 'anotacoes', 'descricao', 'detalhes', 'notas', 'pasta'] },
  { chave: 'cliente_cpf_cnpj', rotulo: 'CPF/CNPJ do cliente',
    sin: ['cpf cnpj', 'cpf/cnpj', 'cpf', 'cnpj', 'documento', 'doc', 'cpf do cliente'] },
  { chave: 'cliente_email', rotulo: 'E-mail do cliente',
    sin: ['email do cliente', 'e mail', 'email', 'correio eletronico'] },
  { chave: 'cliente_telefone', rotulo: 'Telefone do cliente',
    sin: ['telefone do cliente', 'telefone', 'telefones', 'celular', 'fone', 'whatsapp', 'contato'] },
]

// campos que não moram na tabela de processos: viram/atualizam o contato
export const CAMPOS_CONTATO = ['cliente_cpf_cnpj', 'cliente_email', 'cliente_telefone']

export function campoPorChave(c) {
  return CAMPOS.find(f => f.chave === c) || null
}

// ---------------------------------------------------------------------------
export function normalizar(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // tira acento
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Adivinha o destino de cada coluna pelo nome do cabeçalho.
//
// É palpite, e a tela mostra como palpite: o advogado confere e troca. Errar
// calado seria muito pior do que não adivinhar — um "valor" que caísse em
// honorários viraria número errado em mil fichas.
export function sugerirMapa(colunas) {
  const mapa = {}
  const usados = new Set()
  const norm = colunas.map(normalizar)

  // 1ª passada: nome do cabeçalho igual a um sinônimo (o caso limpo)
  CAMPOS.forEach(campo => {
    if (usados.has(campo.chave)) return
    for (const sin of campo.sin) {
      const i = norm.findIndex((n, idx) => n === sin && mapa[idx] === undefined)
      if (i >= 0) { mapa[i] = campo.chave; usados.add(campo.chave); return }
    }
  })
  // 2ª passada: cabeçalho CONTÉM o sinônimo ("nº do processo (CNJ)")
  CAMPOS.forEach(campo => {
    if (usados.has(campo.chave)) return
    for (const sin of campo.sin) {
      if (sin.length < 4) continue   // pedaço curto casa com qualquer coisa
      const i = norm.findIndex((n, idx) => mapa[idx] === undefined && n.indexOf(sin) >= 0)
      if (i >= 0) { mapa[i] = campo.chave; usados.add(campo.chave); return }
    }
  })
  return mapa
}

// ---------------------------------------------------------------------------
// Texto do arquivo, com a codificação certa.
//
// UTF-8 é a aposta; se o arquivo não for UTF-8 válido, o decodificador estrito
// avisa e caímos para windows-1252, que é o que sai de exportação de sistema
// antigo no Brasil. Sem o modo estrito, o erro passaria silenciosamente e o
// acervo entraria com acento quebrado.
function texto(buf) {
  let b = buf
  if (b.length >= 3 && b[0] === 0xEF && b[1] === 0xBB && b[2] === 0xBF) b = b.subarray(3)  // BOM
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b)
  } catch (e) {
    try { return new TextDecoder('windows-1252').decode(b) } catch (e2) { return Buffer.from(b).toString('latin1') }
  }
}

// O separador é o que mais aparece FORA das aspas na primeira linha. Contar no
// texto inteiro erraria em planilha com muita vírgula dentro de campo citado.
function separador(txt) {
  const linha = txt.split(/\r?\n/)[0] || ''
  let aspas = false
  const c = { ';': 0, ',': 0, '\t': 0 }
  for (const ch of linha) {
    if (ch === '"') { aspas = !aspas; continue }
    if (!aspas && ch in c) c[ch]++
  }
  if (c['\t'] > c[';'] && c['\t'] > c[',']) return '\t'
  return c[';'] >= c[','] ? ';' : ','
}

// CSV de verdade: aspas, aspas duplicadas ("") e quebra de linha DENTRO do campo
// (observação de processo tem parágrafo, e isso quebrava o split ingênuo).
function lerCSV(txt) {
  const sep = separador(txt)
  const linhas = []
  let campo = '', linha = [], aspas = false
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i]
    if (aspas) {
      if (ch === '"') {
        if (txt[i + 1] === '"') { campo += '"'; i++ } else aspas = false
      } else campo += ch
      continue
    }
    if (ch === '"') { aspas = true; continue }
    if (ch === sep) { linha.push(campo); campo = ''; continue }
    if (ch === '\r') continue
    if (ch === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = ''; continue }
    campo += ch
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha) }
  return linhas
}

async function lerXLSX(buf) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  const ws = wb.worksheets.find(w => w.state !== 'hidden') || wb.worksheets[0]
  if (!ws) return []
  const linhas = []
  ws.eachRow({ includeEmpty: false }, row => {
    const vals = []
    const n = Math.max(row.cellCount, ws.columnCount || 0)
    for (let c = 1; c <= n; c++) vals.push(valorCelula(row.getCell(c).value))
    linhas.push(vals)
  })
  return linhas
}

// A célula do exceljs pode vir como objeto (fórmula, link, texto rico). O que
// interessa é sempre o valor exibido.
function valorCelula(v) {
  if (v == null) return ''
  if (v instanceof Date) return v
  if (typeof v === 'object') {
    if ('text' in v) return String(v.text)
    if ('result' in v) return v.result == null ? '' : v.result
    if ('richText' in v) return (v.richText || []).map(t => t.text).join('')
    if ('hyperlink' in v) return String(v.text || v.hyperlink || '')
    return ''
  }
  return v
}

// ---------------------------------------------------------------------------
// Abre o arquivo e devolve { colunas, linhas }.
//
// O cabeçalho nem sempre é a linha 1: exportação costuma trazer título do
// relatório e uma linha em branco antes. Pega-se como cabeçalho a primeira
// linha com pelo menos duas células preenchidas.
export async function lerPlanilha(buf, nome) {
  const ext = String(nome || '').toLowerCase().split('.').pop()
  let linhas
  if (ext === 'xlsx' || ext === 'xlsm') linhas = await lerXLSX(buf)
  else linhas = lerCSV(texto(buf))

  let ini = linhas.findIndex(l => l.filter(c => String(c == null ? '' : c).trim() !== '').length >= 2)
  if (ini < 0) ini = 0
  const cab = (linhas[ini] || []).map(c => String(c == null ? '' : c).trim())
  // colunas vazias no fim são ruído de exportação
  let ult = cab.length
  while (ult > 0 && !cab[ult - 1]) ult--

  const colunas = cab.slice(0, ult).map((c, i) => c || ('Coluna ' + (i + 1)))
  const corpo = linhas.slice(ini + 1)
    .map(l => l.slice(0, ult))
    .filter(l => l.some(c => String(c == null ? '' : c).trim() !== ''))
  return { colunas, linhas: corpo }
}

// ---------------------------------------------------------------------------
// Conversões

export function soDigitos(v) { return String(v == null ? '' : v).replace(/\D/g, '') }

// Número CNJ tem 20 dígitos e uma máscara própria. Guardar mascarado é o que o
// resto do sistema espera ver na tela; guardar os dígitos é o que identifica o
// processo (a chave única do escritório é por dígitos).
export function mascaraCNJ(dig) {
  if (dig.length !== 20) return null
  return dig.slice(0, 7) + '-' + dig.slice(7, 9) + '.' + dig.slice(9, 13) + '.' +
         dig.slice(13, 14) + '.' + dig.slice(14, 16) + '.' + dig.slice(16, 20)
}

export function paraTexto(v) {
  if (v == null) return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  const s = String(v).trim()
  return s === '' ? null : s
}

// Data em três formatos possíveis, sempre saindo como AAAA-MM-DD.
export function paraData(v) {
  if (v == null || v === '') return null
  if (v instanceof Date) return isNaN(v) ? null : v.toISOString().slice(0, 10)
  const s = String(v).trim()

  // número de série do Excel (dias desde 30/12/1899)
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(parseFloat(s)) * 86400000)
    return isNaN(d) ? null : d.toISOString().slice(0, 10)
  }
  let m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/)   // 31/12/2025
  if (m) {
    let ano = parseInt(m[3], 10)
    if (ano < 100) ano += ano < 50 ? 2000 : 1900
    const mes = parseInt(m[2], 10), dia = parseInt(m[1], 10)
    if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null
    return ano + '-' + String(mes).padStart(2, '0') + '-' + String(dia).padStart(2, '0')
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)                        // 2025-12-31
  if (m) return m[1] + '-' + m[2] + '-' + m[3]
  return null
}

// "R$ 1.234,56" -> 1234.56 ; "20%" -> 20 ; "1.234" -> 1234
export function paraNumero(v) {
  if (v == null || v === '') return null
  if (typeof v === 'number') return isFinite(v) ? v : null
  let s = String(v).trim().replace(/[R$\s%]/gi, '')
  if (!s) return null
  const neg = /^\(.*\)$/.test(s) || s.startsWith('-')
  s = s.replace(/[()\-]/g, '')
  const temPonto = s.includes('.'), temVirgula = s.includes(',')
  if (temPonto && temVirgula) {
    // o último separador que aparece é o decimal
    s = s.lastIndexOf(',') > s.lastIndexOf('.')
      ? s.replace(/\./g, '').replace(',', '.')
      : s.replace(/,/g, '')
  } else if (temVirgula) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else if (temPonto) {
    // "1.234" é mil duzentos e trinta e quatro; "1.5" é um e meio
    const dep = s.split('.').pop()
    if (s.split('.').length > 2 || (dep.length === 3 && s.split('.')[0].length <= 3)) s = s.replace(/\./g, '')
  }
  const n = parseFloat(s)
  if (!isFinite(n)) return null
  return neg ? -n : n
}

// ---------------------------------------------------------------------------
export function textoCurto(v) {
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v == null ? '' : v)
  return s.length > 120 ? s.slice(0, 117) + '…' : s
}

// Converte a planilha inteira segundo o mapa e separa o que serve do que não
// serve. Não toca no banco — é a mesma função que alimenta a conferência e a
// importação, para que o que foi conferido seja exatamente o que é gravado.
export function converter(planilha, mapa) {
  const bons = []
  const recusadas = []
  const vistos = new Map()   // numero_digitos -> linha onde apareceu primeiro

  planilha.linhas.forEach((linha, idx) => {
    const nLinha = idx + 2   // +1 do cabeçalho, +1 porque planilha conta do 1
    const cru = {}
    for (const [col, campo] of Object.entries(mapa)) {
      if (!campo) continue
      cru[campo] = linha[Number(col)]
    }

    const bruto = paraTexto(cru.numero)
    const dig = soDigitos(bruto)
    if (!bruto) {
      recusadas.push({ linha: nLinha, motivo: 'sem número de processo', amostra: resumoLinha(cru) })
      return
    }
    if (dig.length < 6) {
      recusadas.push({ linha: nLinha, motivo: 'número sem dígitos suficientes ("' + textoCurto(bruto) + '")', amostra: resumoLinha(cru) })
      return
    }
    if (vistos.has(dig)) {
      recusadas.push({ linha: nLinha, motivo: 'repetido na própria planilha (já veio na linha ' + vistos.get(dig) + ')', amostra: resumoLinha(cru) })
      return
    }
    vistos.set(dig, nLinha)

    const p = { numero: dig.length === 20 ? mascaraCNJ(dig) : bruto, numero_digitos: dig }
    for (const campo of Object.keys(cru)) {
      if (campo === 'numero' || CAMPOS_CONTATO.includes(campo)) continue
      const def = campoPorChave(campo)
      if (!def) continue
      let v
      if (def.tipo === 'data') v = paraData(cru[campo])
      else if (def.tipo === 'numero') v = paraNumero(cru[campo])
      else v = paraTexto(cru[campo])
      if (v !== null && v !== undefined && v !== '') p[campo] = v
    }

    const contato = {
      nome: paraTexto(cru.cliente_nome),
      cpf_cnpj: soDigitos(cru.cliente_cpf_cnpj) || null,
      email: paraTexto(cru.cliente_email),
      telefone: paraTexto(cru.cliente_telefone),
    }
    bons.push({ linha: nLinha, p, contato })
  })

  return { bons, recusadas }
}

function resumoLinha(cru) {
  return textoCurto(cru.cliente_nome || cru.oponente || cru.classe || '')
}
