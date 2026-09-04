// Dossiê do devedor — procura bens penhorados e créditos do devedor em OUTROS
// processos, do jeito que se faz na mão: varrendo tudo em que ele aparece, como
// réu e como autor. Duas fontes, que podem ser usadas juntas ou separadas:
//
//   GET /api/devedor/dossie?nome=<nome>&documento=<CPF/CNPJ>[&meses=12][&numero=<processo>]
//     (Authorization: Bearer <jwt do Supabase>)
//
// Fonte 1 — DJEN/Comunica do CNJ, por NOME (é público, não precisa de login e
//   cobre todos os tribunais, não só o acervo do escritório). Só enxerga o que
//   foi PUBLICADO no diário.
// Fonte 2 — jus.br/PDPJ, por CPF/CNPJ (endpoint confirmado manualmente em
//   07/08/2026 pela aba Rede do navegador: GET .../api/v2/processos?
//   cpfCnpjParte=<dígitos>). Usa a MESMA sessão que o sistema já mantém para
//   baixar autos. Lista processos de QUALQUER tribunal onde o documento é
//   parte, mesmo sem publicação — mas o CONTEÚDO (movimentações) só é lido
//   quando o jus.br autoriza o acesso.
//
// As duas fontes rodam em paralelo e os achados se somam num só dossiê: peneira
// grátis por palavra-chave (penhora, avaliação, alvará, arrematação…) em cada
// uma, e só o que passa vai para a IA, que é o único custo aqui.
//
// LIMITES, que valem mais do que o resultado:
//   • Por nome: homônimo dá falso-positivo — confira antes de agir.
//   • Por documento: processo em segredo de justiça, ou não integrado ao PDPJ
//     pelo tribunal de origem, pode não aparecer; busca traz só os 100
//     primeiros processos (sem paginação ainda).
//   • Só enxerga o que foi PUBLICADO (fonte DJEN) ou o que o jus.br autoriza
//     ler (fonte PDPJ). Acordo extrajudicial nunca aparece em nenhuma das duas.
//   • Não é certidão nem prova: é pista para pedir a certidão certa.
//   • Não substitui SisbaJud, RenaJud, CNIB, Registro de Imóveis ou Receita.

import { createClient } from '@supabase/supabase-js'
import { chamarClaude } from '../../_ia/claude.js'
import { escritorioDoUsuario } from '../../_lib/inquilino.js'
import { getFreshToken } from '../../jusbr/lib.js'
import { buscarProcesso, movimentosDoProcesso, extraiMeta, tramitacoesDoProcesso, buscarProcessosPorDocumento } from '../../jusbr/movimentos/core.js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 300

const DJEN = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao'
const UA = 'Mozilla/5.0 (compatible; CMPGestao/1.0)'
const iso = (d) => d.toISOString().slice(0, 10)
const digitos = (s) => String(s || '').replace(/\D/g, '')

const JANELA_DIAS = 90       // o DJEN responde melhor em fatias; varremos por fatia
const MAX_PAGINAS = 8        // por fatia
const ORCAMENTO_MS = 150000  // teto de tempo da varredura por NOME, para a tela não pendurar
const MAX_PROCESSOS_DETALHE_DOC = 40  // teto de processos detalhados na varredura por DOCUMENTO
const MAX_PARA_IA = 28       // publicações/movimentações enviadas à IA por dossiê (soma das duas fontes)

// Peneira grátis: só o que casa aqui custa IA. Vale errar para mais — a IA depois
// descarta o que não for sinal patrimonial de verdade.
const RE_PATRIMONIO = /penhor|constri[çc]|arrest|sequestr|avalia[çc]|arremat|adjudica[çc]|hasta p[úu]blica|leil[ãa]o|pra[çc]a p[úu]blica|alvar[áa]|levantament|dep[óo]sito judicial|bacen|sisbajud|renajud|infojud|cnib|indisponibilidade|im[óo]vel|matr[íi]cula|ve[íi]culo|quota|a[çc][õo]es|precat[óo]rio|RPV|cr[ée]dito|honor[áa]rios sucumbenc|transfer[êe]ncia de valores|bloqueio/i

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

