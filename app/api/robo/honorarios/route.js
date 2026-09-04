// Robô de honorários — lê os documentos do processo (petição inicial, sentença/
// acórdão, procuração/contrato de honorários) guardados em /opt/cmpdocs e extrai
// SOMENTE o que estiver escrito neles: valor da causa, valor da condenação e os
// percentuais de honorários (contratual, sucumbência, execução). Nunca inventa.
//
//   POST /api/robo/honorarios  (Authorization: Bearer <jwt>)  { numero }
//
// O que falta depois de ler o documento é preenchido pela regra padrão do
// escritório (planilha de honorários): trabalhista 30%, cível 20%, execução 10%,
// sucumbência 10% — sempre sobre a MELHOR base disponível (condenação > causa).
//
// Nunca sobrescreve um valor que o advogado digitou à mão na ficha (hon_origem
// = 'manual', marcado por salvarHon() no sistema.html) nem um valor de condenação
// já lançado — divergência só é reportada, não substituída (ver CLAUDE.md: sempre
// confirmar antes de sobrescrever dado financeiro já preenchido).

import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { chamarClaude } from '../../_ia/claude.js'
import { coletaPdfs, ROOT, ESCRITORIO_CMP } from '../../peticao/core.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 180

const MAX_DOCS = 8
const MAX_BYTES = 28 * 1024 * 1024
const PCT_PADRAO = { trabalhista: 30, civel: 20, execucao: 10, sucumbencia: 10 }

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}
async function usuario(request) {
  const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
    const u = await sb.auth.getUser(jwt)
    return (u && u.data && u.data.user) || null
  } catch (e) { return null }
}

