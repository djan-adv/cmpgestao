// Núcleo compartilhado da leitura de MOVIMENTOS do jus.br / PDPJ.
//
// Duas rotas usam exatamente a mesma leitura e não podem divergir:
//   - ../route.js         -> POST por clique no botão "↻ atualizar" da ficha
//   - ./robo/route.js     -> robô diário do cron, que varre os ativos sozinho
//
// O DJEN só publica intimações. Movimento interno do juízo ("Conclusos para
// despacho", "Juntada de Petição") só existe na consulta do PDPJ — foi por isso
// que o 0863182-07.2024.8.15.2001 ficou com o histórico parado em 26/02
// enquanto o jus.br já mostrava conclusão em 30/07: ninguém tinha clicado no
// botão. Daí o robô.

import { ehFaltaDeAcessoAoProcesso } from '../lib.js'

export const PDPJ = 'https://portaldeservicos.pdpj.jus.br'
export const PDPJ_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'Origin': 'https://portaldeservicos.pdpj.jus.br',
  'Referer': 'https://portaldeservicos.pdpj.jus.br/consulta/autosdigitais',
}

// ——— varredura robusta: acha arrays de "movimentos" sem saber o nome do campo ———
// O JSON do PDPJ muda de tribunal para tribunal; procurar pelo nome exato do
// campo quebra a cada grau novo. Aqui procuramos pelo FORMATO: array cuja
// maioria dos itens tenha algo que pareça data e algo que pareça descrição.
function pareceMov(o) {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false
  const keys = Object.keys(o).map(k => k.toLowerCase())
  const temData = keys.some(k => /data|datahora|dtmov|dt_mov|date|dtdispon/.test(k))
  const temTexto = keys.some(k => /descri|nome|movimento|complement|titulo|texto|tipo/.test(k))
  return temData && temTexto
}
// Guardamos também sob QUAL chave o array apareceu. Sem isso não dá para
// distinguir o array de movimentos do array de documentos — os dois têm data e
// descrição, e pareceMov aceita os dois.
function coletaArraysMov(node, out, prof, chave) {
  if (prof > 7 || !node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    const bons = node.filter(pareceMov).length
    if (node.length && bons >= Math.max(1, Math.floor(node.length * 0.5))) out.push({ chave: chave || '', itens: node })
    for (const x of node) coletaArraysMov(x, out, prof + 1, chave)
    return
  }
  for (const k of Object.keys(node)) coletaArraysMov(node[k], out, prof + 1, k)
}

export function pega(o, res) {
  for (const cam of res) {
    const partes = cam.split('.')
    let v = o
    for (const p of partes) { v = v && v[p] }
    if (v != null && v !== '') return v
  }
  return null
}