function limpa(t) { return String(t || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() }
function normaliza(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim() }

// Descobre o polo do devedor na publicação pelos destinatários (A = ativo/autor,
// P = passivo/réu). Devolve 'autor', 'reu' ou null quando o DJEN não diz.
function poloDoNome(item, alvoNorm) {
  const dests = item.destinatarios || item.destinatarios_advogados || []
  for (const d of (Array.isArray(dests) ? dests : [])) {
    const nome = normaliza(d.nome || d.nomeParte || '')
    if (!nome) continue
    if (nome.indexOf(alvoNorm) > -1 || alvoNorm.indexOf(nome) > -1) {
      const polo = String(d.polo || d.tipoParte || '').toUpperCase()
      if (polo.startsWith('A')) return 'autor'
      if (polo.startsWith('P')) return 'reu'
    }
  }
  return null
}

// ————— Manual do dossiê (bloco FIXO, com cache_control) —————
const MANUAL_DOSSIE =
  'Você é o(a) analista de execução do escritório. Recebe trechos (de publicações do Diário de Justiça e/ou de movimentações processuais lidas direto no jus.br) em que UMA pessoa/empresa (o devedor investigado) figura como parte, em processos variados, e tem uma única tarefa: apontar SINAIS PATRIMONIAIS aproveitáveis para penhora ou para localizar crédito desse devedor.\n\n' +

  'O QUE É SINAL PATRIMONIAL (reporte):\n' +
  '- Penhora, arresto, sequestro ou constrição de bem (imóvel, veículo, quotas, ações, faturamento, safra, maquinário, semovente).\n' +
  '- Avaliação de bem, laudo de avaliação, auto de penhora e avaliação.\n' +
  '- Designação de leilão/hasta pública/praça, arrematação ou adjudicação de bem do devedor.\n' +
  '- Bloqueio ou penhora de valores (SisbaJud/BacenJud), de veículo (RenaJud), indisponibilidade de bens (CNIB), quebra de sigilo fiscal (InfoJud) com resultado positivo.\n' +
  '- Depósito judicial, alvará ou levantamento de valores EM FAVOR do devedor investigado — isso é crédito dele, penhorável no rosto dos autos.\n' +
  '- Precatório ou RPV em favor do devedor investigado.\n' +
  '- Honorários de sucumbência devidos AO devedor investigado ou ao advogado dele.\n' +
  '- Acordo homologado em que o devedor investigado VAI RECEBER valores.\n' +
  '- Menção a bem identificado dele: matrícula de imóvel, placa/chassi de veículo, conta bancária, participação societária.\n\n' +

  'O QUE NÃO É SINAL (descarte):\n' +
  '- Penhora ou bloqueio que recai sobre OUTRA pessoa que não o devedor investigado.\n' +
  '- Valores que o devedor vai PAGAR (isso é dívida dele, não bem penhorável).\n' +
  '- Custas, taxas, intimação genérica, andamento processual sem conteúdo patrimonial.\n' +
  '- Penhora frustrada, negativa de bens, "nada foi encontrado", bloqueio infrutífero, extinção por ausência de bens — isso é o contrário de sinal.\n' +
  '- Bem já arrematado por terceiro ou já liberado/desconstituído da penhora, salvo se sobrar saldo ao devedor.\n\n' +

  'CLASSIFICAÇÃO (campo tipo): "penhora", "avaliacao", "leilao", "arrematacao", "adjudicacao", "bloqueio_valores", "credito_a_receber", "precatorio_rpv", "bem_identificado" ou "outro".\n\n' +

  'APROVEITAMENTO (campo aproveitamento): explique em uma frase o que o advogado deve FAZER com esse sinal. Exemplos do padrão esperado: "Pedir certidão de inteiro teor da matrícula e requerer penhora no rosto dos autos."; "Requerer a reserva do crédito antes do levantamento pelo devedor."; "Habilitar o crédito no leilão designado para 12/08."\n\n' +

  'CONFIANÇA: "alta" quando o trecho nomeia o devedor e descreve o bem ou o valor; "media" quando o sinal é claro mas o vínculo com o devedor é indireto; "baixa" quando pode ser homônimo ou o trecho é ambíguo.\n\n' +

  'REGRAS: use SOMENTE o que está nos trechos — não deduza bem que não foi mencionado, não estime valor que não foi escrito. Copie o valor exatamente como aparece (ou deixe vazio). Se um trecho não trouxer sinal algum, simplesmente não o inclua na resposta. É melhor devolver lista vazia do que inventar bem. Responda SEMPRE chamando a ferramenta registrar_sinais.'

const FERRAMENTA_SINAIS = [{
  name: 'registrar_sinais',
  description: 'Registra os sinais patrimoniais encontrados nos trechos.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      sinais: {
        type: 'array',
        description: 'Um item por sinal patrimonial aproveitável. Vazio se nenhum trecho trouxer sinal.',
        items: {
          type: 'object',
          properties: {
            processo: { type: 'string', description: 'Número do processo do trecho, como veio no rótulo [P1], [P2]…' },
            tipo: { type: 'string', enum: ['penhora', 'avaliacao', 'leilao', 'arrematacao', 'adjudicacao', 'bloqueio_valores', 'credito_a_receber', 'precatorio_rpv', 'bem_identificado', 'outro'] },
            bem: { type: 'string', description: 'O bem ou crédito, como descrito no trecho.' },
            valor: { type: 'string', description: 'Valor exatamente como aparece no trecho. Vazio se não houver.' },
            data: { type: 'string', description: 'Data da publicação/movimentação do trecho (AAAA-MM-DD), como veio no rótulo.' },
            aproveitamento: { type: 'string', description: 'O que o advogado deve fazer com este sinal, em uma frase.' },
            confianca: { type: 'string', enum: ['alta', 'media', 'baixa'] },
            trecho: { type: 'string', description: 'O pedaço do texto que sustenta o achado (até 300 caracteres).' },
          },
          required: ['processo', 'tipo', 'bem', 'valor', 'data', 'aproveitamento', 'confianca', 'trecho'],
          additionalProperties: false,
        },
      },
    },
    required: ['sinais'],
    additionalProperties: false,
  },
}]

