// Onde ficam os arquivos baixados do jus.br.
//
// Até a faxina de agosto/2026 o conteúdo era gravado DENTRO do banco, em base64
// (coluna conteudo_b64). Isso estourou o Supabase: 1,3 GB numa tabela só, num
// plano de 500 MB — e base64 ainda infla o arquivo em ~33%.
//
// Agora o conteúdo vai para o disco do VPS (/opt/cmpdocs/<processo>/Autos (jus.br)/)
// e o banco guarda apenas os metadados + o caminho. A leitura aceita os dois
// formatos, então os arquivos antigos continuam abrindo enquanto a migração roda.

import fs from 'fs'
import path from 'path'

export const ROOT_DOCS = '/opt/cmpdocs'
export const SUBPASTA_JUSBR = 'Autos (jus.br)'

// nome de arquivo seguro: sem barra, sem "..", sem caractere de controle.
// Mantém acento e espaço (é o padrão do resto das pastas do sistema).
export function nomeSeguroJusbr(nome, chaveUnica) {
  let n = String(nome || '').replace(/[/\\]/g, '-').replace(/\.\.+/g, '.').replace(/[\x00-\x1f]/g, '').trim()
  if (!n || n === '.') n = 'documento'
  if (n.length > 120) {
    const ext = (n.match(/\.[a-zA-Z0-9]{1,6}$/) || [''])[0]
    n = n.slice(0, 120 - ext.length) + ext
  }
  // prefixo curto evita que dois documentos de mesmo nome se sobrescrevam
  return String(chaveUnica || '').slice(0, 8) + ' ' + n
}

// Grava o arquivo no disco e devolve o caminho. Em caso de qualquer falha
// devolve null — quem chamou decide se cai de volta para o banco (é o que
// fazemos, para nunca perder um download já pago em tempo de rede).
export function gravarNoDisco(numeroProcesso, docNome, chaveUnica, buf) {
  try {
    if (!buf || !buf.length) return null
    const chave = String(numeroProcesso || '').replace(/\D/g, '') || 'sem-processo'
    const dir = path.join(ROOT_DOCS, chave, SUBPASTA_JUSBR)
    fs.mkdirSync(dir, { recursive: true })
    const destino = path.join(dir, nomeSeguroJusbr(docNome, chaveUnica))
    // grava em temporário e renomeia: não deixa arquivo pela metade valendo
    const tmp = destino + '.parcial'
    fs.writeFileSync(tmp, buf)
    fs.renameSync(tmp, destino)
    if (fs.statSync(destino).size !== buf.length) return null
    return destino
  } catch (e) { return null }
}

// Monta os campos de conteúdo da linha de jusbr_arquivos: caminho no disco
// quando der certo; base64 no banco como plano B (raro, mas melhor que perder).
export function camposConteudo(numeroProcesso, docNome, chaveUnica, buf) {
  const destino = gravarNoDisco(numeroProcesso, docNome, chaveUnica, buf)
  if (destino) return { caminho_disco: destino, conteudo_b64: null }
  return { caminho_disco: null, conteudo_b64: buf.toString('base64') }
}

// Lê o conteúdo de uma linha, venha ela do disco ou do banco.
export function lerConteudo(linha) {
  if (!linha) return null
  if (linha.conteudo_b64) { try { return Buffer.from(linha.conteudo_b64, 'base64') } catch (e) { return null } }
  if (linha.caminho_disco) { try { return fs.readFileSync(linha.caminho_disco) } catch (e) { return null } }
  return null
}
