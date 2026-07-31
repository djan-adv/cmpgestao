// Leitura de planilha (.xlsx moderno e .csv) no servidor, pra virar texto que a
// IA consegue ler igual a um documento comum — usado por /api/ler-lead,
// /api/captura e /api/peticao (minuta), que hoje só liam PDF/imagem.
//
// Usa "exceljs" (sem CVEs conhecidas) — NÃO o pacote "xlsx" do npm, que parou
// em 0.18.5 e tem prototype pollution + ReDoS conhecidos e sem correção ali
// (a SheetJS migrou as versões corrigidas pra CDN própria deles).
//
// .xls (binário antigo) não é lido aqui — o exceljs só entende o formato
// moderno (.xlsx); esse formato legado é raro hoje e fica sem suporte server-side
// (no navegador, o leitor de planilha do sistema usa a SheetJS e lê os dois).

import ExcelJS from 'exceljs'

export function ehPlanilha(nomeOuMime) {
  return /\.(xlsx|csv)$/i.test(String(nomeOuMime || '')) || /spreadsheet|\bcsv\b/i.test(String(nomeOuMime || ''))
}

function celulaTexto(v) {
  if (v == null) return ''
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((t) => t.text || '').join('')
    if (v.text != null) return String(v.text)
    if (v.result != null) return String(v.result)
    if (v instanceof Date) return v.toLocaleDateString('pt-BR')
    return ''
  }
  return String(v)
}

// devolve o texto (CSV por aba) de um .xlsx/.csv, ou '' se não conseguir ler
export async function lerPlanilhaTexto(buf, nomeArquivo) {
  try {
    if (/\.csv$/i.test(String(nomeArquivo || ''))) return buf.toString('utf8')
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf)
    const partes = []
    wb.eachSheet((sheet) => {
      const linhas = []
      sheet.eachRow({ includeEmpty: false }, (row) => {
        const valores = (row.values || []).slice(1).map(celulaTexto)
        if (valores.some((v) => v !== '')) linhas.push(valores.join(','))
      })
      if (linhas.length) partes.push('=== aba: ' + sheet.name + ' ===\n' + linhas.join('\n'))
    })
    return partes.join('\n\n')
  } catch (e) { return '' }
}