// ————— fonte 1: varredura do DJEN por nome —————
async function varrer(nome, meses) {
  const t0 = Date.now()
  const fatias = Math.max(1, Math.ceil((meses * 30) / JANELA_DIAS))
  const itens = []
  let requisicoes = 0, truncou = false
  for (let f = 0; f < fatias; f++) {
    if (Date.now() - t0 > ORCAMENTO_MS) { truncou = true; break }
    const fim = new Date(Date.now() - f * JANELA_DIAS * 86400000)
    const ini = new Date(fim.getTime() - JANELA_DIAS * 86400000)
    for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
      if (Date.now() - t0 > ORCAMENTO_MS) { truncou = true; break }
      const url = `${DJEN}?nomeParte=${encodeURIComponent(nome)}&dataDisponibilizacaoInicio=${iso(ini)}&dataDisponibilizacaoFim=${iso(fim)}&meio=D&pagina=${pagina}&itensPorPagina=100`
      let r
      try { r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(25000) }) }
      catch (e) { break }
      requisicoes++
      if (!r.ok) break
      const d = await r.json().catch(() => ({}))
      const lote = d.items || d.content || d.comunicacoes || []
      if (!lote.length) break
      itens.push(...lote)
      if (lote.length < 100) break
    }
  }
  return { itens, requisicoes, truncou, ms: Date.now() - t0 }
}

