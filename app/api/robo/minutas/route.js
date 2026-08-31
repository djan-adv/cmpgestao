// Robô de minutas — lê as intimações novas do DJEN, decide o que cada uma exige e,
// quando exigir peça, monta o DOSSIÊ do Estagiário Virtual: um zip só, com as
// instruções da petição e as peças necessárias dos autos, na pasta
// "Estagiário Virtual" do processo. Você baixa esse arquivo e a peça é escrita
// fora, no plano mensal do Claude — sem custo de API.
//
//   GET /api/robo/minutas?fase=triagem  → classifica as publicações novas
//   GET /api/robo/minutas?fase=dossie   → monta 1 dossiê pendente (sem custo)
//   GET /api/robo/minutas?status=1      → orçamento do mês + fila (para o painel)
//
// Com ia_config.modo = 'api', a fase 2 volta a redigir a minuta pela API paga
// (respeitando o teto). O padrão é 'dossie'.
//
// O PRAZO nunca depende de nada disso: a tarefa com a data nasce na triagem. Se o
// teto estourar ou o dossiê falhar, o prazo continua no Kanban.

import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { chamarClaude, orcamento } from '../../_ia/claude.js'
import { gerarMinuta, coletaPdfs, ROOT, ESCRITORIO_CMP } from '../../peticao/core.js'
import { zip } from '../../_lib/zip.js'
import { coletarPecas, ordenarPecas, pdfUnico, INTEGRA_PREFIXO, nomeArquivoAutos } from '../../jusbr/integra/core.js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 300

const JANELA_DIAS = 5        // publicações mais antigas que isto o robô não pega
const LOTE_TRIAGEM = 12      // por ciclo — cabe folgado na janela do maestro
const RESERVA_MINUTA_USD = 0.4 // modo 'api': só redige se sobrar isto do teto
const PASTA_DOSSIE = 'Estagiário Virtual'
const DOSSIE_MAX_DOCS = 8
const DOSSIE_MAX_BYTES = 60 * 1024 * 1024 // o zip precisa caber num upload de chat
const INTEGRA_VALIDADE_DIAS = 7 // íntegra mais nova que isto não precisa refazer

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}

// 'dossie' (padrão, sem custo de API) ou 'api' (o robô redige a minuta)
async function modoAtual(sb) {
  try {
    const { data } = await sb.from('ia_config').select('modo').eq('id', 1).maybeSingle()
    return (data && data.modo === 'api') ? 'api' : 'dossie'
  } catch (e) { return 'dossie' }
}

// ————— Manual de triagem (bloco FIXO, vai com cache_control) —————
// Precisa ser byte a byte idêntico entre chamadas: nada de data, nº de processo
// ou qualquer variável aqui dentro.
const MANUAL_TRIAGEM =
  'Você é o(a) advogado(a) de triagem do escritório Crispim, Mendonça e Pinheiro (CMP), que atua em Direito do Consumidor e Direito Civil no Nordeste (PB, PE, SE, CE, BA). Sua função é ler UMA publicação do Diário de Justiça (DJEN) e decidir, com precisão, o que ela exige do escritório.\n\n' +

  'REGRA DE OURO: só marque exige_peca = true quando a publicação impuser ao escritório a apresentação de uma PETIÇÃO com prazo. Publicação que apenas informa, ou que pede providência não-petitória (comparecer a audiência, retirar alvará, pagar custas), NÃO exige peça — mesmo que exija providência.\n\n' +

  'EXIGEM PEÇA (exige_peca = true):\n' +
  '- Citação/intimação para CONTESTAR ou apresentar defesa.\n' +
  '- Intimação para RÉPLICA / impugnação à contestação.\n' +
  '- Intimação para se MANIFESTAR: sobre documentos juntados, sobre laudo pericial, sobre proposta de acordo, sobre petição da parte contrária, sobre certidão negativa do oficial, sobre exceção de pré-executividade.\n' +
  '- Intimação para ESPECIFICAR PROVAS ou justificar a prova pretendida.\n' +
  '- Intimação para EMENDAR ou complementar a inicial, ou para sanar irregularidade de representação.\n' +
  '- Sentença/acórdão/decisão desfavorável, total ou parcialmente, com prazo recursal (apelação, agravo de instrumento, embargos de declaração, recurso especial/extraordinário, contrarrazões).\n' +
  '- Intimação para apresentar CONTRARRAZÕES a recurso da parte contrária.\n' +
  '- Intimação para apresentar CÁLCULOS, memória de cálculo ou impugnar cálculo apresentado.\n' +
  '- Intimação para cumprir DESPACHO que determina juntada de documento, esclarecimento ou informação nos autos (a juntada é feita por petição).\n' +
  '- Intimação para impugnar cumprimento de sentença / embargos à execução.\n\n' +

  'NÃO EXIGEM PEÇA (exige_peca = false):\n' +
  '- Mero andamento: autos conclusos, remessa, distribuição, juntada de AR, publicação de pauta, redistribuição, baixa, arquivamento.\n' +
  '- Designação de audiência (é agenda, não peça) — ainda que gere providência.\n' +
  '- Sentença/decisão INTEGRALMENTE favorável sem determinação ao escritório.\n' +
  '- Intimação dirigida exclusivamente à parte contrária, ao perito, à Fazenda ou ao MP.\n' +
  '- Alvará expedido, ordem de pagamento, RPV, transferência de valores.\n' +
  '- Certidão de trânsito em julgado sem determinação.\n' +
  '- Intimação para "ciência" ou "dar-se por intimado", sem providência.\n' +
  '- Despacho de "cumpra-se" genérico dirigido à secretaria.\n\n' +

  'PRAZOS (Código de Processo Civil, contagem em DIAS ÚTEIS salvo indicação diversa na própria publicação):\n' +
  '- Contestação: 15 dias. Réplica: 15 dias. Especificação de provas: 5 ou 15 dias, conforme o despacho.\n' +
  '- Manifestação genérica: 5 dias, salvo prazo expresso na publicação.\n' +
  '- Manifestação sobre laudo pericial: 15 dias. Emenda à inicial: 15 dias.\n' +
  '- Embargos de declaração: 5 dias. Apelação e contrarrazões: 15 dias. Agravo de instrumento: 15 dias.\n' +
  '- Recurso especial/extraordinário e contrarrazões: 15 dias. Impugnação ao cumprimento de sentença: 15 dias.\n' +
  '- Juizado Especial (Lei 9.099/95): prazos em dias CORRIDOS; recurso inominado e contrarrazões: 10 dias.\n' +
  'SEMPRE prefira o prazo escrito na própria publicação ao prazo padrão desta tabela. Se a publicação não indicar prazo e o tipo não constar acima, use 5.\n\n' +

  'INSTRUÇÃO PARA O REDATOR (campo instrucao): escreva em 1 a 3 frases, no imperativo, o que a peça deve fazer, já com o eixo da tese. Exemplos do padrão esperado: "Apresentar contestação impugnando a cobrança de tarifa não contratada e requerendo a repetição em dobro do art. 42, parágrafo único, do CDC, com pedido de dano moral."; "Manifestar-se sobre o laudo pericial, apontando que o perito não respondeu ao quesito 4 e requerendo esclarecimentos."; "Apresentar contrarrazões à apelação da ré, sustentando a manutenção da sentença quanto ao dano moral." Nunca escreva instrução genérica do tipo "responder à intimação".\n\n' +

  'DOCUMENTOS (campo docs_necessarios): liste, por palavras que apareceriam no NOME do arquivo, quais peças dos autos o redator precisa ler para escrever essa peça — por exemplo ["contestacao","laudo","pericia"] ou ["inicial","procuracao","contrato"]. Máximo de 4. Se não souber, devolva lista vazia.\n\n' +

  'URGÊNCIA: "alta" para prazo de até 5 dias, recurso, ou risco de preclusão/revelia; "media" para prazo de 6 a 15 dias; "baixa" para o restante.\n\n' +

  'ATO DECISÓRIO (campo ato_decisorio): responde a uma pergunta INDEPENDENTE de exige_peca — "esta publicação traz uma sentença, um acórdão ou uma decisão já proferida?". Marque true também quando o resultado for TOTALMENTE FAVORÁVEL ao nosso cliente, porque cabem embargos de declaração de qualquer decisão. Marque false para despacho de mero expediente, ato ordinatório, intimação para comparecer/pagar/retirar, juntada, certidão e publicação que apenas informa.\n\n' +

  'CAUTELA: na dúvida entre exigir peça e não exigir, marque exige_peca = true — perder prazo é irreversível, e o advogado revisa a triagem de qualquer forma. Você NÃO redige a peça, apenas classifica. Responda SEMPRE chamando a ferramenta registrar_triagem.'

