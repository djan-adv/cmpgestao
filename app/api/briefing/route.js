// Briefing da tarefa — o resumo que o advogado leva para a IA redigir a peça.
//
//   POST /api/briefing   { numero, tarefa, detalhes }
//     (Authorization: Bearer <jwt do Supabase>)
//
// Pedido do dono (26/08/2026): "chega uma intimação, eu faço uma tarefa de pedir
// gratuidade, por exemplo. o sistema lê a ficha do processo, inicial, dados,
// últimos 2 despachos e prepara o resumo do que vou pedir à IA — sem eu precisar
// baixar mais documentos".
//
// O QUE ISTO NÃO É: não redige a peça. Entrega o CONTEXTO pronto (qualificação
// das partes, juízo, número, o que a tarefa pede e o que os últimos despachos
// determinaram) para o advogado ler, conferir e levar à IA. Ver a peça pronta é
// /api/peticao — e este mesmo briefing serve de entrada para ela depois.
//
// De onde sai cada coisa:
//   • ficha e partes -> tabela processos;
//   • despachos/decisões -> andamentos COM teor (o título solto do DataJud não
//     serve: "Expedição de Carta" não diz o que foi determinado);
//   • qualificação das partes -> petição inicial da pasta do processo, lida pela
//     IA direto do PDF (não há extrator de texto no servidor, e mandar o PDF é o
//     que /api/peticao já faz).
//
// Custo: uma chamada de IA por briefing, com o manual no bloco cacheado (regra
// do projeto — ver app/api/_ia/claude.js).

import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { chamarClaude } from '../_ia/claude.js'
import { ROOT, ESCRITORIO_CMP, coletaPdfs } from '../peticao/core.js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 300

const MAX_PDF_BYTES = 12 * 1024 * 1024   // teto do que vai à IA por briefing
const MAX_PDFS = 3

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
const semAcento = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const brData = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—')

// Despacho/decisão que INTERESSA: tem teor de verdade. Título de movimento do
// DataJud ("Expedição de Carta", "Decurso de Prazo") não diz o que foi
// determinado, e é justamente isso que a peça precisa responder.
const RE_DECISORIO = /despach|decis|senten|ac[óo]rd|determin|intim|manifest|emenda|indefer|defer/i

// O MANUAL é o prefixo FIXO — byte a byte idêntico entre chamadas. É ele que
// leva o cache_control em chamarClaude. Nada de dados do processo aqui.
const MANUAL_BRIEFING =
  'Você é o(a) analista do escritório Crispim, Mendonça e Pinheiro (CMP). Sua tarefa é montar o BRIEFING que o advogado levará para redigir uma petição — você NÃO redige a peça.\n\n' +
  'Você recebe: (a) a tarefa que o advogado criou, (b) os dados de cadastro do processo, (c) os últimos despachos/decisões com teor, e (d) quando disponível, a petição inicial em PDF.\n\n' +
  'ENTREGUE exatamente estas seções, nesta ordem, em Markdown:\n\n' +
  '## O que precisa ser feito\n' +
  'Uma frase dizendo qual peça redigir e o que ela tem de conseguir. Saia do genérico: diga o pedido concreto.\n\n' +
  '## Qualificação das partes\n' +
  'Nome completo, CPF/CNPJ, estado civil, profissão, RG, endereço — de autor e réu, como constam na inicial. Um item por parte.\n\n' +
  '## Juízo e processo\n' +
  'Número, vara/órgão, comarca, classe, assunto e valor da causa.\n\n' +
  '## O que os últimos atos determinaram\n' +
  'Em ordem cronológica inversa, o que cada despacho/decisão recente decidiu ou exigiu, com a data. Só o que muda o que a peça precisa dizer.\n\n' +
  '## Fatos da inicial que sustentam o pedido\n' +
  'Os fatos já narrados nos autos que servem de base — para a peça não repetir o que já está dito nem contradizê-lo.\n\n' +
  '## O que falta e o advogado precisa fornecer\n' +
  'Lista objetiva do que NÃO está nos autos lidos e sem o que a peça não fica completa. Se não faltar nada, escreva "Nada — os autos lidos bastam".\n\n' +
  'REGRAS INEGOCIÁVEIS:\n' +
  '- Use SOMENTE o que está nos documentos e dados recebidos. Não complete de memória, não deduza, não estime.\n' +
  '- Dado que você NÃO encontrou: escreva "não consta nos autos lidos". NUNCA invente e NUNCA escreva um valor de exemplo, um nome fictício ou um espaço a preencher no lugar de um dado real.\n' +
  '- Não cite jurisprudência: o briefing é de fatos e dados, não de tese.\n' +
  '- Não redija a petição, nem trechos dela. Isto é insumo, não peça.\n' +
  '- Português do Brasil, direto, sem preâmbulo e sem repetir estas instruções.'

