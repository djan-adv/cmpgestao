// Desconsideração da personalidade jurídica — procura, no jus.br/PDPJ, processos
// em que um CNPJ é parte e varre as movimentações deles atrás de decisão de
// desconsideração (IDPJ, art. 133-137 CPC).
//
//   GET /api/devedor/desconsideracao?cnpj=<14 dígitos>[&numero=<processo de origem>]
//     (Authorization: Bearer <jwt do Supabase>)
//
// Como funciona (diferente do "Dossiê do devedor", que busca por NOME no DJEN):
//   1) PDPJ (jus.br), busca por CPF/CNPJ da parte — endpoint confirmado manualmente
//      em 07/08/2026 pela aba Rede do navegador, com o jus.br logado:
//        GET https://portaldeservicos.pdpj.jus.br/api/v2/processos?cpfCnpjParte=<dígitos>
//      Usa a MESMA sessão que o sistema já mantém para baixar autos — sem senha,
//      sem re-login. Cobre processos de QUALQUER tribunal, inclusive os que não
//      são do escritório.
//   2) Para cada processo achado, busca o detalhe completo (mesmo core.js do robô
//      de movimentos) e extrai as movimentações em texto.
//   3) Peneira grátis por palavra-chave (desconsideração, IDPJ…) — só o que passa
//      vai para a IA, que classifica deferida/indeferida/pedido/incidente.
//
// LIMITES, que valem mais do que o resultado:
//   • A lista de processos (passo 1) é ampla — mostra o CNPJ como parte mesmo em
//     processo de outro escritório. Mas o DETALHE (passo 2) só é lido se o jus.br
//     autorizar: processo em segredo de justiça, ou processo público mas ainda
//     assim recusado pela API, fica marcado "sem acesso ao conteúdo" — aparece na
//     lista, sem o rastreio de desconsideração.
//   • A paginação do PDPJ (campo searchAfter) ainda não foi implementada aqui —
//     buscas com mais de 100 processos mostram só os 100 primeiros.
//   • Não é certidão nem prova: é pista para pedir a certidão certa.

import { createClient } from '@supabase/supabase-js'
import { chamarClaude } from '../../_ia/claude.js'
import { getFreshToken, ESCRITORIO_CMP } from '../../jusbr/lib.js'
import { PDPJ, PDPJ_HEADERS, buscarProcesso, movimentosDoProcesso, extraiMeta, tramitacoesDoProcesso } from '../../jusbr/movimentos/core.js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 300

// A busca por CNPJ no PDPJ é bem mais lenta que a busca por número: em teste
// real levou 52s numa consulta só. 25s (padrão de outras chamadas ao PDPJ neste
// projeto) cortava a busca no meio. Dando folga aqui.
const TIMEOUT_BUSCA_MS = 90000
const MAX_PROCESSOS_DETALHE = 40  // um fetch de detalhe por processo — teto pro tempo de resposta
const ORCAMENTO_DETALHE_MS = 220000 // some ao tempo já gasto na busca — maxDuration é 300s
const MAX_PARA_IA = 24

const RE_DESCONSIDERACAO = /desconsidera[çc][ãa]o (da|de) (personalidade|pessoa) jur[íi]dica|\bidpj\b|desconsiderar a personalidade jur[íi]dica|redirecionamento (da execu[çc][ãa]o )?(a|à|aos) s[óo]ci|inclus[ãa]o (d[oe]s? )?s[óo]ci[oa]s? no p[óo]lo passivo/i

async function usuario(request) {
  const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    const u = await sb.auth.getUser(jwt)
    return (u && u.data && u.data.user) || null
  } catch (e) { return null }
}
function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}
function digitos(s) { return String(s || '').replace(/\D/g, '') }

