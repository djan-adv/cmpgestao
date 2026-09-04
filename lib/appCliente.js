// Pasta "App do Cliente" — a curadoria do que o cliente enxerga no aplicativo.
//
// Pedido do dono (24/08/2026): "o cliente deve receber documentos oficiais e os
// que eu marcar para ele visualizar — e ficarem na pasta 'App do Cliente'";
// "assim eu vejo o que está na pasta do cliente".
//
// A ideia é ter UM lugar que responde "o que o cliente vê neste processo?":
//   • peça oficial baixada do jus.br (sentença, decisão, acórdão…) entra aqui
//     automaticamente, no momento em que é baixada;
//   • qualquer outro arquivo que o escritório jogue nesta pasta também passa a
//     aparecer no app — é o "marcar para o cliente ver", sem tela nova.
//
// O app continua listando as peças oficiais direto de jusbr_arquivos (nada é
// perdido nos processos antigos, anteriores a esta pasta existir); a listagem
// deduplica pelo nome para a mesma peça não aparecer duas vezes.

import fs from 'fs'
import path from 'path'
import { raizDocs } from '../app/api/_lib/inquilino.js'

export const PASTA_APP_CLIENTE = 'App do Cliente'

// Peça oficial (já pública) — o que o cliente pode ver sem curadoria manual.
// Confere com o acervo real: pega sentença, despacho, decisão, acórdão, acordo,
// homologação, ata/termo de audiência (onde o acordo é lavrado) e alvará; deixa
// de fora petição de terceiro, intimação, mandado, certidão, ato ordinatório,
// procuração. 18/08/2026: ampliado a pedido do dono — além dos atos do juízo, o
// cliente vê as peças PRINCIPAIS do próprio caso (inicial, contestação,
// réplica, recursos, laudo).
export const RE_OFICIAL = /(senten|despach|decis|ac[óo]rd|acordo|homolog|(ata|termo)\s+d[aeo]s?\s+audi|alvar|peti[çc][ãa]o inicial|contesta[çc]|r[ée]plica|embargos|apela[çc]|contrarraz|agravo|laudo)/i

export function ehOficial(nome, tipo) {
  return RE_OFICIAL.test(String(tipo || '') + ' ' + String(nome || ''))
}

// A pasta é do processo DAQUELE escritório: sem o escritório no caminho, a
// sentença de um cliente apareceria no aplicativo do cliente de outro
// escritório que tivesse processo com o mesmo número.
export function pastaAppCliente(numero, esc) {
  return path.join(raizDocs(esc), String(numero || '').replace(/\D/g, ''), PASTA_APP_CLIENTE)
}

// nome de arquivo seguro para a pasta (sem barra, sem "..", sem controle)
export function nomeSeguro(nome) {
  let n = String(nome || '').replace(/[/\\]/g, '-').replace(/\.\.+/g, '.').replace(/[\x00-\x1f:*?"<>|]/g, '').trim()
  if (!n || n === '.') n = 'documento'
  return n.slice(0, 120)
}

// Copia uma peça já baixada para a pasta do cliente. Nunca lança: é um espelho
// de conveniência — se falhar, o cliente continua vendo a peça pelo caminho
// normal (jusbr_arquivos). Não sobrescreve arquivo de mesmo nome e tamanho
// (rebaixar a mesma peça não duplica nem reescreve à toa).
export function copiarParaAppCliente(numero, docNome, buf, esc) {
  try {
    if (!buf || !buf.length) return null
    const dig = String(numero || '').replace(/\D/g, '')
    if (!dig) return null
    const dir = pastaAppCliente(dig, esc)
    const destino = path.join(dir, nomeSeguro(docNome))
    try { if (fs.statSync(destino).size === buf.length) return destino } catch (e) { /* não existe: grava */ }
    fs.mkdirSync(dir, { recursive: true })
    const tmp = destino + '.parcial'
    fs.writeFileSync(tmp, buf)
    fs.renameSync(tmp, destino)
    return destino
  } catch (e) { return null }
}