// ————— fonte 2: varredura do PDPJ por CPF/CNPJ —————
async function varrerPorDocumento(sb, documento, deadline, esc) {
  const tok = await getFreshToken(sb, null, esc)
  if (tok.erro) return { erro: 'sessão do jus.br indisponível: ' + tok.erro + ' — sincronize o jus.br e tente de novo.', processos: [], candidatas: [] }

  const busca = await buscarProcessosPorDocumento(tok.token, documento, deadline)
  if (busca.erro) return { erro: busca.erro, processos: [], candidatas: [] }
  const truncouLista = busca.total > busca.content.length

  const processos = busca.content.map(item => {
    const numero = digitos(item.numeroProcesso)
    const meta = extraiMeta(item)
    const trilha = tramitacoesDoProcesso(item)
    const ultima = trilha[trilha.length - 1] || null
    const tram0 = Array.isArray(item.tramitacoes) ? item.tramitacoes[0] : null
    const partes = (tram0 && Array.isArray(tram0.partes)) ? tram0.partes : []
    // nome do campo de documento dentro de "partes" não foi confirmado na captura
    // manual do endpoint — tentativa best-effort; se não bater, polo fica vazio.
    const poloRaw = (partes.find(p => {
      const doc = digitos(p && (p.numeroDocumentoPrincipal || p.cpfCnpj || p.documento || p.numeroDocumento))
      return doc === documento
    }) || {}).polo || null
    const poloU = poloRaw ? String(poloRaw).toUpperCase() : ''
    return {
      numero, tribunal: item.siglaTribunal || (ultima && ultima.tribunal) || '',
      orgao: meta.orgao || (ultima && ultima.orgao) || '',
      polo: poloU.startsWith('A') ? 'autor' : (poloU.startsWith('P') ? 'reu' : null),
      acesso: null,
    }
  }).filter(p => p.numero)

  const alvo = processos.slice(0, MAX_PROCESSOS_DETALHE_DOC)
  const truncouDetalhe = processos.length > alvo.length
  const candidatas = []
  const deadlineDetalhe = deadline - 15000
  let semAcesso = 0
  for (const P of alvo) {
    if (Date.now() > deadlineDetalhe) break
    const det = await buscarProcesso(tok.token, P.numero)
    if (det.erro) { P.acesso = false; if (det.motivo === 'sem_acesso') semAcesso++; continue }
    P.acesso = true
    const { movs } = movimentosDoProcesso(det.procs || det.proc)
    for (const m of movs) {
      if (RE_PATRIMONIO.test(m.texto)) candidatas.push({ numero: P.numero, data: m.data, texto: m.texto })
    }
  }
  return { processos, candidatas, truncouLista, truncouDetalhe, semAcesso }
}