const FERRAMENTA_TRIAGEM = [{
  name: 'registrar_triagem',
  description: 'Registra a classificação da publicação do diário.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      exige_peca: { type: 'boolean', description: 'A publicação impõe ao escritório apresentar uma petição com prazo?' },
      ato_decisorio: { type: 'boolean', description: 'A publicação traz uma SENTENÇA, ACÓRDÃO ou DECISÃO (interlocutória ou monocrática) já proferida, seja qual for o resultado? Marque true mesmo quando o resultado for favorável e mesmo quando exige_peca for false. Marque false para despacho de mero expediente, intimação para ato, juntada, certidão e demais atos sem carga decisória.' },
      tipo_peca: { type: 'string', description: 'Nome da peça a apresentar (ex.: "contestação", "réplica", "manifestação sobre laudo"). Vazio se não exigir peça.' },
      instrucao: { type: 'string', description: 'O que a peça deve fazer, em 1 a 3 frases no imperativo, com o eixo da tese. Vazio se não exigir peça.' },
      prazo_dias: { type: 'integer', description: 'Prazo em dias. 0 se não houver prazo.' },
      prazo_uteis: { type: 'boolean', description: 'true se o prazo conta em dias úteis, false se corridos (Juizado).' },
      urgencia: { type: 'string', enum: ['alta', 'media', 'baixa'] },
      resumo: { type: 'string', description: 'Uma frase dizendo o que a publicação determina.' },
      docs_necessarios: { type: 'array', items: { type: 'string' }, description: 'Até 4 palavras-chave de nomes de arquivos a consultar.' },
    },
    required: ['exige_peca', 'ato_decisorio', 'tipo_peca', 'instrucao', 'prazo_dias', 'prazo_uteis', 'urgencia', 'resumo', 'docs_necessarios'],
    additionalProperties: false,
  },
}]

const EMBARGOS_DIAS = 5      // art. 1.023 do CPC e art. 49 da Lei 9.099/95: 5 dias nos dois
const ATO_RECENTE_DIAS = 10  // decisão mais velha que isso não abre prazo de embargos

// A decisão é recente o bastante para valer o prazo de embargos? Sem data, trata
// como recente: perder prazo é pior do que uma tarefa a mais para conferir.
function atoRecente(dataAndamento) {
  if (!dataAndamento) return true
  const d = new Date(String(dataAndamento).slice(0, 10) + 'T12:00:00Z')
  if (isNaN(d)) return true
  return (Date.now() - d.getTime()) <= ATO_RECENTE_DIAS * 86400000
}