export async function POST(request) {
  const u = await usuario(request)
  if (!u) return Response.json({ erro: 'não autenticado' }, { status: 401 })

  let b = {}
  try { b = await request.json() } catch (e) { return Response.json({ erro: 'corpo inválido' }, { status: 400 }) }
  const dig = String(b.numero || '').replace(/\D/g, '')
  const tarefa = String(b.tarefa || '').trim()
  const detalhes = String(b.detalhes || '').trim()
  if (dig.length < 8) return Response.json({ erro: 'número de processo inválido' }, { status: 400 })
  if (!tarefa) return Response.json({ erro: 'a tarefa não tem título — descreva o que precisa ser feito' }, { status: 400 })

  const sb = admin()

  // ——— ficha ———
  const { data: proc } = await sb.from('processos')
    .select('id,numero,cliente_nome,oponente,classe,assunto,orgao,orgao_atual,foro,valor_causa,distribuido_em')
    .eq('escritorio_id', ESCRITORIO_CMP).eq('numero_digitos', dig).maybeSingle()
  if (!proc) return Response.json({ erro: 'processo não encontrado no sistema' }, { status: 404 })

  // ——— últimos atos COM teor ———
  // Puxa uma janela maior e peneira aqui: o que tem teor é minoria, e pegar só
  // os 2 últimos andamentos traria "Expedição de Carta" sem dizer o que o juízo
  // determinou.
  const { data: ands } = await sb.from('andamentos')
    .select('data,texto,teor,fonte')
    .eq('processo_id', proc.id).not('data', 'is', null)
    .order('data', { ascending: false }).limit(60)
  const comTeor = (ands || []).filter(a => {
    const t = String(a.teor || '')
    return t.replace(/\s/g, '').length > 120 && RE_DECISORIO.test(String(a.texto || '') + ' ' + t)
  }).slice(0, 2)
  // rede de segurança: sem nenhum teor, manda os títulos recentes — é pouco, mas
  // é honesto, e o briefing avisa que faltou.
  const semTeor = comTeor.length ? [] : (ands || []).slice(0, 8)

  // ——— petição inicial da pasta ———
  const arr = []
  try { coletaPdfs(path.join(ROOT, dig), arr) } catch (e) {}
  const ehInicial = (f) => /inicial|peti[cç]/.test(semAcento(f.nome))
  // a íntegra dos autos COMEÇA pela petição inicial — para efeito de
  // qualificação das partes ela vale como inicial, e é a melhor fonte quando o
  // arquivo da inicial não está solto na pasta (ver /api/jusbr/integra/guardar)
  const ehIntegra = (f) => /^000 - integra dos autos/.test(semAcento(f.nome))
  const serve = (f) => ehInicial(f) || ehIntegra(f)
  arr.sort((a, b2) => (serve(b2) - serve(a)) || (ehInicial(b2) - ehInicial(a)) || (b2.mtime - a.mtime))

  const content = []
  const nomesPdf = []
  let bytes = 0
  let achouInicial = false
  let grandeDemais = null   // a inicial/íntegra existe, mas não cabe nesta leitura
  for (const f of arr) {
    if (nomesPdf.length >= MAX_PDFS) break
    // depois da inicial não varre a pasta inteira; sem inicial, manda só o PDF
    // mais recente — é melhor que nada, mas NÃO conta como inicial (ver
    // achouInicial): dizer que leu a inicial quando leu outra coisa faria o
    // advogado confiar numa qualificação que não veio dos autos certos.
    if (!serve(f) && nomesPdf.length) break
    if (bytes + f.size > MAX_PDF_BYTES) { if (serve(f)) grandeDemais = f.nome; continue }
    try {
      const buf = fs.readFileSync(f.full)
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } })
      bytes += f.size; nomesPdf.push(f.nome)
      if (serve(f)) achouInicial = true
    } catch (e) {}
  }

  // ——— bloco VARIÁVEL (sempre depois do breakpoint de cache) ———
  const linhasAtos = (comTeor.length ? comTeor : semTeor).map(a =>
    '- ' + brData(a.data) + ' — ' + String(a.texto || '').replace(/\s+/g, ' ').slice(0, 300) +
    (a.teor ? ('\n\n```\n' + String(a.teor).replace(/\s+/g, ' ').slice(0, 8000) + '\n```') : '')
  ).join('\n')

  const variavel =
    'TAREFA CRIADA PELO ADVOGADO\n' + tarefa + (detalhes ? ('\nDetalhes: ' + detalhes) : '') + '\n\n' +
    'CADASTRO DO PROCESSO (o que o sistema já sabe)\n' +
    '- Número: ' + (proc.numero || '—') + '\n' +
    '- Cliente (nosso): ' + (proc.cliente_nome || '—') + '\n' +
    '- Parte contrária: ' + (proc.oponente || '—') + '\n' +
    '- Classe: ' + (proc.classe || '—') + '\n' +
    '- Assunto: ' + (proc.assunto || '—') + '\n' +
    '- Órgão de origem: ' + (proc.orgao || proc.foro || '—') + '\n' +
    '- Órgão atual: ' + (proc.orgao_atual || '—') + '\n' +
    '- Valor da causa: ' + (proc.valor_causa != null ? proc.valor_causa : '—') + '\n' +
    '- Distribuído em: ' + brData(proc.distribuido_em) + '\n\n' +
    (comTeor.length
      ? ('ÚLTIMOS DESPACHOS/DECISÕES COM TEOR\n' + linhasAtos + '\n\n')
      : ('ATENÇÃO: nenhum despacho/decisão com teor foi encontrado nos autos guardados. Abaixo vão só os TÍTULOS dos movimentos recentes — diga na seção "O que falta" que o teor da última decisão precisa ser juntado.\n' + linhasAtos + '\n\n')) +
    (nomesPdf.length
      ? ('PDFs anexados a esta mensagem: ' + nomesPdf.join(', ') + '\n' +
         (achouInicial ? '' : 'ATENÇÃO: NENHUM destes é a petição inicial — ela não está na pasta. A qualificação das partes NÃO pôde ser lida dos autos; diga isso na seção "O que falta" em vez de deduzi-la.\n'))
      : 'Nenhum documento foi encontrado na pasta do processo — a qualificação das partes não pôde ser lida dos autos. Diga isso na seção "O que falta".\n') +
    (grandeDemais ? ('ATENÇÃO: o arquivo "' + grandeDemais + '" está na pasta do processo mas é grande demais para ser lido aqui. A qualificação precisa ser conferida nele à mão.\n') : '')

  content.push({ type: 'text', text: variavel })

  const r = await chamarClaude({
    rotina: 'briefing_tarefa',
    sistemaFixo: MANUAL_BRIEFING,
    conteudo: content,
    maxTokens: 4000,
    sb,
    ref: proc.numero,
    escritorioId: ESCRITORIO_CMP,
  })
  if (r.erro) return Response.json({ erro: r.erro }, { status: r.status || 502 })

  return Response.json({
    ok: true,
    numero: proc.numero,
    briefing: r.texto,
    lido: {
      despachos_com_teor: comTeor.length,
      pdfs: nomesPdf,
      // o que a IA NÃO teve — para a tela poder avisar sem depender do texto dela
      sem_teor: comTeor.length === 0,
      sem_inicial: !achouInicial,
      grande_demais: grandeDemais,
    },
    custo_usd: r.custoUsd || null,
  })
}
