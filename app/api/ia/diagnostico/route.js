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

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 300

const MAX_PDF_BYTES = 28 * 1024 * 1024
const INTEGRA_PREFIXO = '000 - ÍNTEGRA DOS AUTOS'

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

async function garantirIntegra(sb, dig, quem, base) {
  const pasta = path.join(ROOT, dig)
  try {
    for (const nome of fs.readdirSync(pasta)) {
      if (nome.startsWith(INTEGRA_PREFIXO)) {
        const st = fs.statSync(path.join(pasta, nome))
        return { arquivo: nome, bytes: st.size, ja_existia: true }
      }
    }
  } catch (e) {}
  // não tem: pede à rota que já sabe montar (mesma do Estagiário Virtual)
  try {
    const r = await fetch(base + '/api/jusbr/integra/guardar?numero=' + dig + '&quem=' + encodeURIComponent(quem || ''), { cache: 'no-store' })
    const j = await r.json().catch(() => null)
    if (j && j.ok) return { arquivo: j.arquivo, bytes: j.bytes, ja_existia: !!j.ja_existia }
    return { erro: (j && j.erro) || ('não consegui baixar a íntegra (HTTP ' + r.status + ')'), sem_sessao: !!(j && j.sem_sessao) }
  } catch (e) { return { erro: String((e && e.message) || e) } }
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
  if (orc.estourou) return Response.json({ erro: 'o teto de gasto de IA do mês foi atingido — ajuste em Robôs para continuar', teto: true }, { status: 429 })

  const { data: proc } = await sb.from('processos')
    .select('id,numero,cliente_nome,oponente,classe,assunto,orgao,orgao_atual,foro,valor_causa,distribuido_em,fase,status')
    .eq('escritorio_id', ESCRITORIO_CMP).eq('numero_digitos', dig).maybeSingle()
  if (!proc) return Response.json({ erro: 'processo não encontrado no sistema' }, { status: 404 })

  // ——— íntegra dos autos ———
  const base = (process.env.PUBLIC_URL || 'https://gestao.cmpadvogados.com.br').replace(/\/+$/, '')
  let integra = null
  if (querIntegra) integra = await garantirIntegra(sb, dig, quem, base)

  // ——— histórico oficial (o que o tribunal registrou) ———
  const { data: ands } = await sb.from('andamentos')
    .select('data,texto,teor,fonte').eq('processo_id', proc.id).not('data', 'is', null)
    .order('data', { ascending: false }).limit(120)
  const oficiais = (ands || []).filter(a => !/^(manual|minuta|sistema|robo|robô|agenda|chat|portal|app|email|e-mail|assinatura|cobranca|cobrança|estagi)/i.test(String(a.fonte || '')))
  const histTxt = oficiais.slice(0, 60).map(a => (String(a.data).slice(0, 10).split('-').reverse().join('/')) + ' — ' + String(a.texto || '').slice(0, 220)).join('\n')
  const teores = oficiais.filter(a => String(a.teor || '').replace(/\s/g, '').length > 200).slice(0, 3)
    .map(a => '--- ' + String(a.data).slice(0, 10).split('-').reverse().join('/') + ' · ' + String(a.texto || '').slice(0, 90) + ' ---\n' + String(a.teor).slice(0, 9000)).join('\n\n')

  // ——— o que já protocolamos e o que está aberto ———
  const { data: tarefas } = await sb.from('kanban_tarefas')
    .select('titulo,prazo,coluna').eq('numero', proc.numero).neq('coluna', 'finalizado').limit(12)

  // ——— documentos: a íntegra primeiro; sem ela, os PDFs mais recentes ———
  const conteudo = []
  const nomesPdf = []
  let bytes = 0
  try {
    const pasta = path.join(ROOT, dig)
    const arqs = fs.readdirSync(pasta).filter(n => /\.pdf$/i.test(n))
      .map(n => { const st = fs.statSync(path.join(pasta, n)); return { nome: n, full: path.join(pasta, n), size: st.size, mtime: st.mtimeMs } })
      .sort((x, y) => (y.nome.startsWith(INTEGRA_PREFIXO) - x.nome.startsWith(INTEGRA_PREFIXO)) || (y.mtime - x.mtime))
    for (const f of arqs) {
      if (nomesPdf.length >= 4 || bytes + f.size > MAX_PDF_BYTES) continue
      conteudo.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: fs.readFileSync(f.full).toString('base64') } })
      nomesPdf.push(f.nome); bytes += f.size
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
  if (r.erro) return Response.json({ erro: r.erro }, { status: r.status || 502 })
  const diag = (r.ferramenta && r.ferramenta.input) || null
  if (!diag) return Response.json({ erro: 'a IA não devolveu o diagnóstico no formato esperado' }, { status: 502 })

  // ——— registra no histórico: diagnóstico é trabalho, e trabalho fica gravado ———
  const hoje = new Date().toISOString().slice(0, 10)
  try {
    await sb.from('andamentos').insert({
      processo_id: proc.id, data: hoje, fonte: 'minuta',
      texto: '[DIAGNÓSTICO] ' + (diag.situacao || '').slice(0, 400) +
        (diag.providencias && diag.providencias.length ? ('\n\nProvidências: ' + diag.providencias.map(p => p.titulo).join(' · ')) : '') +
        (quem ? ('\n\nPedido por ' + quem + '.') : ''),
    })
  } catch (e) {}

  const saida = {
    ok: true, processo: { numero: proc.numero, cliente: proc.cliente_nome, oponente: proc.oponente },
    diagnostico: diag, integra, docs_lidos: nomesPdf, custo_usd: r.custoUsd,
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
