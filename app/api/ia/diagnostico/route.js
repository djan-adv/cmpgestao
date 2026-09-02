// Diagnóstico processual — o botão que lê os autos e diz o que fazer.
//
//   POST /api/ia/diagnostico  { numero, integra?, peca? }
//
// O caminho, na ordem:
//   1. garante a ÍNTEGRA dos autos na pasta (a mesma do Estagiário Virtual);
//   2. manda a íntegra + o histórico oficial ao Claude, com as skills do
//      escritório (analise-autos, cível/consumidor, red team, peças) como
//      prefixo FIXO — é ele que leva o cache_control, conforme o CLAUDE.md;
//   3. devolve o diagnóstico estruturado para a tela;
//   4. se pedirem a peça, redige com o gerarMinuta de sempre e grava .doc
//      (para editar) e .pdf (para protocolar) na pasta Protocolo.
//
// NÃO protocola. O botão de protocolar continua sendo um ato do advogado, e a
// peça sai marcada como rascunho até ele conferir.

import fs from 'fs'
import path from 'path'
import { createClient } from '@supabase/supabase-js'
import { chamarClaude, orcamento } from '../../_ia/claude.js'
import { gerarMinuta, ROOT, ESCRITORIO_CMP } from '../../peticao/core.js'
import { pecaEmPdf } from '../../../../lib/peca-pdf.js'
import { getFreshToken } from '../../jusbr/lib.js'
import { buscarProcesso, movimentosDoProcesso, aplicarMeta, gravarMovimentos } from '../../jusbr/movimentos/core.js'
import { coletarPecas, ordenarPecas, pdfUnico, salvarNaPasta } from '../../jusbr/integra/core.js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 900

const MAX_B64 = 22 * 1024 * 1024   // teto medido em base64: a API recusa acima de 32 MB de requisição
const b64de = (n) => Math.ceil(Number(n || 0) / 3) * 4
const INTEGRA_PREFIXO = '000 - ÍNTEGRA DOS AUTOS'

/* dinheiro: o custo é cobrado em dólar, mas quem lê o histórico pensa em real.
   O câmbio é o mesmo do teto mensal (ia_config.cambio_usd_brl), lido por rodada. */
let _cambio = 5.4
function brl(usd) { return Math.round((Number(usd) || 0) * _cambio * 100) / 100 }
function dinheiro(usd) {
  const u = Number(usd) || 0
  return 'R$ ' + brl(u).toFixed(2).replace('.', ',') + ' (US$ ' + u.toFixed(4) + ')'
}

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

/* As skills do escritório, lidas do repositório. São o MESMO texto em toda
   chamada — é isso que faz o cache valer: o prefixo tem de ser byte a byte
   idêntico, por isso nada de data, nome ou número aqui dentro. */
let _skillsCache = null
function skillsCMP() {
  if (_skillsCache) return _skillsCache
  const dir = path.join(process.cwd(), 'lib', 'skills-cmp')
  const ordem = ['analise-autos-cmp.md', 'civel-consumidor-cmp.md', 'rebater-cmp.md', 'peticoes-cmp.md']
  const partes = []
  for (const nome of ordem) {
    try { partes.push('===== ' + nome.replace('.md', '') + ' =====\n' + fs.readFileSync(path.join(dir, nome), 'utf8')) } catch (e) {}
  }
  _skillsCache = partes.join('\n\n')
  return _skillsCache
}

function sistemaFixo() {
  return 'Você é o advogado sênior do escritório Crispim Mendonça e Pinheiro. ' +
    'Faz o DIAGNÓSTICO de um processo em andamento: lê os autos e diz, com objetividade de quem vai protocolar amanhã, ' +
    'o que precisa ou pode ser feito para o processo andar.\n\n' +
    'REGRAS QUE NÃO SE NEGOCIAM:\n' +
    '- Só afirme o que está nos autos que você recebeu. Quando faltar documento ou informação, diga que falta — nunca invente número, data, valor, nome ou jurisprudência.\n' +
    '- Nada de texto com lacuna para preencher. Se não tem o dado, a providência é obtê-lo, e isso vira um item de "o que falta".\n' +
    '- Prazo: só afirme prazo em curso se houver, nos autos, a intimação e a data. Caso contrário, aponte a verificação como providência.\n' +
    '- Escreva em português jurídico direto, sem adjetivo inútil e sem repetir o que o juiz já disse.\n\n' +
    'Abaixo estão os manuais do escritório. Siga-os como método de análise, de enquadramento e de redação.\n\n' +
    skillsCMP()
}