export function normMov(m) {
  if (!m || typeof m !== 'object') return null
  const dataRaw = pega(m, ['dataHora', 'data', 'dataHoraMovimento', 'dataMovimento', 'dtMovimento', 'dataDistribuicao', 'movimento.dataHora'])
  const data = dataRaw ? String(dataRaw).slice(0, 10) : null
  let desc = pega(m, ['descricao', 'nome', 'complemento', 'titulo', 'texto',
    'movimentoNacional.descricao', 'movimentoNacional.nome', 'movimento.descricao', 'movimento.nome', 'tipoMovimento.descricao'])
  desc = String(desc || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  // complementos tabelados agregam contexto (ex.: motivo)
  const comp = m.complementosTabelados || m.complementos
  if (Array.isArray(comp) && comp.length) {
    const extra = comp.map(c => c && (c.descricao || c.nome || c.valor)).filter(Boolean).join('; ')
    if (extra) desc = desc ? (desc + ' — ' + extra) : extra
  }
  if (!desc) return null
  return { data, texto: desc }
}

// dados da ficha a partir do JSON do PDPJ
export function extraiMeta(proc) {
  const t = (proc && (proc.tramitacaoAtual || (Array.isArray(proc.tramitacoes) && proc.tramitacoes[0]))) || {}
  return {
    classe: pega(proc, ['classe.descricao', 'classeProcessual.descricao', 'classeJudicial.descricao']) || pega(t, ['classe.descricao', 'classeProcessual.descricao']) || null,
    assunto: pega(proc, ['assunto.descricao', 'assuntoPrincipal.descricao']) || (Array.isArray(proc && proc.assuntos) && proc.assuntos[0] && (proc.assuntos[0].descricao || proc.assuntos[0].nome)) || pega(t, ['assunto.descricao']) || (Array.isArray(t.assuntos) && t.assuntos[0] && (t.assuntos[0].descricao || t.assuntos[0].nome)) || null,
    orgao: pega(proc, ['orgaoJulgador.nome', 'orgaoJulgador.descricao']) || pega(t, ['orgaoJulgador.nome', 'orgaoJulgador.descricao']) || null,
    distribuido: pega(proc, ['dataAjuizamento', 'dataDistribuicao', 'distribuicao.data']) || pega(t, ['dataDistribuicao', 'dataAjuizamento']) || null,
  }
}

// Busca o processo no PDPJ. Devolve { proc, arrays } ou { erro, motivo }.
// motivo: 'expirado' (sessão caiu) | 'sem_acesso' (processo alheio) | 'rede' | 'http'
export async function buscarProcesso(token, numero) {
  let resp, data
  try {
    resp = await fetch(`${PDPJ}/api/v2/processos/${numero}`, {
      headers: { ...PDPJ_HEADERS, Authorization: 'Bearer ' + token, Accept: 'application/json' },
      signal: AbortSignal.timeout(25000),
    })
    data = await resp.json().catch(() => null)
  } catch (e) {
    return { erro: 'falha ao consultar o PDPJ: ' + ((e && e.message) || e), motivo: 'rede' }
  }
  if (resp.status === 401) {
    // O PDPJ usa 401 para DUAS coisas diferentes. Só o corpo separa "sua sessão
    // caiu" de "este processo não é seu" — e mandar o advogado relogar por causa
    // de um processo alheio já custou uma manhã inteira.
    const msg = String((data && (data.message || data.error)) || '')
    if (ehFaltaDeAcessoAoProcesso(msg)) {
      return { erro: 'jus.br: seu login não tem acesso a este processo no PDPJ (não consta como advogado habilitado). A sessão está normal.', motivo: 'sem_acesso', detalhe: msg.slice(0, 200) }
    }
    return { erro: 'jus.br: token inválido/expirado — sincronize novamente', motivo: 'expirado' }
  }
  if (!resp.ok) return { erro: 'PDPJ recusou (HTTP ' + resp.status + ')', motivo: 'http', status: resp.status }

  const proc = Array.isArray(data && data.content) ? data.content[0] : (Array.isArray(data) ? data[0] : data)
  return { proc }
}

// Extrai a lista de movimentos já normalizada e sem repetição interna.
// Duas armadilhas, as duas vistas no 0802871-55.2021.8.15.2001:
//
// 1. Pegar só o MAIOR array. O array de documentos também tem data e descrição,
//    então em processo com muita peça juntada (esse tem 67) o maior array é o de
//    documentos e os movimentos eram jogados fora inteiros — o histórico ficava
//    parado enquanto o jus.br já mostrava a remessa ao 2º grau.
// 2. Pegar só UM array. Processo que subiu em grau de recurso passa a ter uma
//    tramitação por grau, cada uma com sua lista; ficar com uma só perde a outra.
//
// Então: quando alguma chave se chama "movimento", usa TODAS as que se chamam
// assim e ignora o resto. Só quando nenhuma se identifica é que caímos no palpite
// pelo tamanho, que é o comportamento antigo.
export function movimentosDoProcesso(proc) {
  const achados = []
  coletaArraysMov(proc, achados, 0, '')
  const nomeados = achados.filter(a => /moviment/i.test(a.chave))
  const escolhidos = nomeados.length
    ? nomeados
    : achados.slice().sort((a, b) => b.itens.length - a.itens.length).slice(0, 1)

  const movs = []
  const vistos = new Set()
  for (const grupo of escolhidos) {
    for (const m of grupo.itens) {
      const n = normMov(m)
      if (!n) continue
      const k = (n.data || '') + '|' + n.texto.toLowerCase()
      if (vistos.has(k)) continue
      vistos.add(k)
      movs.push(n)
    }
  }
  const arrays = escolhidos.map(a => a.itens)
  return {
    movs, arrays, lista: arrays[0] || [],
    chaves: escolhidos.map(a => a.chave),
    chavesVistas: achados.map(a => a.chave + ':' + a.itens.length),
  }
}

// Atualiza classe/assunto/vara/distribuição na ficha. Nunca bloqueia a
// importação dos movimentos — é enfeite, o histórico é o que importa.
export async function aplicarMeta(sb, numero, proc) {
  const meta = extraiMeta(proc)
  try {
    const patch = {}
    if (meta.classe) patch.classe = String(meta.classe).slice(0, 200)
    if (meta.assunto) patch.assunto = String(meta.assunto).slice(0, 200)
    if (meta.orgao) { patch.orgao = String(meta.orgao).slice(0, 200); patch.foro = String(meta.orgao).slice(0, 200) }
    if (meta.distribuido) { const d = String(meta.distribuido).slice(0, 10); if (/^\d{4}-\d{2}-\d{2}$/.test(d)) patch.distribuido_em = d }
    if (Object.keys(patch).length) {
      const upd = await sb.from('processos').update(patch).eq('numero_digitos', numero).select('id')
      if (!upd.error && upd.data && upd.data.length) return { meta, atualizada: true }
    }
  } catch (e) { /* não bloqueia a importação de movimentos */ }
  return { meta, atualizada: false }
}

// Grava os movimentos via robot_add_andamento_fonte — dedup por (data, texto).
// A RPC antiga (robot_add_andamento) deduplica SÓ por texto e engolia o segundo
// "Conclusos para despacho" do processo, mesmo em data diferente.
export async function gravarMovimentos(sb, numero, movs, fonte) {
  const r = { inseridos: 0, jaTinha: 0, semProcesso: 0, erros: 0 }
  for (const mv of movs) {
    const { data: res, error } = await sb.rpc('robot_add_andamento_fonte', {
      p_num: numero, p_data: mv.data, p_texto: mv.texto, p_fonte: fonte || 'jusbr',
    })
    if (error) { r.erros++; continue }
    if (res === 'inserido') r.inseridos++
    else if (res === 'existe') r.jaTinha++
    else r.semProcesso++
  }
  return r
}