const MANUAL_DESCONSIDERACAO =
  'Você é o(a) analista de execução do escritório Crispim, Mendonça e Pinheiro (CMP). Recebe trechos de movimentações processuais de processos em que UM CNPJ investigado (a pessoa jurídica devedora) figura como parte, e tem uma única tarefa: dizer se o trecho é uma movimentação de DESCONSIDERAÇÃO DA PERSONALIDADE JURÍDICA (IDPJ, art. 133 a 137 do CPC) contra essa empresa — e em que situação está.\n\n' +
  'CLASSIFIQUE cada trecho (campo situacao):\n' +
  '- "deferida": o juízo DEFERIU/ACOLHEU a desconsideração — sócio(s)/administrador(es) passam a responder com bens pessoais.\n' +
  '- "indeferida": o juízo NEGOU/REJEITOU o pedido de desconsideração.\n' +
  '- "incidente_instaurado": foi instaurado o incidente (IDPJ) e determinada a citação dos sócios, ainda SEM decisão de mérito.\n' +
  '- "pedido": há apenas um PEDIDO/requerimento de desconsideração nos autos, sem decisão do juízo ainda.\n' +
  '- "recurso": há recurso (agravo, apelação) discutindo a desconsideração já decidida.\n' +
  '- "outro": o trecho menciona o tema mas não se encaixa acima, ou não dá para saber pelo trecho.\n\n' +
  'REGRAS: use SOMENTE o que está escrito no trecho — não deduza, não estime. Copie o nome do(s) sócio(s) atingido(s) exatamente como aparece, se aparecer (ou deixe vazio). Se o trecho não tratar de desconsideração de personalidade jurídica (falso positivo da busca por palavra-chave), simplesmente não o inclua na resposta — é melhor devolver lista vazia do que forçar um achado. Responda SEMPRE chamando a ferramenta registrar_achados.'

const FERRAMENTA_ACHADOS = [{
  name: 'registrar_achados',
  description: 'Registra os achados de desconsideração da personalidade jurídica nos trechos.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      achados: {
        type: 'array',
        description: 'Um item por trecho que realmente trata de desconsideração da personalidade jurídica. Vazio se nenhum trecho tratar do tema.',
        items: {
          type: 'object',
          properties: {
            processo: { type: 'string', description: 'Número do processo do trecho, como veio no rótulo [P1], [P2]…' },
            situacao: { type: 'string', enum: ['deferida', 'indeferida', 'incidente_instaurado', 'pedido', 'recurso', 'outro'] },
            socios: { type: 'string', description: 'Nome(s) do(s) sócio(s)/administrador(es) atingido(s), como aparece no trecho. Vazio se não mencionado.' },
            data: { type: 'string', description: 'Data da movimentação (AAAA-MM-DD), como veio no rótulo.' },
            confianca: { type: 'string', enum: ['alta', 'media', 'baixa'] },
            trecho: { type: 'string', description: 'O pedaço do texto que sustenta o achado (até 300 caracteres).' },
          },
          required: ['processo', 'situacao', 'socios', 'data', 'confianca', 'trecho'],
          additionalProperties: false,
        },
      },
    },
    required: ['achados'],
    additionalProperties: false,
  },
}]

// busca a lista de processos onde o CNPJ é parte — só a 1ª página (100 no máximo)
async function buscarPorCnpj(token, cnpj) {
  const url = `${PDPJ}/api/v2/processos?cpfCnpjParte=${encodeURIComponent(cnpj)}`
  let r, data
  try {
    r = await fetch(url, { headers: { ...PDPJ_HEADERS, Authorization: 'Bearer ' + token, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_BUSCA_MS) })
    data = await r.json().catch(() => null)
  } catch (e) { return { erro: 'falha ao consultar o PDPJ: ' + ((e && e.message) || e), motivo: 'rede' } }
  if (r.status === 401) return { erro: 'jus.br: token inválido/expirado — sincronize novamente', motivo: 'expirado' }
  if (!r.ok) return { erro: 'PDPJ recusou (HTTP ' + r.status + ')', motivo: 'http', status: r.status }
  const content = Array.isArray(data && data.content) ? data.content : []
  const total = (data && typeof data.total === 'number') ? data.total : content.length
  return { content, total }
}