const FERRAMENTA = {
  name: 'diagnostico',
  description: 'Devolve o diagnóstico do processo em campos separados.',
  input_schema: {
    type: 'object',
    properties: {
      situacao: { type: 'string', description: 'Onde o processo está hoje, em 2 a 4 frases: última decisão relevante, fase e o que se espera agora.' },
      travado_por: { type: 'string', description: 'O que impede o processo de andar. Se não estiver travado, diga qual é o próximo movimento natural.' },
      providencias: {
        type: 'array',
        description: 'O que fazer, da mais urgente para a menos. No máximo 5.',
        items: {
          type: 'object',
          properties: {
            titulo: { type: 'string', description: 'A providência em uma linha. Ex.: "Impugnar a contestação na parte da prescrição".' },
            tipo: { type: 'string', enum: ['recurso', 'impugnacao', 'peticao', 'diligencia', 'prova', 'acordo', 'outro'] },
            urgencia: { type: 'string', enum: ['imediata', 'alta', 'media', 'baixa'] },
            porque: { type: 'string', description: 'O que nos autos justifica esta providência, com referência ao documento ou ao ato.' },
            fundamento: { type: 'string', description: 'Base legal e, se houver nos autos, o precedente. Só o que você tem certeza.' },
            o_que_pedir: { type: 'string', description: 'O pedido concreto que a peça deve formular.' },
            prazo: { type: 'string', description: 'O prazo aplicável e de quando corre — ou a verificação necessária, se a data não estiver nos autos.' },
          },
          required: ['titulo', 'tipo', 'urgencia', 'porque', 'o_que_pedir'],
        },
      },
      riscos: { type: 'array', items: { type: 'string' }, description: 'O que pode dar errado, inclusive o que a parte contrária tende a alegar.' },
      falta_nos_autos: { type: 'array', items: { type: 'string' }, description: 'Documento, prova ou informação que falta para sustentar a providência.' },
      peca_recomendada: { type: 'string', description: 'Qual peça redigir agora. Vazio se o caso não pede peça.' },
      instrucao_para_redigir: { type: 'string', description: 'A instrução completa para redigir essa peça: tese, fatos a narrar, fundamentos, pedidos e o que anexar. É o texto que vai para quem escreve.' },
    },
    required: ['situacao', 'travado_por', 'providencias'],
  },
}

/* Antes de diagnosticar, ATUALIZA o processo no tribunal — é o mesmo caminho do
   botão "↻ atualizar" da ficha, chamado aqui direto (sem HTTP). Foi pedido assim
   (02/09/2026): "melhor o sistema atualizar assim que clicarmos em diagnóstico".
   Diagnosticar com o histórico velho é diagnosticar o processo de semana passada.
   Falhar aqui não impede o diagnóstico: segue com o que já está gravado, e a tela
   diz que não deu para atualizar. */
async function atualizaDoTribunal(sb, dig) {
  try {
    const tk = await getFreshToken(sb)
    if (tk.erro) return { erro: tk.erro === 'expirado' ? 'sessão do jus.br expirada' : 'sem sessão do jus.br' }
    const busca = await buscarProcesso(tk.token, dig)
    if (busca.erro) return { erro: busca.erro }
    const { movs } = movimentosDoProcesso(busca.procs)
    let ficha = false
    try { const a = await aplicarMeta(sb, dig, busca.procs); ficha = !!(a && a.atualizada) } catch (e) {}
    const g = await gravarMovimentos(sb, dig, movs, 'jusbr')
    try { await sb.from('processos').update({ jusbr_mov_em: new Date().toISOString() }).eq('numero_digitos', dig) } catch (e) {}
    return { ok: true, movimentos: movs.length, novos: (g && g.inseridos) || 0, ficha_atualizada: ficha }
  } catch (e) { return { erro: String((e && e.message) || e) } }
}

/* A íntegra na pasta. Reaproveita a que já existe, mas só enquanto ela for mais
   nova que o último andamento do processo — íntegra velha esconde justamente a
   decisão que motivou o diagnóstico. Quando está atrasada, remonta (o
   salvarNaPasta substitui a anterior). */