// prazo a partir de hoje. Dias úteis pulam sábado e domingo — feriado não entra na
// conta, então a data é sugestão e o advogado confere (a tarefa nasce para revisão).
function dataPrazo(dias, uteis) {
  const n = Math.max(0, parseInt(dias, 10) || 0)
  if (!n) return null
  const d = new Date()
  if (!uteis) { d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }
  let restam = n
  while (restam > 0) {
    d.setDate(d.getDate() + 1)
    const dow = d.getDay()
    if (dow !== 0 && dow !== 6) restam--
  }
  return d.toISOString().slice(0, 10)
}

// ————— fase 1: triagem —————
async function faseTriagem(sb, limite) {
  const desde = new Date(Date.now() - JANELA_DIAS * 86400000).toISOString()
  const { data: ands, error } = await sb.from('andamentos')
    .select('id,processo_id,data,texto')
    .eq('fonte', 'djen').gte('criado_em', desde)
    .order('id', { ascending: false }).limit(300)
  if (error) return { erro: 'não consegui ler os andamentos: ' + error.message }
  if (!ands || !ands.length) return { triados: 0, nada: true }

  // tira as que já passaram pelo robô (o unique em andamento_id é a rede de segurança)
  const ids = ands.map(a => a.id)
  const { data: jaVistos } = await sb.from('robo_minutas').select('andamento_id').in('andamento_id', ids)
  const vistos = new Set((jaVistos || []).map(r => Number(r.andamento_id)))
  const novas = ands.filter(a => !vistos.has(Number(a.id)) && String(a.texto || '').trim().length > 60)
  if (!novas.length) return { triados: 0, nada: true }

  // só processos ativos do escritório (arquivado/suspenso não gera prazo)
  const pids = [...new Set(novas.map(a => a.processo_id))]
  const { data: procs } = await sb.from('processos')
    .select('id,numero,cliente_nome,oponente,classe,assunto,orgao,status,suspenso')
    .eq('escritorio_id', ESCRITORIO_CMP).in('id', pids)
  const mapaProc = {}
  ;(procs || []).forEach(p => {
    const arquivado = /arquiv|encerr|baixad/i.test(String(p.status || ''))
    if (!arquivado && p.suspenso !== true) mapaProc[p.id] = p
  })

  const fila = novas.filter(a => mapaProc[a.processo_id]).slice(0, limite)
  const resultados = []
  for (const a of fila) {
    const p = mapaProc[a.processo_id]
    // bloco VARIÁVEL — sempre depois do breakpoint do cache
    const variavel =
      'PROCESSO nº ' + (p.numero || '') + ' | Cliente do escritório: ' + (p.cliente_nome || '?') +
      ' | Parte contrária: ' + (p.oponente || '?') + ' | Classe/Assunto: ' + ((p.classe || '') + ' ' + (p.assunto || '')).trim() +
      ' | Órgão: ' + (p.orgao || '?') + ' | Data da publicação: ' + (a.data || '?') + '\n\n' +
      'TEOR DA PUBLICAÇÃO:\n' + String(a.texto || '').slice(0, 12000)

    const r = await chamarClaude({
      rotina: 'triagem', sb, ref: p.numero, escritorioId: ESCRITORIO_CMP,
      modelo: 'claude-sonnet-5', maxTokens: 1200,
      sistemaFixo: MANUAL_TRIAGEM,
      conteudo: [{ type: 'text', text: variavel }],
      ferramentas: FERRAMENTA_TRIAGEM,
      toolChoice: { type: 'tool', name: 'registrar_triagem' },
    })
    if (r.erro) { resultados.push({ andamento_id: a.id, erro: r.erro }); continue }
    const t = (r.ferramenta && r.ferramenta.input) || null
    if (!t) { resultados.push({ andamento_id: a.id, erro: 'a IA não devolveu a classificação' }); continue }

    const prazoEm = t.exige_peca ? dataPrazo(t.prazo_dias, t.prazo_uteis !== false) : null

    // MESMA publicação chega duas vezes do DJEN (bem comum — dois canais, dois
    // andamento_id diferentes) e cada uma virava um card igual na fila do
    // Estagiário Virtual, mesmo processo, mesmo prazo. A trava de andamento_id
    // (linha 158) não pega isso: são andamentos DIFERENTES falando da MESMA
    // decisão. Aqui, mesmo processo + mesmo prazo já calculado = trata como
    // reforço da publicação já triada, não como pedido novo — um card só.
    let duplicado = null
    if (t.exige_peca && prazoEm) {
      const { data: ex } = await sb.from('robo_minutas')
        .select('id').eq('processo_id', p.id).eq('exige_peca', true).eq('prazo_em', prazoEm).limit(1)
      if (ex && ex.length) duplicado = ex[0].id
    }

    const linha = {
      escritorio_id: ESCRITORIO_CMP, processo_id: p.id, processo_numero: p.numero, andamento_id: a.id,
      status: (t.exige_peca && !duplicado) ? 'triado' : 'sem_peca',
      exige_peca: !!t.exige_peca && !duplicado,
      tipo_peca: String(t.tipo_peca || '').slice(0, 120) || null,
      prazo_dias: parseInt(t.prazo_dias, 10) || null,
      prazo_em: prazoEm,
      urgencia: t.urgencia || null,
      resumo: ((duplicado ? ('[mesma publicação do card já aberto — id ' + duplicado + '] ') : '') + String(t.resumo || '')).slice(0, 600),
      docs_necessarios: Array.isArray(t.docs_necessarios) ? t.docs_necessarios.slice(0, 4) : [],
      instrucao: String(t.instrucao || '').slice(0, 600) || null,
      custo_usd: r.custoUsd,
    }

    // a tarefa de prazo nasce AQUI, junto com a triagem — nunca depende da minuta
    // nem do orçamento. Perder prazo é irreversível; a minuta é conveniência.
    if (t.exige_peca && prazoEm && !duplicado) {
      try {
        const tr = await sb.from('kanban_tarefas').insert({
          escritorio_id: ESCRITORIO_CMP,
          titulo: 'Prazo: ' + (linha.tipo_peca || 'peça') + ' — ' + String(t.resumo || '').slice(0, 70),
          cliente: p.cliente_nome || '—', numero: p.numero, coluna: 'distribuir',
          data: prazoEm, prazo: prazoEm, tipo: 'prazo', origem: 'robo_minuta',
        }).select('id').single()
        linha.tarefa_id = (tr.data && tr.data.id) || null
      } catch (e) {}
    }

    // REDE DE SEGURANÇA DOS EMBARGOS (pedido do dono, 10/08/2026): toda sentença,
    // acórdão ou decisão ganha um prazo de 5 dias para embargos de declaração,
    // INDEPENDENTE de a triagem ter concluído que cabe outra peça — e mesmo quando
    // o resultado foi favorável. Se o caso pedir outro recurso, a equipe altera a
    // tarefa na mão; o que não pode é o prazo não existir.
    // Só vale para decisão RECENTE (ver ATO_RECENTE_DIAS): publicação antiga que
    // reaparece no diário não deve criar prazo de embargos já vencido.
    let embargosEm = null
    if (t.ato_decisorio && atoRecente(a.data)) {
      embargosEm = dataPrazo(EMBARGOS_DIAS, t.prazo_uteis !== false)
      const jaTem = await sb.from('kanban_tarefas')
        .select('id').eq('numero', p.numero).eq('origem', 'robo_embargos').eq('prazo', embargosEm).limit(1)
      // o DJEN repete a mesma decisão em vários canais: sem isto, uma sentença
      // publicada 3 vezes viraria 3 tarefas idênticas de embargos
      if (!jaTem.data || !jaTem.data.length) {
        try {
          await sb.from('kanban_tarefas').insert({
            escritorio_id: ESCRITORIO_CMP,
            titulo: 'Prazo: embargos de declaração (' + EMBARGOS_DIAS + ' dias) — ' + String(t.resumo || 'decisão publicada').slice(0, 70),
            cliente: p.cliente_nome || '—', numero: p.numero, coluna: 'distribuir',
            data: embargosEm, prazo: embargosEm, tipo: 'prazo', origem: 'robo_embargos',
            descricao: 'Prazo aberto automaticamente porque saiu sentença/acórdão/decisão. '
              + 'Confira se cabem embargos (omissão, contradição, obscuridade, erro material) e, se o caso for de outro recurso, altere esta tarefa.',
          })
        } catch (e) {}
      } else { embargosEm = null }
    }

    const ins = await sb.from('robo_minutas').insert(linha).select('id').single()
    resultados.push({
      andamento_id: a.id, numero: p.numero, exige_peca: linha.exige_peca,
      tipo: linha.tipo_peca, prazo_em: prazoEm, embargos_em: embargosEm,
      erro: ins.error ? ins.error.message : null,
    })
  }
  return { triados: resultados.length, restam: novas.length - fila.length, resultados }
}