export async function GET(request) {
  const t0 = Date.now()
  // orçamento pro lado PDPJ (280s, 20s de folga sob os 300s de maxDuration); a
  // varredura por nome tem seu próprio teto interno (ORCAMENTO_MS).
  const deadline = t0 + 280000

  const user = await usuario(request)
  if (!user) return Response.json({ erro: 'não autenticado' }, { status: 401 })
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ erro: 'falta service key' }, { status: 500 })
  const esc = await escritorioDoUsuario(user.id)
  if (!esc) return Response.json({ erro: 'usuário sem escritório vinculado' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const nome = String(searchParams.get('nome') || '').trim()
  const documento = digitos(searchParams.get('documento'))
  const meses = Math.min(Math.max(parseInt(searchParams.get('meses') || '12', 10) || 12, 1), 36)
  const origem = digitos(searchParams.get('numero'))
  const temNome = nome.length >= 5
  const temDoc = documento.length === 11 || documento.length === 14
  if (!temNome && !temDoc) return Response.json({ erro: 'informe o nome do devedor (mínimo 5 letras) e/ou um CPF/CNPJ válido (11 ou 14 dígitos)' }, { status: 400 })

  const sb = admin()
  const alvoNorm = temNome ? normaliza(nome) : ''

  // as duas fontes rodam em paralelo — não têm nada em comum até a hora de somar os resultados
  const [djen, pdpj] = await Promise.all([
    temNome ? varrer(nome, meses) : Promise.resolve({ itens: [], requisicoes: 0, truncou: false, ms: 0 }),
    temDoc ? varrerPorDocumento(sb, documento, deadline, esc) : Promise.resolve(null),
  ])
  const { itens, requisicoes, truncou, ms } = djen

  if (!itens.length && (!pdpj || !pdpj.processos.length)) {
    return Response.json({
      ok: true, nome: nome || null, documento: documento || null, meses, processos: [], sinais: [],
      resumo: 'Nada encontrado' + (temNome ? ' com esse nome' : '') + (temDoc ? (temNome ? ' nem com esse documento' : ' com esse documento') : '') + ' no período.',
      varredura: { requisicoes, truncou, ms },
      avisos: (pdpj && pdpj.erro) ? ['Busca por CPF/CNPJ no jus.br falhou: ' + pdpj.erro] : [],
    })
  }

  // 2) agrupa por processo, guardando o polo e as publicações/movimentações com cara de bem
  const porProc = {}
  for (const p of itens) {
    const dig = digitos(p.numeroProcesso || p.numero_processo || p.numero)
    if (dig.length < 16) continue
    const texto = limpa(p.texto || p.teor)
    const data = String(p.dataDisponibilizacao || p.data_disponibilizacao || '').slice(0, 10)
    if (!porProc[dig]) {
      porProc[dig] = {
        numero: dig, tribunal: p.siglaTribunal || p.sigla_tribunal || '', orgao: p.nomeOrgao || p.nome_orgao || '',
        polo: null, publicacoes: 0, primeira: data, ultima: data, candidatas: [], fontes: [],
      }
    }
    const P = porProc[dig]
    if (P.fontes.indexOf('djen') < 0) P.fontes.push('djen')
    P.publicacoes++
    if (data && data > P.ultima) P.ultima = data
    if (data && data < P.primeira) P.primeira = data
    if (!P.polo) P.polo = poloDoNome(p, alvoNorm)
    if (texto && RE_PATRIMONIO.test(texto)) P.candidatas.push({ data, texto })
  }

  // funde os processos achados via PDPJ (fonte 2) na mesma estrutura
  let semAcessoPdpj = 0
  if (pdpj) {
    semAcessoPdpj = pdpj.semAcesso || 0
    for (const p of pdpj.processos) {
      if (!porProc[p.numero]) {
        porProc[p.numero] = {
          numero: p.numero, tribunal: p.tribunal || '', orgao: p.orgao || '',
          polo: p.polo || null, publicacoes: 0, primeira: '', ultima: '', candidatas: [], fontes: [],
        }
      }
      const P = porProc[p.numero]
      if (P.fontes.indexOf('pdpj') < 0) P.fontes.push('pdpj')
      if (!P.polo && p.polo) P.polo = p.polo
      if (!P.tribunal && p.tribunal) P.tribunal = p.tribunal
      if (!P.orgao && p.orgao) P.orgao = p.orgao
      P.acesso_pdpj = p.acesso
    }
    for (const c of pdpj.candidatas) {
      const P = porProc[c.numero]
      if (P) P.candidatas.push({ data: c.data, texto: c.texto })
    }
  }
  const processos = Object.values(porProc)

  // marca o que já é do escritório (dá contexto e evita "descoberta" do óbvio)
  try {
    const nums = processos.map(p => p.numero)
    for (let i = 0; i < nums.length; i += 200) {
      const { data } = await sb.from('processos').select('numero_digitos,cliente_nome,oponente')
        .eq('escritorio_id', esc).in('numero_digitos', nums.slice(i, i + 200))
      for (const row of (data || [])) {
        const P = porProc[digitos(row.numero_digitos)]
        if (P) { P.nosso = true; P.cliente = row.cliente_nome || null }
      }
    }
  } catch (e) {}

  // 3) escolhe o que vai para a IA: mais recente primeiro, no máximo MAX_PARA_IA (as duas fontes somadas)
  const candidatas = []
  for (const P of processos) {
    for (const c of P.candidatas) candidatas.push({ numero: P.numero, data: c.data, texto: c.texto })
  }
  candidatas.sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')))
  const paraIA = candidatas.slice(0, MAX_PARA_IA)

  let sinais = [], custo = 0, erroIA = null
  if (paraIA.length && process.env.ANTHROPIC_API_KEY) {
    const rotulos = {}
    const blocos = paraIA.map((c, i) => {
      const tag = 'P' + (i + 1)
      rotulos[tag] = c
      return '[' + tag + '] processo ' + c.numero + ' — ' + (c.data || '?') + '\n' + c.texto.slice(0, 2500)
    }).join('\n\n———\n\n')

    const r = await chamarClaude({
      rotina: 'dossie_devedor', sb, ref: (nome || documento).slice(0, 60), escritorioId: esc,
      modelo: 'claude-sonnet-5', maxTokens: 6000,
      sistemaFixo: MANUAL_DOSSIE,
      conteudo: [{ type: 'text', text: 'DEVEDOR INVESTIGADO: ' + (nome || ('documento ' + documento)) + '\n\nTRECHOS:\n\n' + blocos }],
      ferramentas: FERRAMENTA_SINAIS,
      toolChoice: { type: 'tool', name: 'registrar_sinais' },
    })
    if (r.erro) erroIA = r.erro
    else {
      custo = r.custoUsd || 0
      const saida = (r.ferramenta && r.ferramenta.input && r.ferramenta.input.sinais) || []
      sinais = saida.map(s => {
        // a IA responde com o rótulo [P1]; devolvemos o processo de verdade
        const tag = String(s.processo || '').replace(/[^A-Za-z0-9]/g, '')
        const ref = rotulos[tag] || rotulos['P' + tag.replace(/\D/g, '')] || null
        const numero = ref ? ref.numero : digitos(s.processo)
        const P = porProc[numero]
        return {
          ...s, processo: numero,
          tribunal: P ? P.tribunal : '', orgao: P ? P.orgao : '',
          polo: P ? P.polo : null, nosso: !!(P && P.nosso),
        }
      }).filter(s => s.processo)
      const peso = { alta: 0, media: 1, baixa: 2 }
      sinais.sort((a, b) => (peso[a.confianca] - peso[b.confianca]) || String(b.data || '').localeCompare(String(a.data || '')))
    }
  }

  processos.forEach(P => { P.candidatas = P.candidatas.length }) // só a contagem no retorno
  processos.sort((a, b) => String(b.ultima || '').localeCompare(String(a.ultima || '')))

  const comoReu = processos.filter(p => p.polo === 'reu').length
  const comoAutor = processos.filter(p => p.polo === 'autor').length
  const soPdpj = processos.filter(p => p.fontes.length === 1 && p.fontes[0] === 'pdpj').length

  const avisos = []
  if (temNome) avisos.push('Busca por NOME (fonte DJEN): homônimo dá falso-positivo — confira antes de agir. Só aparece o que foi publicado no diário.')
  if (temDoc) {
    avisos.push('Busca por CPF/CNPJ (fonte jus.br/PDPJ): cobre outros tribunais, mas o CONTEÚDO só é lido quando o jus.br autoriza — processo em segredo de justiça ou não liberado à sua credencial aparece na lista, sem varredura de conteúdo.' + (semAcessoPdpj ? (' (' + semAcessoPdpj + ' processo(s) sem acesso ao conteúdo desta vez.)') : ''))
    if (pdpj && pdpj.truncouLista) avisos.push('A busca por documento no jus.br trouxe mais processos do que os 100 primeiros mostrados aqui — a paginação ainda não foi implementada.')
    if (pdpj && pdpj.truncouDetalhe) avisos.push('Muitos processos encontrados por documento: só os primeiros ' + MAX_PROCESSOS_DETALHE_DOC + ' tiveram o conteúdo varrido.')
    if (pdpj && pdpj.erro) avisos.push('Busca por CPF/CNPJ no jus.br falhou: ' + pdpj.erro + ' — os resultados abaixo vêm só da busca por nome.')
  }
  avisos.push('Isto é pista de investigação, não certidão. Para constrição, peça a certidão de inteiro teor e o ofício ao juízo.')
  avisos.push('Não substitui SisbaJud, RenaJud, CNIB, Registro de Imóveis nem Receita Federal.')
  if (truncou) avisos.push('A varredura por nome parou no limite de tempo — o período pode não ter sido coberto inteiro. Reduza os meses ou repita.')

  return Response.json({
    ok: true, nome: nome || null, documento: documento || null, meses, origem: origem || null,
    resumo: processos.length + ' processo(s) encontrado(s)' +
      (comoAutor || comoReu ? (' (' + comoAutor + ' como autor, ' + comoReu + ' como réu)') : '') +
      (soPdpj ? (' · ' + soPdpj + ' só via CPF/CNPJ (sem publicação no período)') : '') +
      ' · ' + candidatas.length + ' trecho(s) com cara de bem/crédito · ' +
      sinais.length + ' sinal(is) confirmado(s) pela IA.',
    totais: { processos: processos.length, como_autor: comoAutor, como_reu: comoReu, so_pdpj: soPdpj, publicacoes: itens.length, candidatas: candidatas.length, analisadas: paraIA.length },
    sinais, processos,
    custo_usd: custo, erro_ia: erroIA,
    varredura: { requisicoes, truncou, ms },
    avisos,
  })
}