async function garantirIntegra(sb, dig, quem, ultimoAndamento) {
  const pasta = path.join(ROOT, dig)
  let atual = null
  try {
    for (const nome of fs.readdirSync(pasta)) {
      if (nome.startsWith(INTEGRA_PREFIXO)) {
        const st = fs.statSync(path.join(pasta, nome))
        if (!atual || st.mtimeMs > atual.mtimeMs) atual = { arquivo: nome, bytes: st.size, mtimeMs: st.mtimeMs }
      }
    }
  } catch (e) {}
  if (atual) {
    const limite = ultimoAndamento ? Date.parse(String(ultimoAndamento).slice(0, 10) + 'T23:59:59Z') : 0
    if (!(limite && atual.mtimeMs < limite)) {
      return { arquivo: atual.arquivo, bytes: atual.bytes, ja_existia: true }
    }
  }
  // desatualizada (ou inexistente): remonta agora
  try {
    const col = await coletarPecas(sb, dig, {})
    if (col.erro) return { erro: col.erro, sem_sessao: col.motivo === 'expirado' || col.motivo === 'sem_token', arquivo: atual && atual.arquivo, ja_existia: !!atual }
    if (!col.files || !col.files.length) return { erro: 'o jus.br não devolveu nenhuma peça deste processo', arquivo: atual && atual.arquivo, ja_existia: !!atual }
    ordenarPecas(col.files, { ordem: 'asc' })
    const r = await pdfUnico(col.files)
    if (r.erro) return { erro: r.erro, arquivo: atual && atual.arquivo, ja_existia: !!atual }
    const nome = salvarNaPasta(fs, path, ROOT, dig, r.bytes, true)
    if (!nome) return { erro: 'não consegui gravar a íntegra na pasta do processo' }
    try {
      const { data: pr } = await sb.from('processos').select('id').eq('escritorio_id', ESCRITORIO_CMP).eq('numero_digitos', dig).maybeSingle()
      if (pr && pr.id) {
        await sb.from('andamentos').insert({
          processo_id: pr.id, data: new Date().toISOString().slice(0, 10), fonte: 'minuta',
          texto: '[DIAGNÓSTICO] Íntegra dos autos atualizada em "' + nome + '"' + (quem ? (' a pedido de ' + quem) : '') + ', ' +
            r.juntados + ' de ' + r.total + ' peça(s). Substitui a íntegra anterior.',
        })
      }
    } catch (e) {}
    return { arquivo: nome, bytes: r.bytes.length, pecas: r.juntados, atualizada: true }
  } catch (e) { return { erro: String((e && e.message) || e), arquivo: atual && atual.arquivo, ja_existia: !!atual } }
}

/* GET ?id= — em que pé está um diagnóstico pedido antes.
   GET ?pendentes=1 — o que terminou e ainda não foi visto (é o que faz o aviso
   aparecer mesmo depois de trocar de processo ou recarregar a página). */
export async function GET(request) {
  const u = await usuario(request)
  if (!u) return Response.json({ erro: 'não autenticado' }, { status: 401 })
  const { searchParams } = new URL(request.url)
  const sb = admin()
  const id = searchParams.get('id')
  if (id) {
    const { data } = await sb.from('ia_diagnosticos').select('*').eq('id', id).maybeSingle()
    if (!data) return Response.json({ erro: 'diagnóstico não encontrado' }, { status: 404 })
    return Response.json({ ok: true, diag: data })
  }
  if (searchParams.get('pendentes') != null) {
    /* Um diagnóstico que o servidor perdeu no meio (reinício, timeout) ficava
       "rodando" para sempre na ficha. Passou de 20 min, está morto: fecha. */
    try {
      await sb.from('ia_diagnosticos')
        .update({ status: 'erro', erro: 'interrompido antes de terminar (servidor reiniciou ou a chamada estourou o tempo)', concluido_em: new Date().toISOString() })
        .eq('escritorio_id', ESCRITORIO_CMP).eq('status', 'rodando')
        .lt('criado_em', new Date(Date.now() - 20 * 60000).toISOString())
    } catch (e) {}
    const { data } = await sb.from('ia_diagnosticos')
      .select('id,processo_numero,status,erro,concluido_em,criado_em,com_peca')
      .eq('escritorio_id', ESCRITORIO_CMP).is('visto_em', null)
      .gte('criado_em', new Date(Date.now() - 24 * 3600000).toISOString())
      .order('criado_em', { ascending: false }).limit(20)
    return Response.json({ ok: true, itens: data || [] })
  }
  return Response.json({ erro: 'informe ?id= ou ?pendentes=1' }, { status: 400 })
}