export async function GET(request) {
  const user = await usuario(request)
  if (!user) return Response.json({ erro: 'não autenticado' }, { status: 401 })
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ erro: 'falta service key' }, { status: 500 })

  const { searchParams } = new URL(request.url)
  const cnpj = digitos(searchParams.get('cnpj'))
  const origem = digitos(searchParams.get('numero'))
  if (cnpj.length !== 14) return Response.json({ erro: 'informe um CNPJ válido (14 dígitos)' }, { status: 400 })

  const sb = admin()

  const tok = await getFreshToken(sb)
  if (tok.erro) return Response.json({ erro: 'sessão do jus.br indisponível: ' + tok.erro + ' — sincronize o jus.br (ver instruções do Estagiário Virtual) e tente de novo.' }, { status: 502 })

  // 1) lista de processos onde o CNPJ é parte
  const busca = await buscarPorCnpj(tok.token, cnpj)
  if (busca.erro) return Response.json({ erro: busca.erro, motivo: busca.motivo }, { status: busca.status || 502 })
  if (!busca.content.length) {
    return Response.json({
      ok: true, cnpj, processos: [], achados: [],
      resumo: 'Nenhum processo encontrado no jus.br com este CNPJ como parte.',
      avisos: ['Processos em segredo de justiça, ou não integrados ao PDPJ pelo tribunal de origem, podem não aparecer aqui.'],
    })
  }
  const truncouLista = busca.total > busca.content.length

  // metadados de cada processo já vêm na própria lista (não precisa de outro fetch para isso)
  const processos = busca.content.map(item => {
    const numero = digitos(item.numeroProcesso)
    const meta = extraiMeta(item)
    const trilha = tramitacoesDoProcesso(item)
    const ultima = trilha[trilha.length - 1] || null
    const t0 = Array.isArray(item.tramitacoes) ? item.tramitacoes[0] : null
    const partes = (t0 && Array.isArray(t0.partes)) ? t0.partes : []
    // nome do campo de documento dentro de "partes" não foi confirmado na captura
    // manual do endpoint — tentativa best-effort; se não bater, polo fica vazio
    // (não quebra nada, só deixa de mostrar autor/réu nesta linha).
    const polo = (partes.find(p => {
      const doc = digitos(p && (p.numeroDocumentoPrincipal || p.cpfCnpj || p.documento || p.numeroDocumento))
      return doc === cnpj
    }) || {}).polo || null
    return {
      numero, tribunal: item.siglaTribunal || (ultima && ultima.tribunal) || '',
      classe: meta.classe || '', assunto: meta.assunto || '', orgao: meta.orgao || (ultima && ultima.orgao) || '',
      distribuido: meta.distribuido ? String(meta.distribuido).slice(0, 10) : null,
      polo: polo ? String(polo).toUpperCase() : null,
      acesso: null, // preenchido no passo 2: true | false | null (não tentado)
    }
  }).filter(p => p.numero)

  // marca o que já é do escritório (contexto)
  try {
    const nums = processos.map(p => p.numero)
    const { data } = await sb.from('processos').select('numero_digitos,cliente_nome').eq('escritorio_id', ESCRITORIO_CMP).in('numero_digitos', nums)
    const porNum = {}
    for (const row of (data || [])) porNum[digitos(row.numero_digitos)] = row
    processos.forEach(p => { const row = porNum[p.numero]; if (row) { p.nosso = true; p.cliente = row.cliente_nome || null } })
  } catch (e) {}

  // 2) para cada processo (até o teto de quantidade OU de tempo), busca o
  // detalhe e escaneia as movimentações. O teto de tempo existe porque a busca
  // por CNPJ sozinha já pode levar quase 1 minuto (ver TIMEOUT_BUSCA_MS) —
  // sem ele, muitos processos "leves" na contagem ainda estourariam maxDuration.
  const alvo = processos.slice(0, MAX_PROCESSOS_DETALHE)
  let truncouDetalhe = processos.length > alvo.length
  const candidatas = []
  let semAcesso = 0, detalhados = 0
  const tDetalhe0 = Date.now()
  for (const P of alvo) {
    if (Date.now() - tDetalhe0 > ORCAMENTO_DETALHE_MS) { truncouDetalhe = true; break }
    detalhados++
    const det = await buscarProcesso(tok.token, P.numero)
    if (det.erro) { P.acesso = false; if (det.motivo === 'sem_acesso') semAcesso++; continue }
    P.acesso = true
    const { movs } = movimentosDoProcesso(det.procs || det.proc)
    for (const m of movs) {
      if (RE_DESCONSIDERACAO.test(m.texto)) candidatas.push({ processo: P.numero, data: m.data, texto: m.texto })
    }
  }
  candidatas.sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')))
  const paraIA = candidatas.slice(0, MAX_PARA_IA)

  let achados = [], custo = 0, erroIA = null
  if (paraIA.length && process.env.ANTHROPIC_API_KEY) {
    const rotulos = {}
    const blocos = paraIA.map((c, i) => {
      const tag = 'P' + (i + 1)
      rotulos[tag] = c
      return '[' + tag + '] processo ' + c.processo + ' — movimentação de ' + (c.data || '?') + '\n' + c.texto.slice(0, 2000)
    }).join('\n\n———\n\n')

    const r = await chamarClaude({
      rotina: 'desconsideracao_pj', sb, ref: cnpj, escritorioId: ESCRITORIO_CMP,
      modelo: 'claude-sonnet-5', maxTokens: 4000,
      sistemaFixo: MANUAL_DESCONSIDERACAO,
      conteudo: [{ type: 'text', text: 'CNPJ INVESTIGADO: ' + cnpj + '\n\nTRECHOS DAS MOVIMENTAÇÕES:\n\n' + blocos }],
      ferramentas: FERRAMENTA_ACHADOS,
      toolChoice: { type: 'tool', name: 'registrar_achados' },
    })
    if (r.erro) erroIA = r.erro
    else {
      custo = r.custoUsd || 0
      const saida = (r.ferramenta && r.ferramenta.input && r.ferramenta.input.achados) || []
      achados = saida.map(a => {
        const tag = String(a.processo || '').replace(/[^A-Za-z0-9]/g, '')
        const ref = rotulos[tag] || rotulos['P' + tag.replace(/\D/g, '')] || null
        const numero = ref ? ref.processo : digitos(a.processo)
        const P = processos.find(x => x.numero === numero)
        return { ...a, processo: numero, tribunal: P ? P.tribunal : '', orgao: P ? P.orgao : '', nosso: !!(P && P.nosso), cliente: P ? P.cliente : null }
      }).filter(a => a.processo)
      const peso = { deferida: 0, incidente_instaurado: 1, recurso: 2, pedido: 3, indeferida: 4, outro: 5 }
      achados.sort((a, b) => (peso[a.situacao] - peso[b.situacao]) || String(b.data || '').localeCompare(String(a.data || '')))
    }
  }

  return Response.json({
    ok: true, cnpj, origem: origem || null,
    resumo: processos.length + ' processo(s) no jus.br com este CNPJ como parte' +
      (semAcesso ? (' (' + semAcesso + ' sem acesso ao conteúdo)') : '') +
      ' · ' + candidatas.length + ' movimentação(ões) com cara de desconsideração · ' +
      achados.length + ' achado(s) confirmado(s) pela IA.',
    totais: { processos: processos.length, detalhados, sem_acesso: semAcesso, candidatas: candidatas.length, analisadas: paraIA.length },
    achados, processos,
    custo_usd: custo, erro_ia: erroIA,
    avisos: [
      'Lista de processos vinda do jus.br (PDPJ) — cobre outros tribunais, não só o acervo do escritório.',
      'O CONTEÚDO (movimentações) só é lido quando o jus.br autoriza o acesso — processo em segredo de justiça ou não liberado à sua credencial aparece na lista, sem varredura de conteúdo.',
      'Isto é pista de investigação, não certidão — confira o andamento na origem antes de peticionar.',
    ].concat(truncouLista ? ['A busca no jus.br trouxe mais processos do que os 100 primeiros mostrados aqui — a paginação ainda não foi implementada.'] : [])
      .concat(truncouDetalhe ? ['Muitos processos encontrados: só os primeiros ' + MAX_PROCESSOS_DETALHE + ' tiveram o conteúdo varrido.'] : []),
  })
}