function ehTrabalhista(numero) {
  const m = String(numero || '').replace(/\D/g, '')
  return m.length >= 16 && m.slice(13, 14) === '5'
}
function semAcento(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') }

// mesma classificação de fase do sistema.html (guessFase/faseDoProc) — precisa
// ficar idêntica, senão o robô e a tela discordam sobre o que é "julgado"
function guessFase(hist6, tipoAssunto, classe, status) {
  const t = (hist6 + '  ' + tipoAssunto + '  ' + status).toLowerCase()
  const cls = (tipoAssunto + ' ' + classe).toLowerCase()
  if (/agravo de instrumento/.test(cls)) return 'decis'
  if (/apela[çc][ãa]o|recurso inominado|recurso especial|recurso extraordin[áa]rio|embargos infringentes/.test(cls)) return 'recur'
  if (/cumprimento de senten|cumprimento provis[óo]rio|cumprimento definitivo|execu[çc][ãa]o de t[íi]tulo|execu[çc][ãa]o fiscal/.test(cls)) return 'exec'
  if (/expedi[çc][ãa]o de alvar|expedir (o )?alvar|alvar[áa] (de levantamento|eletr[ôo]nico|judicial|expedido)|levantamento de valores|levantamento de dep[óo]sito|libera[çc][ãa]o de valores|transfer[êe]ncia dos valores|conta judicial.*levant/.test(t)) return 'alvara'
  if (/cumprimento de senten|cumprimento provis[óo]rio|cumprimento definitivo|execu[çc][ãa]o de t[íi]tulo|execu[çc][ãa]o fiscal|\bexecu[çc][ãa]o\b|\bpenhora|sisbajud|bacenjud|renajud|infojud|precat[óo]|requisi[çc][ãa]o de pequeno valor|\brpv\b|liquida[çc][ãa]o de senten|adjudica|arremata|leil[ãa]o|hasta p[úu]blica|bloqueio de valores|impugna[çc][ãa]o ao cumprimento/.test(t)) return 'exec'
  if (/apela[çc][ãa]o|\bapelo\b|2º grau|segundo grau|inst[âa]ncia superior|superior tribunal|\bstj\b|\bstf\b|turma recursal|recurso inominado|recurso especial|recurso extraordin[áa]rio|contrarraz[õo]es (de|à) apela|subida dos autos|remessa (ao|dos autos ao) tribunal|distribu[íi]do.*(desembargador|relator)|conclus[ão].*relator|ac[óo]rd[ãa]o/.test(t)) return 'recur'
  if (/conclus[ãao].*(senten|julgamento|decis[ãa]o)|para senten[çc]a|aguardando senten|senten[çc]a|julgad|proced[êe]ncia|improced|homolog|resolvo o m[ée]rito|agravo de instrumento|tutela antecipada|tutela de urg[êe]ncia|tutela provis[óo]ria|liminar|decis[ãa]o interlocut[óo]ria/.test(t)) return 'decis'
  if (/audi[êe]ncia|\baij\b|instru[çc][ãa]o e julgamento|per[íi]cia|per[íi]cial|laudo|oitiva|depoimento|testemunh|especificar provas|especifica[çc][ãa]o de provas|produ[çc][ãa]o de provas|rol de testemunh|design(ada|ado|ação) de audi/.test(t)) return 'instr'
  if (/emenda (à|a) inicial|emende a inicial|emendar a inicial|juntar (novos )?documento|junte (os )?documento|comprovar (a )?(hipossufici[êe]ncia|gratuidade|renda)|comprove (a )?(hipossufici[êe]ncia|gratuidade)|declara[çc][ãa]o de hipossufici|documento(s)? faltante|regularizar (a )?representa|procura[çc][ãa]o|custas iniciais|recolher (as )?custas|indefer.*gratuidade|sanea|pontos controvertid|despacho saneador/.test(t)) return 'sane'
  return 'post'
}
const FASES_JULGADO = new Set(['recur', 'exec', 'alvara'])

const MANUAL_HONORARIOS =
  'Você é o(a) analista financeiro(a) de um escritório de advocacia brasileiro. Recebe documentos de UM processo (petição inicial, sentença/acórdão, procuração ou contrato de honorários) e tem uma única tarefa: extrair os valores e percentuais financeiros que estiverem EXPLICITAMENTE escritos nesses documentos.\n\n' +
  'O QUE EXTRAIR:\n' +
  '- valor_causa: o valor da causa, como consta na petição inicial (ou na capa/autuação do processo).\n' +
  '- valor_condenacao: o valor líquido da condenação/acordo homologado, como fixado no DISPOSITIVO da sentença ou do acórdão (se houve recurso, prevalece o valor do acórdão mais recente). Se a sentença não liquidar o valor (condenação genérica, "a apurar em liquidação"), NÃO preencha.\n' +
  '- pct_contratual: o percentual de honorários CONTRATUAIS combinado com o cliente, como consta na procuração ou no contrato de honorários (cláusula de honorários / quota litis).\n' +
  '- pct_sucumbencia: o percentual de honorários de SUCUMBÊNCIA fixado pelo juiz na sentença/acórdão (art. 85 do CPC).\n' +
  '- pct_execucao: o percentual de honorários de execução/cumprimento de sentença, SE houver menção específica (raro na sentença de conhecimento — normalmente fica vazio).\n\n' +
  'REGRAS CRÍTICAS: use SOMENTE o que está escrito nos documentos anexados — nunca calcule, nunca estime, nunca deduza um percentual a partir de um valor em reais (se o documento só traz o valor em R$, não um percentual, deixe o percentual vazio). Se um dado não aparecer em nenhum documento, marque encontrado=false e deixe valor vazio — é preferível devolver vazio a inventar. Para cada campo encontrado, copie o número exatamente como está escrito e cite o trecho (até 200 caracteres) que sustenta o achado. Responda SEMPRE chamando a ferramenta registrar_honorarios.'

const FERRAMENTA_HONORARIOS = [{
  name: 'registrar_honorarios',
  description: 'Registra os valores/percentuais financeiros encontrados nos documentos do processo.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      valor_causa: { type: 'object', properties: { encontrado: { type: 'boolean' }, valor: { type: 'number' }, trecho: { type: 'string' } }, required: ['encontrado', 'valor', 'trecho'], additionalProperties: false },
      valor_condenacao: { type: 'object', properties: { encontrado: { type: 'boolean' }, valor: { type: 'number' }, trecho: { type: 'string' } }, required: ['encontrado', 'valor', 'trecho'], additionalProperties: false },
      pct_contratual: { type: 'object', properties: { encontrado: { type: 'boolean' }, valor: { type: 'number' }, trecho: { type: 'string' } }, required: ['encontrado', 'valor', 'trecho'], additionalProperties: false },
      pct_sucumbencia: { type: 'object', properties: { encontrado: { type: 'boolean' }, valor: { type: 'number' }, trecho: { type: 'string' } }, required: ['encontrado', 'valor', 'trecho'], additionalProperties: false },
      pct_execucao: { type: 'object', properties: { encontrado: { type: 'boolean' }, valor: { type: 'number' }, trecho: { type: 'string' } }, required: ['encontrado', 'valor', 'trecho'], additionalProperties: false },
    },
    required: ['valor_causa', 'valor_condenacao', 'pct_contratual', 'pct_sucumbencia', 'pct_execucao'],
    additionalProperties: false,
  },
}]