export async function POST(request) {
  const u = await usuario(request)
  if (!u) return Response.json({ erro: 'não autenticado' }, { status: 401 })

  let b = {}
  try { b = await request.json() } catch (e) { return Response.json({ erro: 'corpo inválido' }, { status: 400 }) }
  const dig = String(b.numero || '').replace(/\D/g, '')
  const querIntegra = b.integra !== false
  const querPeca = b.peca === true
  const quem = String(b.quem || '').slice(0, 80)
  if (dig.length < 8) return Response.json({ erro: 'número de processo inválido' }, { status: 400 })

  const sb = admin()
  const orc = await orcamento(sb)
  _cambio = Number(orc.cambio) || 5.4
  if (orc.estourou) return Response.json({ erro: 'o teto de gasto de IA do mês foi atingido — ajuste em Robôs para continuar', teto: true }, { status: 429 })

  const { data: proc } = await sb.from('processos')
    .select('id,numero,cliente_nome,oponente,classe,assunto,orgao,orgao_atual,foro,valor_causa,distribuido_em,fase,status')
    .eq('escritorio_id', ESCRITORIO_CMP).eq('numero_digitos', dig).maybeSingle()
  if (!proc) return Response.json({ erro: 'processo não encontrado no sistema' }, { status: 404 })

  /* A linha nasce AQUI, antes do trabalho: o pedido leva minutos e o advogado vai
     trocar de processo no meio. Sem isto, o resultado morria com o modal. */
  let regId = null
  try {
    const ins = await sb.from('ia_diagnosticos').insert({
      escritorio_id: ESCRITORIO_CMP, processo_numero: proc.numero, processo_id: proc.id,
      pedido_por: quem || null, status: 'rodando', com_integra: querIntegra, com_peca: querPeca,
    }).select('id').single()
    regId = ins.data && ins.data.id
  } catch (e) {}
  const encerra = async (campos) => {
    if (!regId) return
    try { await sb.from('ia_diagnosticos').update({ ...campos, concluido_em: new Date().toISOString() }).eq('id', regId) } catch (e) {}
  }

  // ——— 1º: puxa o que o tribunal tem AGORA (o "↻ atualizar" da ficha, automático) ———
  const atualizacao = await atualizaDoTribunal(sb, dig)

  // ——— histórico oficial (o que o tribunal registrou) ———
  const { data: ands } = await sb.from('andamentos')
    .select('data,texto,teor,fonte').eq('processo_id', proc.id).not('data', 'is', null)
    .order('data', { ascending: false }).limit(120)
  const oficiais = (ands || []).filter(a => !/^(manual|minuta|sistema|robo|robô|agenda|chat|portal|app|email|e-mail|assinatura|cobranca|cobrança|estagi)/i.test(String(a.fonte || '')))
  const histTxt = oficiais.slice(0, 60).map(a => (String(a.data).slice(0, 10).split('-').reverse().join('/')) + ' — ' + String(a.texto || '').slice(0, 220)).join('\n')
  const teores = oficiais.filter(a => String(a.teor || '').replace(/\s/g, '').length > 200).slice(0, 3)
    .map(a => '--- ' + String(a.data).slice(0, 10).split('-').reverse().join('/') + ' · ' + String(a.texto || '').slice(0, 90) + ' ---\n' + String(a.teor).slice(0, 9000)).join('\n\n')

  // ——— íntegra dos autos (remontada se ficou para trás do último andamento) ———
  let integra = null
  if (querIntegra) integra = await garantirIntegra(sb, dig, quem, (oficiais[0] && oficiais[0].data) || null)

  // ——— o que já protocolamos e o que está aberto ———
  const { data: tarefas } = await sb.from('kanban_tarefas')
    .select('titulo,prazo,coluna').eq('numero', proc.numero).neq('coluna', 'finalizado').limit(12)

  // ——— documentos: a íntegra primeiro; sem ela, os PDFs mais recentes ———
  const conteudo = []
  const nomesPdf = []
  const foraPorTamanho = []
  let b64 = 0
  try {
    const pasta = path.join(ROOT, dig)
    const arqs = fs.readdirSync(pasta).filter(n => /\.pdf$/i.test(n))
      .map(n => { const st = fs.statSync(path.join(pasta, n)); return { nome: n, full: path.join(pasta, n), size: st.size, mtime: st.mtimeMs } })
      .sort((x, y) => (y.nome.startsWith(INTEGRA_PREFIXO) - x.nome.startsWith(INTEGRA_PREFIXO)) || (y.mtime - x.mtime))
    for (const f of arqs) {
      if (nomesPdf.length >= 4) break
      if (b64 + b64de(f.size) > MAX_B64) { foraPorTamanho.push(f.nome); continue }
      conteudo.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fs.readFileSync(f.full).toString('base64') } })
      nomesPdf.push(f.nome); b64 += b64de(f.size)
      if (f.nome.startsWith(INTEGRA_PREFIXO)) break   // a íntegra já é tudo
    }
  } catch (e) {}

  conteudo.push({
    type: 'text',
    text: 'PROCESSO ' + (proc.numero || '') + '\n' +
      'Cliente: ' + (proc.cliente_nome || '—') + ' | Parte contrária: ' + (proc.oponente || '—') + '\n' +
      'Classe: ' + (proc.classe || '—') + ' | Assunto: ' + (proc.assunto || '—') + '\n' +
      'Órgão: ' + (proc.orgao_atual || proc.orgao || '—') + ' | Valor da causa: ' + (proc.valor_causa || '—') + ' | Distribuído em: ' + (proc.distribuido_em || '—') + '\n' +
      'Fase no sistema: ' + (proc.fase || '—') + ' | Situação: ' + (proc.status || '—') + '\n\n' +
      (nomesPdf.length ? ('DOCUMENTOS ANEXADOS: ' + nomesPdf.join('; ') + '.\n\n') : 'NENHUM PDF DOS AUTOS FOI ANEXADO — diga isso no diagnóstico e trate a obtenção dos autos como providência.\n\n') +
      'HISTÓRICO OFICIAL (do tribunal, mais novo primeiro):\n' + (histTxt || '(sem andamentos oficiais registrados)') + '\n\n' +
      (teores ? ('INTEIRO TEOR DAS ÚLTIMAS DECISÕES:\n' + teores + '\n\n') : '') +
      ((tarefas && tarefas.length) ? ('TAREFAS ABERTAS NO ESCRITÓRIO:\n' + tarefas.map(t => '- ' + t.titulo + (t.prazo ? (' (prazo ' + String(t.prazo).split('-').reverse().join('/') + ')') : '')).join('\n') + '\n\n') : '') +
      'Diagnostique este processo e chame a ferramenta "diagnostico".',
  })

  const r = await chamarClaude({
    rotina: 'diagnostico', sb, ref: proc.numero, escritorioId: ESCRITORIO_CMP,
    modelo: 'claude-opus-5', maxTokens: 8000,
    sistemaFixo: sistemaFixo(), conteudo,
    ferramentas: [FERRAMENTA], toolChoice: { type: 'tool', name: 'diagnostico' },
  })
  if (r.erro) { await encerra({ status: 'erro', erro: String(r.erro).slice(0, 400) }); return Response.json({ erro: r.erro, id: regId }, { status: r.status || 502 }) }
  const diag = (r.ferramenta && r.ferramenta.input) || null
  if (!diag) { await encerra({ status: 'erro', erro: 'formato inesperado' }); return Response.json({ erro: 'a IA não devolveu o diagnóstico no formato esperado', id: regId }, { status: 502 }) }

  const hoje = new Date().toISOString().slice(0, 10)

  const saida = {
    ok: true, id: regId, processo: { numero: proc.numero, cliente: proc.cliente_nome, oponente: proc.oponente },
    diagnostico: diag, integra, docs_lidos: nomesPdf, custo_usd: r.custoUsd,
    atualizacao, docs_fora_por_tamanho: foraPorTamanho,
    custo_brl: brl(r.custoUsd), cambio: orc.cambio,
  }

  // ——— a peça, quando pedida ———
  if (querPeca && diag.instrucao_para_redigir) {
    const m = await gerarMinuta(sb, {
      numero: proc.numero, instrucao: diag.instrucao_para_redigir, autor: quem || 'diagnóstico',
      rotina: 'peca_diagnostico', pecaNome: diag.peca_recomendada || 'Petição',
      tarefaTitulo: 'Revisar e protocolar: ' + (diag.peca_recomendada || 'petição'),
    })
    if (m.erro) saida.peca = { erro: m.erro }
    else {
      saida.peca = { arquivo_word: m.arquivo_pasta || m.arquivo, custo_usd: m.custo_usd, tarefa_para: m.tarefa_para }
      // PDF na pasta Protocolo — é de lá que o botão de protocolar tira o arquivo
      try {
        const texto = await lerMinutaTexto(sb, m)
        if (texto) {
          const pdf = await pecaEmPdf({
            texto, processo: proc,
            rodape: 'Minuta gerada pelo CMPGestão em ' + hoje.split('-').reverse().join('/') + ' — conferir e assinar antes de protocolar',
          })
          const dirProt = path.join(ROOT, dig, 'Protocolo')
          fs.mkdirSync(dirProt, { recursive: true })
          const nomePdf = (hoje + ' - ' + (diag.peca_recomendada || 'Petição')).replace(/[\/\\:*?"<>|]+/g, '-').slice(0, 100) + '.pdf'
          fs.writeFileSync(path.join(dirProt, nomePdf), pdf)
          saida.peca.arquivo_pdf = nomePdf
          saida.peca.bytes_pdf = pdf.length
        }
      } catch (e) { saida.peca.erro_pdf = String((e && e.message) || e) }
    }
  }

  // ——— o custo fechado: diagnóstico + peça, quando houve peça ———
  const custoPeca = (saida.peca && Number(saida.peca.custo_usd)) || 0
  const custoTotal = (Number(r.custoUsd) || 0) + custoPeca
  saida.custo_peca_usd = custoPeca || null
  saida.custo_total_usd = custoTotal
  saida.custo_total_brl = brl(custoTotal)

  // ——— registra no histórico: diagnóstico é trabalho, e trabalho fica gravado ———
  // O custo vai junto. Foi pedido assim: cada processo carrega o que custou.
  try {
    await sb.from('andamentos').insert({
      processo_id: proc.id, data: hoje, fonte: 'minuta',
      texto: '[DIAGNÓSTICO] ' + (diag.situacao || '').slice(0, 400) +
        (diag.providencias && diag.providencias.length ? ('\n\nProvidências: ' + diag.providencias.map(p => p.titulo).join(' · ')) : '') +
        (saida.peca && saida.peca.arquivo_word ? ('\n\nPeça redigida: ' + saida.peca.arquivo_word) : '') +
        '\n\nCusto: ' + dinheiro(custoTotal) +
          (custoPeca ? (' (diagnóstico ' + dinheiro(r.custoUsd) + ' + peça ' + dinheiro(custoPeca) + ')') : '') +
        (quem ? ('\n\nPedido por ' + quem + '.') : ''),
    })
  } catch (e) {}

  await encerra({
    status: 'pronto', resultado: { diagnostico: diag, integra, docs_lidos: nomesPdf, processo: saida.processo,
      atualizacao, docs_fora_por_tamanho: foraPorTamanho,
      custo_usd: r.custoUsd, custo_peca_usd: custoPeca || null, custo_total_usd: custoTotal, custo_total_brl: saida.custo_total_brl },
    peca: saida.peca || null, custo_usd: custoTotal,
  })
  return Response.json(saida)
}

/* o texto da peça para virar PDF: o gerarMinuta grava o .doc na pasta (que é
   HTML), então lemos de lá e desmontamos as tags — sem pedir a peça de novo à IA */
async function lerMinutaTexto(sb, m) {
  try {
    const dig = String((m.processo && m.processo.numero) || '').replace(/\D/g, '')
    if (!dig || !m.arquivo_pasta) return ''
    const html = fs.readFileSync(path.join(ROOT, dig, m.arquivo_pasta), 'utf8')
    return html
      .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/\n{3,}/g, '\n\n').trim()
  } catch (e) { return '' }
}