// ————— fase 2 (padrão): dossiê do Estagiário Virtual —————
// Sem IA nenhuma: só junta o que já temos. O pedido pronto + as peças dos autos
// viram um zip na pasta do processo; a redação acontece fora, no plano mensal.

function semAcento(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') }
function limpaNome(s) { return String(s || 'documento').replace(/[\\/:*?"<>|\r\n\t]+/g, '-').slice(0, 120) }

// O texto que você (ou o Claude) lê primeiro ao abrir o zip.
function pedidoMd({ proc, alvo, intimacao, histTxt, docs, faltando }) {
  const hojeBr = new Date().toISOString().slice(0, 10).split('-').reverse().join('/')
  const prazoBr = alvo.prazo_em ? alvo.prazo_em.split('-').reverse().join('/') : '—'
  return '# Pedido de petição — ' + (alvo.tipo_peca || 'peça') + '\n\n' +
    '> Dossiê montado automaticamente pelo CMPGestão em ' + hojeBr + '. ' +
    'Abra este zip no Claude (plano do escritório) junto com os PDFs anexos e peça a redação.\n\n' +
    '## O que redigir\n\n' +
    'Usando a skill **peticoes-cmp**, redija no padrão CMP a seguinte peça:\n\n' +
    '- **Peça:** ' + (alvo.tipo_peca || '(definir pela intimação abaixo)') + '\n' +
    '- **O que ela deve fazer:** ' + (alvo.instrucao || '(ver a intimação abaixo)') + '\n' +
    '- **Prazo:** ' + (alvo.prazo_dias ? (alvo.prazo_dias + ' dias — vence em ' + prazoBr + ' (confira: a contagem não considera feriados)') : 'verificar na intimação') + '\n' +
    '- **Urgência:** ' + (alvo.urgencia || '—') + '\n\n' +
    '### Regras do escritório (não negociáveis)\n\n' +
    'Não invente dados (CPF, CNPJ, valores, endereços): use `[A PREENCHER]`. ' +
    'Números calculados ou inferidos: marque `[CONFIRMAR]`. ' +
    'Não cite jurisprudência de memória: use `[JURISPRUDÊNCIA A CONFIRMAR: tese]`. ' +
    'Baseie-se somente nesta pasta. Ao final, entregue o **Relatório de teses**. ' +
    'É minuta para revisão do advogado — não protocola.\n\n' +
    '## Processo\n\n' +
    '| | |\n|---|---|\n' +
    '| Número | ' + (proc.numero || '—') + ' |\n' +
    '| Cliente | ' + (proc.cliente_nome || '—') + ' |\n' +
    '| Parte contrária | ' + (proc.oponente || '—') + ' |\n' +
    '| Classe / Assunto | ' + (((proc.classe || '') + ' — ' + (proc.assunto || '')).trim()) + ' |\n' +
    '| Órgão | ' + (proc.orgao || '—') + ' |\n\n' +
    '## Intimação que gerou este pedido\n\n' +
    (alvo.resumo ? ('**Resumo:** ' + alvo.resumo + '\n\n') : '') +
    '```\n' + String(intimacao || '(teor não disponível)').slice(0, 20000) + '\n```\n\n' +
    '## Documentos nesta pasta\n\n' +
    (docs.length ? docs.map((d, i) => (i + 1) + '. `' + d.name + '`' + (d.origem ? (' — ' + d.origem) : '')).join('\n')
                 : '_Nenhum documento localizado nos autos guardados._') + '\n' +
    (faltando ? ('\n> ⚠️ ' + faltando + '\n') : '') + '\n' +
    '## Histórico recente do processo\n\n' +
    '```\n' + (histTxt || '(sem histórico)').slice(0, 12000) + '\n```\n'
}

async function faseDossie(sb) {
  // a mais urgente primeiro: prazo mais curto na frente
  const { data: pend } = await sb.from('robo_minutas')
    .select('id,processo_id,processo_numero,andamento_id,instrucao,tipo_peca,prazo_em,prazo_dias,urgencia,resumo,docs_necessarios')
    .in('status', ['triado', 'sem_orcamento']).eq('exige_peca', true)
    .order('prazo_em', { ascending: true, nullsFirst: false }).limit(1)
  const alvo = pend && pend[0]
  if (!alvo) return { pulou: 'nada na fila' }

  const dig = String(alvo.processo_numero || '').replace(/\D/g, '')
  const { data: proc } = await sb.from('processos')
    .select('id,numero,cliente_nome,oponente,classe,assunto,orgao').eq('id', alvo.processo_id).maybeSingle()
  if (!proc) {
    await sb.from('robo_minutas').update({ status: 'erro', erro: 'processo não encontrado', atualizado_em: new Date().toISOString() }).eq('id', alvo.id)
    return { dossie: false, erro: 'processo não encontrado' }
  }

  // teor da intimação + histórico recente
  const { data: intim } = await sb.from('andamentos').select('texto').eq('id', alvo.andamento_id).maybeSingle()
  const { data: ands } = await sb.from('andamentos').select('data,texto').eq('processo_id', proc.id)
    .order('data', { ascending: false }).limit(30)
  const histTxt = (ands || []).map(a => (a.data || '') + ': ' + String(a.texto || '').replace(/\s+/g, ' ').slice(0, 500)).join('\n')

  // peças: primeiro as do servidor (/opt/cmpdocs), já curadas pelo escritório;
  // depois as que o robô do jus.br já baixou e guardou no banco.
  const chaves = (alvo.docs_necessarios || []).map(semAcento).filter(k => k.length >= 4)
  const pontua = (nome) => { const n = semAcento(nome); return chaves.reduce((acc, k) => acc + (n.indexOf(k) > -1 ? 1 : 0), 0) }

  const locais = []
  coletaPdfs(path.join(ROOT, dig), locais)
  locais.sort((a, b) => (pontua(b.nome) - pontua(a.nome)) || (b.mtime - a.mtime))

  const arquivos = [], listaDocs = []
  let bytes = 0
  const usados = new Set()
  for (const f of locais) {
    if (arquivos.length >= DOSSIE_MAX_DOCS || bytes + f.size > DOSSIE_MAX_BYTES) break
    try {
      const data = fs.readFileSync(f.full)
      const name = 'documentos/' + limpaNome(f.nome)
      arquivos.push({ name, data }); listaDocs.push({ name, origem: 'documentos do processo' })
      usados.add(semAcento(f.nome)); bytes += data.length
    } catch (e) {}
  }
  if (arquivos.length < DOSSIE_MAX_DOCS) {
    const { data: doJus } = await sb.from('jusbr_arquivos')
      .select('doc_nome,doc_tipo,conteudo_b64,caminho_disco').eq('escritorio_id', ESCRITORIO_CMP)
      .eq('processo_numero', proc.numero).order('baixado_em', { ascending: false }).limit(30)
    const ordenados = (doJus || []).sort((a, b) => pontua(b.doc_nome) - pontua(a.doc_nome))
    for (const d of ordenados) {
      if (arquivos.length >= DOSSIE_MAX_DOCS) break
      if (usados.has(semAcento(d.doc_nome))) continue // já veio da pasta do processo
      // depois da faxina o conteúdo fica no disco; o banco guarda só o caminho
      let data
      try { data = d.conteudo_b64 ? Buffer.from(d.conteudo_b64, 'base64') : fs.readFileSync(d.caminho_disco) } catch (e) { continue }
      if (!data.length || bytes + data.length > DOSSIE_MAX_BYTES) continue
      const name = 'documentos/' + limpaNome(d.doc_nome)
      arquivos.push({ name, data }); listaDocs.push({ name, origem: 'baixado do jus.br' })
      usados.add(semAcento(d.doc_nome)); bytes += data.length
    }
  }

  const faltando = listaDocs.length
    ? null
    : 'Nenhum documento dos autos estava guardado no sistema para este processo. Abra o processo no jus.br e use "baixar peças" antes de mandar redigir, ou peça a redação só com o histórico e a intimação acima.'

  const md = pedidoMd({ proc, alvo, intimacao: intim && intim.texto, histTxt, docs: listaDocs, faltando })
  arquivos.unshift({ name: 'PEDIDO.md', data: Buffer.from(md, 'utf8') })

  // grava o zip na pasta "Estagiário Virtual" do processo — aparece direto em
  // "Documentos do processo", pronto para baixar.
  const hoje = new Date().toISOString().slice(0, 10)
  const slug = semAcento(alvo.tipo_peca || 'peca').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'peca'
  const nomeZip = hoje + '_' + slug + '.zip'
  const dir = path.join(ROOT, dig, PASTA_DOSSIE)
  let buf
  try {
    buf = zip(arquivos)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, nomeZip), buf)
  } catch (e) {
    const msg = 'não consegui gravar o dossiê: ' + String((e && e.message) || e)
    await sb.from('robo_minutas').update({ status: 'erro', erro: msg.slice(0, 500), atualizado_em: new Date().toISOString() }).eq('id', alvo.id)
    return { dossie: false, processo: proc.numero, erro: msg }
  }

  // deixa o rastro no histórico do processo, para quem olhar a linha do tempo
  try {
    await sb.from('andamentos').insert({
      processo_id: proc.id, data: hoje, fonte: 'minuta',
      texto: '[ESTAGIÁRIO VIRTUAL] Dossiê pronto para ' + (alvo.tipo_peca || 'a peça') + ': "' + nomeZip +
        '" (instruções + ' + listaDocs.length + ' documento(s)) na pasta "' + PASTA_DOSSIE + '" do processo. ' +
        (alvo.prazo_em ? ('Prazo em ' + alvo.prazo_em.split('-').reverse().join('/') + '. ') : '') +
        'Baixe e mande redigir — depois suba a minuta revisada.',
    })
  } catch (e) {}

  await sb.from('robo_minutas').update({
    status: 'dossie', erro: null,
    dossie_path: dig + '/' + PASTA_DOSSIE + '/' + nomeZip,
    dossie_nome: nomeZip, dossie_bytes: buf.length,
    dossie_docs: listaDocs.map(d => d.name),
    atualizado_em: new Date().toISOString(),
  }).eq('id', alvo.id)

  return {
    dossie: true, processo: proc.numero, arquivo: nomeZip,
    pasta: PASTA_DOSSIE, documentos: listaDocs.length, bytes: buf.length,
    sem_documentos: !!faltando,
  }
}

// ————— fase 3: íntegra dos autos na pasta do processo —————
// SOB PEDIDO, nunca sozinha. Antes bastava a triagem marcar "exige peça" para o
// robô baixar os autos inteiros; o dono viu 126 MB aparecerem numa pasta e
// disse, em 31/08/2026: "o Estagiário Virtual baixou a íntegra desse processo,
// eu não pedi". Agora a fila é só o que alguém marcou na tela (integra_pedida),
// e a íntegra que ninguém pediu simplesmente não é baixada.
// Sem custo de IA: é download do jus.br. Um PDF único por processo, em ordem
// crescente (começa pela petição inicial e vai até a peça mais recente), com
// prefixo "000 - " para ser o primeiro arquivo da pasta. A íntegra anterior é
// substituída — é isso que segura o disco.
async function faseIntegra(sb) {
  // a mais urgente primeiro: prazo mais curto na frente
  const { data: pend } = await sb.from('robo_minutas')
    .select('id,processo_id,processo_numero,prazo_em,integra_em')
    .eq('integra_pedida', true).is('integra_em', null)
    .order('prazo_em', { ascending: true, nullsFirst: false }).limit(1)
  const alvo = pend && pend[0]
  if (!alvo) return { pulou: 'ninguém pediu íntegra' }

  const dig = String(alvo.processo_numero || '').replace(/\D/g, '')
  if (dig.length < 16) {
    await sb.from('robo_minutas').update({ integra_em: new Date().toISOString(), integra_erro: 'número inválido' }).eq('id', alvo.id)
    return { integra: false, erro: 'número de processo inválido' }
  }
  const pastaProc = path.join(ROOT, dig)

  // já existe íntegra recente? então não baixa de novo (economiza tempo e disco)
  try {
    const existentes = fs.readdirSync(pastaProc).filter(n => n.startsWith(INTEGRA_PREFIXO))
    for (const nome of existentes) {
      const st = fs.statSync(path.join(pastaProc, nome))
      if (Date.now() - st.mtimeMs < INTEGRA_VALIDADE_DIAS * 86400000) {
        await sb.from('robo_minutas').update({
          integra_em: new Date().toISOString(), integra_path: dig + '/' + nome,
          integra_bytes: st.size, integra_erro: null,
        }).eq('id', alvo.id)
        return { integra: true, reaproveitou: true, processo: alvo.processo_numero, arquivo: nome }
      }
    }
  } catch (e) { /* pasta ainda não existe — segue e baixa */ }

  const col = await coletarPecas(sb, dig, {})
  if (col.erro) {
    // sessão do jus.br caída é temporário: não marca como resolvido, tenta de novo
    const temporario = col.motivo === 'expirado' || col.motivo === 'sem_token'
    if (!temporario) await sb.from('robo_minutas').update({ integra_em: new Date().toISOString(), integra_erro: String(col.erro).slice(0, 300) }).eq('id', alvo.id)
    return { integra: false, processo: alvo.processo_numero, erro: col.erro, tentar_depois: temporario }
  }
  ordenarPecas(col.files, { ordem: 'asc' }) // crescente: os autos na sequência

  let r
  try { r = await pdfUnico(col.files) } catch (e) { r = { erro: String((e && e.message) || e) } }
  if (r.erro) {
    await sb.from('robo_minutas').update({ integra_em: new Date().toISOString(), integra_erro: String(r.erro).slice(0, 300) }).eq('id', alvo.id)
    return { integra: false, processo: alvo.processo_numero, erro: r.erro }
  }

  const hoje = new Date().toISOString().slice(0, 10)
  const nome = nomeArquivoAutos(true, hoje)
  try {
    fs.mkdirSync(pastaProc, { recursive: true })
    // fora a anterior: só uma íntegra por processo
    try { fs.readdirSync(pastaProc).filter(n => n.startsWith(INTEGRA_PREFIXO) && n !== nome).forEach(n => fs.unlinkSync(path.join(pastaProc, n))) } catch (e) {}
    fs.writeFileSync(path.join(pastaProc, nome), r.bytes)
  } catch (e) {
    const msg = 'não consegui gravar a íntegra: ' + String((e && e.message) || e)
    await sb.from('robo_minutas').update({ integra_em: new Date().toISOString(), integra_erro: msg.slice(0, 300) }).eq('id', alvo.id)
    return { integra: false, processo: alvo.processo_numero, erro: msg }
  }

  try {
    await sb.from('andamentos').insert({
      processo_id: alvo.processo_id, data: hoje, fonte: 'minuta',
      texto: '[ESTAGIÁRIO VIRTUAL] Íntegra dos autos guardada em "' + nome + '" (primeiro arquivo da pasta do processo), ' +
        r.juntados + ' de ' + r.total + ' peça(s) em ordem crescente' + (r.falhos ? (', ' + r.falhos + ' não converteram') : '') + '. ' +
        (col.pulados ? ('Íntegra parcial: ' + col.pulados + ' peça(s) ficaram de fora por tamanho/formato. ') : '') +
        'Substitui a íntegra anterior.',
    })
  } catch (e) {}

  await sb.from('robo_minutas').update({
    integra_em: new Date().toISOString(), integra_path: dig + '/' + nome,
    integra_bytes: r.bytes.length, integra_erro: null,
  }).eq('id', alvo.id)

  return {
    integra: true, processo: alvo.processo_numero, arquivo: nome,
    pecas: r.juntados + '/' + r.total, parcial: col.pulados || 0, bytes: r.bytes.length,
  }
}

// ————— fase 2 (modo 'api'): o robô redige pela API paga —————
async function faseMinuta(sb) {
  const orc = await orcamento(sb)
  if (!orc.ativo) return { pulou: 'robô de minutas desligado no painel' }
  if (orc.restanteUsd < RESERVA_MINUTA_USD) {
    // marca a fila como sem orçamento para o painel explicar por que parou
    await sb.from('robo_minutas').update({ status: 'sem_orcamento', atualizado_em: new Date().toISOString() })
      .eq('status', 'triado').eq('exige_peca', true)
    return { pulou: 'teto do mês atingido', orcamento: orc }
  }

  // a mais urgente primeiro: prazo mais curto na frente
  const { data: pend } = await sb.from('robo_minutas')
    .select('id,processo_numero,instrucao,tipo_peca,prazo_em,docs_necessarios')
    .in('status', ['triado', 'sem_orcamento']).eq('exige_peca', true)
    .order('prazo_em', { ascending: true, nullsFirst: false }).limit(1)
  const alvo = pend && pend[0]
  if (!alvo) return { pulou: 'nada na fila', orcamento: orc }

  await sb.from('robo_minutas').update({ status: 'minutando', erro: null, atualizado_em: new Date().toISOString() }).eq('id', alvo.id)

  const instrucao = alvo.instrucao || ('Redigir ' + (alvo.tipo_peca || 'a peça') + ' cabível diante da última intimação.')
  const r = await gerarMinuta(sb, {
    numero: alvo.processo_numero, instrucao, autor: 'robô', maxFiles: 4,
    docsPreferidos: alvo.docs_necessarios || [], rotina: 'minuta',
    prazoEm: alvo.prazo_em || null,
    tarefaTitulo: 'Revisar e protocolar: ' + (alvo.tipo_peca || 'peça') + ' — ' + String(instrucao).slice(0, 70),
    pecaNome: alvo.tipo_peca || null,
  })
  if (r.erro) {
    await sb.from('robo_minutas').update({ status: 'erro', erro: String(r.erro).slice(0, 500), atualizado_em: new Date().toISOString() }).eq('id', alvo.id)
    return { minuta: false, processo: alvo.processo_numero, erro: r.erro }
  }
  await sb.from('robo_minutas').update({
    status: 'pronta', erro: null,
    minuta_andamento_id: r.andamento_id, minuta_anexo_id: r.anexo_id,
    tarefa_id: r.tarefa_id, custo_usd: r.custo_usd, atualizado_em: new Date().toISOString(),
  }).eq('id', alvo.id)
  return { minuta: true, processo: alvo.processo_numero, arquivo: r.arquivo, docs_usados: r.docs_usados, custo_usd: r.custo_usd }
}

/* Tira da fila os cards cujo trabalho já foi concluído em ALGUMA tarefa — a
   própria ou uma gêmea. Separado da rota para poder ser testado sozinho. */
export function tirarJaFeitas(lista, tarefas) {
  const norm = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
  const perto = (a, b) => {
    if (!a || !b) return false
    const d = Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86400000)
    return Number.isFinite(d) && d <= 7
  }
  const feitas = (tarefas || []).filter(t => t.coluna === 'finalizado' || t.arquivada === true)
  if (!feitas.length) return lista
  return lista.filter(x => !feitas.some(t => {
    if (String(t.numero || '') !== String(x.processo_numero || '')) return false
    if (t.id && x.tarefa_id && t.id === x.tarefa_id) return true
    if (!x.tipo_peca) return false
    return norm(t.titulo).indexOf(norm(x.tipo_peca)) >= 0 && perto(t.prazo, x.prazo_em)
  }))
}

export async function GET(request) {
  try {
    return await _get(request)
  } catch (e) {
    // Sem isto, qualquer exceção aqui vira uma resposta VAZIA do Vercel — e a
    // tela mostrava "Unexpected end of JSON input", que não diz nada a ninguém.
    // Com o erro em JSON, a tela mostra o motivo real.
    return Response.json({ erro: String((e && e.message) || e) }, { status: 500 })
  }
}

async function _get(request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ erro: 'falta service key' }, { status: 500 })
  const { searchParams } = new URL(request.url)
  const sb = admin()

  if (searchParams.get('status') != null) {
    const orc = await orcamento(sb)
    const { data: fila, error: erroFila } = await sb.from('robo_minutas')
      .select('id,tarefa_id,processo_id,processo_numero,status,tipo_peca,prazo_em,urgencia,resumo,dossie_nome,dossie_path,dossie_bytes,integra_path,integra_bytes,integra_erro,integra_pedida,integra_pedida_por,minuta_anexo_id,erro,criado_em')
      // prazo mais próximo primeiro — é a ordem em que o trabalho tem que sair.
      // Sem prazo vai para o fim; empate desempata pela triagem mais recente.
      .eq('exige_peca', true)
      .order('prazo_em', { ascending: true, nullsFirst: false })
      .order('criado_em', { ascending: false })
      .limit(40)
    if (erroFila) return Response.json({ erro: 'fila: ' + erroFila.message }, { status: 500 })
    let lista = fila || []
    // processo arquivado/encerrado/suspenso depois da triagem: o card sai da fila
    // (a triagem já filtra isso na entrada, mas o status do processo muda depois)
    const pids = [...new Set(lista.map(x => x.processo_id).filter(Boolean))]
    if (pids.length) {
      const { data: procs } = await sb.from('processos').select('id,status,suspenso').in('id', pids)
      const fora = new Set((procs || []).filter(p => /arquiv|encerr|baixad/i.test(String(p.status || '')) || p.suspenso === true).map(p => p.id))
      lista = lista.filter(x => !fora.has(x.processo_id))
    }
    // tarefa do Kanban concluída (ou apagada) = trabalho feito → o card sai da fila
    const tids = lista.map(x => x.tarefa_id).filter(Boolean)
    if (tids.length) {
      const { data: ts } = await sb.from('kanban_tarefas').select('id,coluna,arquivada').in('id', tids)
      const abertas = new Set((ts || []).filter(t => t.coluna !== 'finalizado' && t.arquivada !== true).map(t => t.id))
      lista = lista.filter(x => !x.tarefa_id || abertas.has(x.tarefa_id))
    }
    // ——— tarefas GÊMEAS ———
    // A mesma decisão já chegou duas vezes do DJEN e gerou DUAS linhas e DUAS
    // tarefas quase idênticas (0000348-93.2026.5.05.0017: prazos 26 e 27/08,
    // mesmo tipo de peça). Concluída uma, a outra continuava na fila e o dono
    // via na tela um trabalho que já tinha feito. Para a fila, tarefa gêmea
    // concluída é o mesmo trabalho concluído: mesmo processo, mesmo tipo de
    // peça e prazo a até 7 dias de distância — a folga cobre a diferença de um
    // dia entre a contagem da triagem e a da tarefa.
    const nums = [...new Set(lista.map(x => x.processo_numero).filter(Boolean))]
    if (nums.length) {
      const { data: ts2 } = await sb.from('kanban_tarefas')
        .select('id,numero,titulo,prazo,coluna,arquivada').eq('origem', 'robo_minuta').in('numero', nums)
      lista = tirarJaFeitas(lista, ts2 || [])
    }
    const { count: semPeca } = await sb.from('robo_minutas').select('id', { count: 'exact', head: true }).eq('exige_peca', false)
    return Response.json({ ok: true, orcamento: orc, modo: await modoAtual(sb), fila: lista, arquivadas_sem_peca: semPeca || 0 })
  }

  const orc = await orcamento(sb)
  if (!orc.ativo) return Response.json({ ok: true, pulou: 'robô desligado no painel' })

  const fase = searchParams.get('fase') || 'triagem'
  // fase 3: íntegra dos autos (download do jus.br, sem custo de IA)
  if (fase === 'integra') return Response.json({ ok: true, fase, ...(await faseIntegra(sb)) })
  // fase 2: dossiê (padrão, sem custo) ou minuta pela API, conforme ia_config.modo
  if (fase === 'dossie' || fase === 'minuta') {
    const modo = await modoAtual(sb)
    if (modo === 'api') {
      if (!process.env.ANTHROPIC_API_KEY) return Response.json({ erro: 'falta ANTHROPIC_API_KEY' }, { status: 501 })
      return Response.json({ ok: true, fase: 'minuta', modo, ...(await faseMinuta(sb)) })
    }
    return Response.json({ ok: true, fase: 'dossie', modo, ...(await faseDossie(sb)) })
  }

  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ erro: 'falta ANTHROPIC_API_KEY' }, { status: 501 })

  const limite = Math.min(parseInt(searchParams.get('limite') || '', 10) || LOTE_TRIAGEM, 40)
  const t = await faseTriagem(sb, limite)
  return Response.json({ ok: true, fase: 'triagem', gasto_mes_brl: Math.round(orc.gastoBrl * 100) / 100, ...t })
}