export async function POST(request) {
  const user = await usuario(request)
  if (!user) return Response.json({ erro: 'não autenticado' }, { status: 401 })
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ erro: 'IA não configurada no servidor (falta ANTHROPIC_API_KEY).' }, { status: 501 })
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ erro: 'falta SUPABASE_SERVICE_ROLE_KEY no servidor.' }, { status: 500 })

  let body
  try { body = await request.json() } catch (e) { return Response.json({ erro: 'json inválido' }, { status: 400 }) }
  const dig = String(body.numero || '').replace(/\D/g, '')
  if (dig.length < 16) return Response.json({ erro: 'número de processo inválido' }, { status: 400 })

  const sb = admin()
  const { data: proc } = await sb.from('processos')
    .select('id,numero,cliente_nome,classe,assunto,status,fase,valor_causa,valor_condenacao,hon_val_contratual,hon_val_sucumbencia,hon_val_execucao,hon_pct_contratual,hon_pct_sucumbencia,hon_pct_execucao,hon_origem')
    .eq('escritorio_id', ESCRITORIO_CMP).eq('numero_digitos', dig).maybeSingle()
  if (!proc) return Response.json({ erro: 'processo não encontrado no sistema' }, { status: 404 })
  if (proc.hon_origem === 'manual') {
    return Response.json({ ok: true, pulou: 'os valores deste processo foram digitados à mão — o robô não sobrescreve. Apague o valor no quadro de Honorários se quiser que o robô preencha de novo.' })
  }

  const trab = ehTrabalhista(proc.numero)

  // fase (julgado ou não) pelo mesmo critério da tela — precisa do histórico recente
  const { data: ands } = await sb.from('andamentos').select('texto').eq('processo_id', proc.id).order('data', { ascending: false }).limit(6)
  const hist6 = (ands || []).map(a => a.texto || '').join('  ')
  const fase = proc.fase || guessFase(hist6, proc.assunto || '', proc.classe || '', proc.status || '')
  const julgado = FASES_JULGADO.has(fase)

  // PDFs da pasta do processo — prioriza pelo que falta encontrar
  const chaves = []
  if (julgado && !proc.valor_condenacao) chaves.push('sentenc', 'acordao', 'julgamento', 'dispositivo')
  if (!proc.valor_causa) chaves.push('inicial', 'exordial')
  chaves.push('procuracao', 'honorarios', 'contrato')
  const arr = []
  coletaPdfs(path.join(ROOT, dig), arr)
  if (!arr.length) return Response.json({ ok: true, processo: proc.numero, sem_documentos: true, aviso: 'Nenhum PDF encontrado na pasta deste processo — nada para ler.' })
  const pontua = (nome) => { const n = semAcento(nome); return chaves.reduce((acc, k) => acc + (n.indexOf(k) > -1 ? 1 : 0), 0) }
  arr.sort((a, b) => (pontua(b.nome) - pontua(a.nome)) || (b.mtime - a.mtime))

  const content = []
  let bytes = 0, usados = 0
  const nomesUsados = []
  for (const f of arr) {
    if (usados >= MAX_DOCS) break
    if (bytes + f.size > MAX_BYTES) continue
    try {
      const buf = fs.readFileSync(f.full)
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } })
      bytes += f.size; usados++; nomesUsados.push(f.nome)
    } catch (e) {}
  }
  if (!usados) return Response.json({ ok: true, processo: proc.numero, sem_documentos: true, aviso: 'Não consegui ler nenhum PDF da pasta deste processo.' })

  const pedido =
    'PROCESSO nº ' + proc.numero + ' | Cliente: ' + (proc.cliente_nome || '') + ' | Classe/Assunto: ' + ((proc.classe || '') + ' ' + (proc.assunto || '')).trim() +
    ' | ' + (trab ? 'Justiça do Trabalho' : 'não trabalhista') + ' | Fase: ' + (julgado ? 'já julgado (há sentença/acórdão)' : 'ainda não julgado') + '.\n\n' +
    'Documentos anexados: ' + nomesUsados.join('; ') + '.'
  content.push({ type: 'text', text: pedido })

  const r = await chamarClaude({
    rotina: 'honorarios', sb, ref: proc.numero, escritorioId: ESCRITORIO_CMP,
    modelo: 'claude-sonnet-5', maxTokens: 2000,
    sistemaFixo: MANUAL_HONORARIOS, conteudo: content,
    ferramentas: FERRAMENTA_HONORARIOS, toolChoice: { type: 'tool', name: 'registrar_honorarios' },
  })
  if (r.erro) return Response.json({ erro: r.erro }, { status: r.status || 502 })
  const achou = (r.ferramenta && r.ferramenta.input) || null
  if (!achou) return Response.json({ erro: 'a IA não retornou a extração' }, { status: 502 })

  const upd = {}
  const relatorio = []
  const conflitos = []

  // valor_causa / valor_condenacao: só preenche o que está vazio; se já havia
  // valor e o documento traz outro, reporta o conflito em vez de sobrescrever
  ;[['valor_causa', 'valor_causa'], ['valor_condenacao', 'valor_condenacao']].forEach(([campoDoc, campoDb]) => {
    const a = achou[campoDoc]
    if (!a || !a.encontrado || !(Number(a.valor) > 0)) return
    const atual = Number(proc[campoDb]) || 0
    if (atual > 0) {
      if (Math.abs(atual - Number(a.valor)) > Math.max(1, atual * 0.01)) {
        conflitos.push({ campo: campoDb, no_sistema: atual, no_documento: Number(a.valor), trecho: a.trecho })
      }
    } else {
      upd[campoDb] = Number(a.valor)
      relatorio.push(campoDb + ' = ' + Number(a.valor).toFixed(2) + ' (achado no documento: "' + (a.trecho || '').slice(0, 160) + '")')
    }
  })

  const causaBase = upd.valor_causa || proc.valor_causa || 0
  const condBase = upd.valor_condenacao || proc.valor_condenacao || 0
  const base = condBase > 0 ? condBase : causaBase

  if (base > 0) {
    const pctC = (achou.pct_contratual && achou.pct_contratual.encontrado && achou.pct_contratual.valor > 0) ? Number(achou.pct_contratual.valor) : (trab ? PCT_PADRAO.trabalhista : PCT_PADRAO.civel)
    const pctS = (achou.pct_sucumbencia && achou.pct_sucumbencia.encontrado && achou.pct_sucumbencia.valor > 0) ? Number(achou.pct_sucumbencia.valor) : PCT_PADRAO.sucumbencia
    upd.hon_pct_contratual = pctC
    upd.hon_val_contratual = Math.round(base * pctC) / 100
    upd.hon_pct_sucumbencia = pctS
    upd.hon_val_sucumbencia = Math.round(base * pctS) / 100
    if (!trab) {
      const pctE = (achou.pct_execucao && achou.pct_execucao.encontrado && achou.pct_execucao.valor > 0) ? Number(achou.pct_execucao.valor) : PCT_PADRAO.execucao
      upd.hon_pct_execucao = pctE
      upd.hon_val_execucao = Math.round(base * pctE) / 100
    }
    const veioDoDocumento = (achou.pct_contratual && achou.pct_contratual.encontrado) || (achou.pct_sucumbencia && achou.pct_sucumbencia.encontrado) || (achou.pct_execucao && achou.pct_execucao.encontrado)
    upd.hon_origem = veioDoDocumento ? 'documento' : 'estimado_formula'
    upd.hon_atualizado_em = new Date().toISOString().slice(0, 10)
    relatorio.push('honorários recalculados sobre ' + (condBase > 0 ? 'a condenação' : 'o valor da causa') + ' (R$ ' + base.toFixed(2) + '), contratual ' + pctC + '%' + (achou.pct_contratual && achou.pct_contratual.encontrado ? ' (do documento)' : ' (padrão)'))
  }

  if (Object.keys(upd).length) {
    const { error } = await sb.from('processos').update(upd).eq('id', proc.id)
    if (error) return Response.json({ erro: 'não consegui gravar: ' + error.message }, { status: 500 })
  }

  return Response.json({
    ok: true, processo: proc.numero, docs_usados: nomesUsados,
    atualizado: upd, achados: achou, conflitos,
    relatorio: relatorio.length ? relatorio : ['nenhum dado novo encontrado nos documentos — mantidos os percentuais padrão já lançados'],
    custo_usd: r.custoUsd,
  })
}
