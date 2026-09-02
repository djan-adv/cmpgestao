// Núcleo da minuta — o Claude redige a peça no padrão CMP e o resultado vira
// Word anexado ao histórico + tarefa D+1. Usado por dois caminhos:
//   • /api/peticao          → o advogado pede na hora, pelo sistema
//   • /api/robo/minutas     → o robô pede sozinho, ao ler a intimação
// É SEMPRE rascunho para revisão — nunca protocola.

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { chamarClaude, orcamento } from '../_ia/claude.js'
import { lerPlanilhaTexto } from '../../../lib/planilha.js'

export const ROOT = '/opt/cmpdocs'
export const ESCRITORIO_CMP = '908f77fc-19f5-4d86-9576-f5590af09e0a'
/* Orçamento de PDFs enviados à IA. A conta que importa NÃO é a do arquivo no
   disco: o PDF viaja em base64, que cresce 4/3, e a API recusa a requisição
   inteira acima de 32 MB ("Request exceeds the maximum size" — 02/09/2026, um
   diagnóstico com laudo contábil). Por isso o teto é medido já em base64, com
   folga para o texto do pedido e o histórico. */
export const MAX_B64_BYTES = 22 * 1024 * 1024
export function tamB64(bytes) { return Math.ceil(Number(bytes || 0) / 3) * 4 }

function escHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }

// coleta PDFs da pasta do processo (recursivo), pulando Lixeira e a pasta de minutas
export function coletaPdfs(dir, arr) {
  let ents
  try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch (e) { return }
  for (const d of ents) {
    if (d.name === 'Lixeira' || d.name === '.meta.json' || d.name === 'Minutas (para revisão)') continue
    const full = path.join(dir, d.name)
    if (d.isDirectory()) coletaPdfs(full, arr)
    else if (/\.pdf$/i.test(d.name)) { try { const st = fs.statSync(full); arr.push({ full, nome: d.name, size: st.size, mtime: st.mtimeMs }) } catch (e) {} }
  }
}

// mesma varredura, mas só planilhas (.xlsx/.csv) — viram texto (CSV) na minuta,
// não dá pra mandar como "document" binário pra IA como o PDF
export function coletaPlanilhas(dir, arr) {
  let ents
  try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch (e) { return }
  for (const d of ents) {
    if (d.name === 'Lixeira' || d.name === '.meta.json' || d.name === 'Minutas (para revisão)') continue
    const full = path.join(dir, d.name)
    if (d.isDirectory()) coletaPlanilhas(full, arr)
    else if (/\.(xlsx|csv)$/i.test(d.name)) { try { const st = fs.statSync(full); arr.push({ full, nome: d.name, size: st.size, mtime: st.mtimeMs }) } catch (e) {} }
  }
}

// carrega o Manual de Padrão CMP: override editável no servidor tem prioridade
export function carregaModelo() {
  const cands = ['/opt/cmpdocs/_config/modelo-peticao.md', path.join(process.cwd(), 'ops', 'modelo-peticao-cmp.md')]
  for (const p of cands) { try { if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8') } catch (e) {} }
  return ''
}

function semAcento(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') }

// hoje + N dias úteis (só pula sábado/domingo — feriado não entra, mesma regra
// do resto do Estagiário Virtual). Usado pro prazo da tarefa de revisão.
export function prazoUteis(dias) {
  const d = new Date(Date.now() - 3 * 3600000) // hoje em Brasília
  let restam = dias
  while (restam > 0) {
    d.setUTCDate(d.getUTCDate() + 1)
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) restam--
  }
  return d.toISOString().slice(0, 10)
}

/* Cabeçalho da peça, no padrão do escritório (02/09/2026): endereçamento, TRÊS
   linhas em branco, identificação em espaçamento simples, SETE linhas em branco
   antes do corpo. O mesmo que lib/peca-pdf.js aplica no PDF — Word e PDF têm de
   sair iguais. */
const RE_ENDERECAMENTO = /^(a[o]?\s+(ju[íi]z|ex|meritíssim|dr)|excelent[íi]ssim|exm[oa]|mm\.|meritíssim|ilustr[íi]ssim|ao\s+ju[íi]zo|à\s+vara|ao\s+tribunal|colenda|egr[ée]gi)/i
const RE_IDENTIFICACAO = /^(processo|autos|refer[êe]ncia|ref\.|autor|r[ée]u|r[ée]|exequente|executad|requerente|requerid|reclamante|reclamad|embargante|embargad|agravante|agravad|apelante|apelad|impugnante|impugnad|recorrente|recorrid|suscitante|suscitad|impetrante|impetrad|credor|devedor|inventariante|espólio)\b[\s:ºn°]/i

export function minutaDoc(proc, texto) {
  const blocks = String(texto || '').split(/\n{2,}/).map(b => b.trim()).filter(Boolean)
  const papel = (t) => {
    const l0 = t.split('\n')[0].trim()
    if (RE_ENDERECAMENTO.test(l0)) return 'enderecamento'
    if (RE_IDENTIFICACAO.test(l0)) return 'identificacao'
    return 'corpo'
  }
  const papeis = blocks.map(papel)
  let fimCab = 0
  while (fimCab < papeis.length && papeis[fimCab] === 'enderecamento') fimCab++
  while (fimCab < papeis.length && papeis[fimCab] === 'identificacao') fimCab++

  const corpo = blocks.map(function (b, i) {
    const t = b
    const pp = i < fimCab ? papeis[i] : 'corpo'
    if (pp === 'enderecamento') {
      const depois = (papeis[i + 1] !== 'enderecamento') ? 'margin:0 0 54pt' : 'margin:0'   // 3 linhas
      return '<p style="font-weight:bold;text-align:justify;' + depois + '">' + escHtml(t).replace(/\n/g, '<br>') + '</p>'
    }
    if (pp === 'identificacao') {
      const ultimo = (i + 1) >= fimCab
      return '<p style="line-height:1.15;margin:0 0 ' + (ultimo ? '126pt' : '0') + '">' + escHtml(t).replace(/\n/g, '<br>') + '</p>'   // 7 linhas
    }
    const umaLinha = t.indexOf('\n') < 0
    const ehTitulo = umaLinha && t.length < 90 && (/^[IVX]+\s*[–-]/.test(t) || (t === t.toUpperCase() && /[A-ZÀ-Ú]/.test(t)))
    if (ehTitulo) return '<p style="text-align:center;font-weight:bold;margin:14pt 0 8pt">' + escHtml(t) + '</p>'
    return '<p style="text-align:justify;text-indent:1.25cm;margin:0 0 8pt">' + escHtml(t).replace(/\n/g, '<br>') + '</p>'
  }).join('\n')
  return '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">' +
    '<head><meta charset="utf-8"><title>Minuta CMP</title>' +
    '<style>body{font-family:\'Barlow\',\'Calibri\',\'Segoe UI\',sans-serif;font-size:12pt;line-height:1.5;margin:2.5cm}p{orphans:2;widows:2}</style></head><body>' +
    corpo +
    '<p style="color:#888;font-size:9pt;margin-top:24pt">— Minuta gerada por IA no padrão CMP para REVISÃO do advogado (não protocolar sem conferência). Processo ' + escHtml(proc.numero || '') + '.</p>' +
    '</body></html>'
}

// bloco FIXO (persona + Manual de Padrão CMP + formato de saída) — idêntico em toda
// chamada, então vai no `system` com cache_control: a IA reaproveita o cache em vez
// de reprocessar as ~8 mil palavras do Manual a cada minuta.
/* As skills do escritório (as mesmas que ele usa no Claude: peticoes-cmp,
   civel-consumidor-cmp, rebater-cmp). Até 02/09/2026 quem redigia só via o
   "Manual de Padrão CMP" — o método de escrita, o enquadramento das teses e o
   red team ficavam de fora, e a peça saía genérica ("não aproveitou nada das
   minhas skills"). Texto fixo, byte a byte, para o cache pegar. */
let _skillsPeca = null
export function skillsDeRedacao() {
  if (_skillsPeca != null) return _skillsPeca
  const dir = path.join(process.cwd(), 'lib', 'skills-cmp')
  const ordem = ['peticoes-cmp.md', 'civel-consumidor-cmp.md', 'rebater-cmp.md']
  const partes = []
  for (const nome of ordem) {
    try { partes.push('===== ' + nome.replace('.md', '') + ' =====\n' + fs.readFileSync(path.join(dir, nome), 'utf8')) } catch (e) {}
  }
  _skillsPeca = partes.join('\n\n')
  return _skillsPeca
}

export function sistemaBase() {
  const modelo = carregaModelo()
  const skills = skillsDeRedacao()
  return 'Você é o(a) redator(a) de peças do escritório Crispim, Mendonça e Pinheiro (CMP). Redija uma MINUTA (rascunho para revisão do advogado) da peça solicitada, seguindo RIGOROSAMENTE o "Manual de Padrão CMP" abaixo: método IRAC em prosa (sem rótulos visíveis), estrutura de seções, endereçamento no padrão do escritório ("AO JUÍZO DE DIREITO DA/DO ..."), fecho "Nestes termos, / Pede deferimento." e dupla subscrição (Djan Henrique Mendonça do Nascimento — OAB/PB 5.219-A e Jader Gabriel Pinheiro — OAB/PB 33.567).\n\n' +
    'REGRAS CRÍTICAS (do Manual): NUNCA invente dados (CPF, CNPJ, valores, nº de processo, endereços) — use [A PREENCHER]; números calculados/inferidos marque [CONFIRMAR]; NUNCA cite jurisprudência de memória — se não puder verificar, use [JURISPRUDÊNCIA A CONFIRMAR: tese]; baseie-se SOMENTE no histórico e nos documentos anexados; sinalize riscos/prazos, mas a decisão estratégica é do advogado.\n\n' +
    (modelo ? ('===== MANUAL DE PADRÃO CMP (siga fielmente) =====\n' + modelo + '\n===== FIM DO MANUAL =====\n\n') : '') +
    (skills ? ('===== SKILLS DO ESCRITÓRIO (método de escrita, enquadramento das teses e red team — aplique-as) =====\n' + skills + '\n===== FIM DAS SKILLS =====\n\n' +
      'Antes de escrever: enquadre a tese pela skill civel-consumidor-cmp, escreva pelo método da skill peticoes-cmp (IRAC em prosa, sem rótulos) e, antes de fechar, passe a peça pelo crivo da skill rebater-cmp — o que o adversário alegaria contra ela deve estar respondido no próprio texto.\n\n') : '') +
    'FORMATO DE SAÍDA: escreva a PEÇA COMPLETA no padrão CMP, começando DIRETO pela peça (sem comentários antes). Ao final, em uma NOVA seção iniciada EXATAMENTE pela linha "===RELATORIO DE TESES===", escreva o Relatório de Teses (fora da peça), conforme o Manual (tese adotada e por quê, subsidiárias, alternativas descartadas, status da jurisprudência, pendências [A PREENCHER]/[CONFIRMAR]). Não escreva nada após o relatório.'
}

// Gera a minuta e grava tudo (histórico + Word + tarefa). `sb` é o client admin.
// `docsPreferidos`: palavras-chave dos documentos que a triagem apontou como
// necessários — entram na frente da fila de PDFs enviados à IA.
/* O custo da IA sai em dólar; quem lê o histórico do processo pensa em real.
   O câmbio é o mesmo do teto mensal (ia_config.cambio_usd_brl). */
export async function dinheiroIA(sb, usd) {
  const u = Number(usd) || 0
  let cambio = 5.4
  try { const o = await orcamento(sb); cambio = Number(o.cambio) || 5.4 } catch (e) {}
  return 'R$ ' + (Math.round(u * cambio * 100) / 100).toFixed(2).replace('.', ',') + ' (US$ ' + u.toFixed(4) + ')'
}

export async function gerarMinuta(sb, {
  numero, instrucao, autor = 'robo', maxFiles = 6, docsPreferidos = [], rotina = 'minuta',
  tarefaTitulo = null, prazoEm = null, resp = null, origemTarefa = 'minuta', pecaNome = null,
  modelo = 'claude-sonnet-5', contexto = '',
}) {
  const dig = String(numero || '').replace(/\D/g, '')
  // CNJ tem 20 dígitos; casos administrativos (sem CNJ) usam a numeração interna
  // ano.mes.dia.horaminuto (12 dígitos) — o mínimo aqui é só sanidade de entrada,
  // não formato: o achado do processo é sempre por igualdade exata (numero_digitos).
  if (dig.length < 8) return { erro: 'número de processo inválido', status: 400 }
  if (!instrucao || !String(instrucao).trim()) return { erro: 'descreva o que a petição deve fazer', status: 400 }
  instrucao = String(instrucao).trim()

  let proc = null
  {
    const r = await sb.from('processos').select('id,numero,cliente_nome,oponente,classe,assunto,orgao').eq('escritorio_id', ESCRITORIO_CMP).eq('numero_digitos', dig).maybeSingle()
    proc = r.data || null
    if (!proc) { const r2 = await sb.from('processos').select('id,numero,cliente_nome,oponente,classe,assunto,orgao').eq('escritorio_id', ESCRITORIO_CMP).ilike('numero', '%' + dig + '%').maybeSingle(); proc = r2.data || null }
  }
  if (!proc) return { erro: 'processo não encontrado no sistema', status: 404 }

  // histórico recente
  const { data: ands } = await sb.from('andamentos').select('data,texto').eq('processo_id', proc.id).order('data', { ascending: false }).limit(40)
  const histTxt = (ands || []).map(a => (a.data || '') + ': ' + String(a.texto || '').replace(/\s+/g, ' ').slice(0, 700)).join('\n')

  // documentos (PDFs) da pasta do processo (inclui _OUTRA_PARTE). Ordem: primeiro
  // os que a triagem pediu pelo nome, depois os mais recentes.
  const arr = []
  coletaPdfs(path.join(ROOT, dig), arr)
  const chaves = (docsPreferidos || []).map(semAcento).filter(k => k.length >= 4)
  const pontua = (f) => {
    const n = semAcento(f.nome)
    return chaves.reduce((acc, k) => acc + (n.indexOf(k) > -1 ? 1 : 0), 0)
  }
  arr.sort((a, b) => (pontua(b) - pontua(a)) || (b.mtime - a.mtime))

  const content = []
  let b64 = 0, usados = 0
  const nomesUsados = []
  const nomesForaPorTamanho = []
  for (const f of arr) {
    if (usados >= maxFiles) break
    if (b64 + tamB64(f.size) > MAX_B64_BYTES) { nomesForaPorTamanho.push(f.nome); continue }
    try {
      const buf = fs.readFileSync(f.full)
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } })
      b64 += tamB64(f.size); usados++; nomesUsados.push(f.nome)
    } catch (e) {}
  }

  // planilhas (.xlsx/.csv) da pasta do processo — viram texto (CSV), até 4 arquivos
  const arrPlan = []
  coletaPlanilhas(path.join(ROOT, dig), arrPlan)
  arrPlan.sort((a, b) => (pontua(b) - pontua(a)) || (b.mtime - a.mtime))
  const nomesPlanilhas = []
  for (const f of arrPlan) {
    if (nomesPlanilhas.length >= 4) break
    try {
      const buf = fs.readFileSync(f.full)
      const texto = await lerPlanilhaTexto(buf, f.nome)
      if (texto && texto.trim()) { content.push({ type: 'text', text: 'Conteúdo da planilha "' + f.nome + '":\n' + texto.slice(0, 20000) }); nomesPlanilhas.push(f.nome) }
    } catch (e) {}
  }

  // bloco VARIÁVEL (dados do processo/pedido/histórico) — sempre depois do breakpoint
  const pedidoTexto =
    'DADOS DO PROCESSO — nº ' + (proc.numero || '') + ' | Cliente: ' + (proc.cliente_nome || '') + ' | Parte contrária: ' + (proc.oponente || '') + ' | Classe/Assunto: ' + ((proc.classe || '') + ' ' + (proc.assunto || '')).trim() + ' | Órgão: ' + (proc.orgao || '') + '.\n\n' +
    'PEDIDO DO ADVOGADO: ' + instrucao + '\n\n' +
    (contexto ? (contexto + '\n\n') : '') +
    'HISTÓRICO RECENTE (mais novo primeiro):\n' + (histTxt || '(sem histórico)') + '\n\n' +
    (usados ? ('Documentos anexados (PDF do processo): ' + nomesUsados.join('; ') + '.') : 'Nenhum PDF localizado na pasta do processo — redija com base no histórico e marque [A PREENCHER]/[VERIFICAR] onde faltar documento.') +
    (nomesPlanilhas.length ? (' Planilhas anexadas: ' + nomesPlanilhas.join('; ') + '.') : '')
  content.push({ type: 'text', text: pedidoTexto })

  const r = await chamarClaude({
    rotina, sb, ref: proc.numero, escritorioId: ESCRITORIO_CMP,
    modelo, maxTokens: 16000,
    sistemaFixo: sistemaBase(), conteudo: content,
  })
  if (r.erro) return { erro: r.erro, status: r.status || 502 }
  const texto = r.texto
  if (!texto) return { erro: 'a IA não retornou a minuta', status: 502 }

  // separa a peça (vai para o Word) do Relatório de teses (vai para o histórico)
  let pecaText = texto, relatorio = ''
  const mi = texto.search(/^={2,}\s*RELAT[ÓO]RIO\s+DE\s+TESES\s*={0,}\s*$/im)
  if (mi > -1) { pecaText = texto.slice(0, mi).trim(); relatorio = texto.slice(mi).replace(/^[^\n]*\n?/, '').trim() }

  const hoje = new Date().toISOString().slice(0, 10)
  const slug = ('minuta_' + instrucao).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 48)
  const fileName = (slug || 'minuta') + '_' + hoje + '.doc'

  // 1) lançamento no histórico (na data do pedido) — inclui o Relatório de teses
  const corpo = '[MINUTA] ' + instrucao + ' (rascunho Claude para revisão, ' + hoje.split('-').reverse().join('/') + ')' +
    '\n\nCusto: ' + (await dinheiroIA(sb, r.custoUsd)) +
    (relatorio ? ('\n\n— RELATÓRIO DE TESES —\n' + relatorio) : '')
  const { data: a } = await sb.from('andamentos').insert({ processo_id: proc.id, data: hoje, texto: corpo, fonte: 'minuta' }).select('id').single()
  const andId = a && a.id

  // 2) Word (.doc) anexado ao histórico (bucket 'capturas' + anexos) — só a PEÇA
  const buf = Buffer.from(minutaDoc(proc, pecaText), 'utf8')
  const pathCap = ESCRITORIO_CMP + '/' + dig + '/' + crypto.randomUUID() + '_' + fileName
  let anexoId = null
  try {
    const up = await sb.storage.from('capturas').upload(pathCap, buf, { contentType: 'application/msword', upsert: false })
    if (!up.error) {
      const ia = await sb.from('anexos').insert({ escritorio_id: ESCRITORIO_CMP, processo_numero: proc.numero, andamento_id: andId, origem: 'minuta', nome: fileName, tipo: 'application/msword', tamanho: buf.length, path: pathCap, criado_por: String(autor || 'robo') }).select('id').single()
      anexoId = ia.data && ia.data.id
    }
  } catch (e) {}

  // 2b) o MESMO Word direto na pasta do processo ("Documentos do processo" no
  //     disco, /opt/cmpdocs/<dig>/) — o anexo acima só aparece dentro do
  //     histórico; o advogado revisa pela pasta, então o rascunho tem que
  //     estar lá também. Nome fixo "<peça> - a corrigir.doc"; se já existir um
  //     rascunho com esse nome (nova tentativa), nunca sobrescreve — numera.
  let arquivoPasta = null
  try {
    const baseNome = String(pecaNome || instrucao).replace(/\s+/g, ' ').trim().slice(0, 60).replace(/[\/\\]/g, '-')
    const dirDestino = path.join(ROOT, dig)
    fs.mkdirSync(dirDestino, { recursive: true })
    let nomeFinal = baseNome + ' - a corrigir.doc'
    let destino = path.join(dirDestino, nomeFinal)
    let i = 2
    while (fs.existsSync(destino)) { nomeFinal = baseNome + ' - a corrigir (' + i + ').doc'; destino = path.join(dirDestino, nomeFinal); i++ }
    fs.writeFileSync(destino, buf)
    arquivoPasta = nomeFinal
  } catch (e) {}

  // 3) tarefa: protocolar/corrigir a minuta. Sem prazo informado, cai em D+1
  //    (se não protocolar hoje, alerta amanhã).
  const amanha = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
  const quando = prazoEm || amanha
  let tarefaId = null
  try {
    const linhaTarefa = {
      escritorio_id: ESCRITORIO_CMP, titulo: tarefaTitulo || ('Protocolar/corrigir minuta: ' + instrucao.slice(0, 90)),
      cliente: proc.cliente_nome || '—', numero: proc.numero, coluna: 'distribuir',
      data: quando, prazo: quando, tipo: 'prazo', origem: origemTarefa,
    }
    if (resp) linhaTarefa.resp = resp
    const t = await sb.from('kanban_tarefas').insert(linhaTarefa).select('id').single()
    tarefaId = t.data && t.data.id
  } catch (e) {}

  return {
    ok: true, processo: proc, andamento_id: andId, anexo_id: anexoId, tarefa_id: tarefaId,
    arquivo: fileName, arquivo_pasta: arquivoPasta, docs_usados: nomesUsados,
    docs_fora_por_tamanho: nomesForaPorTamanho, tarefa_para: quando,
    custo_usd: r.custoUsd, preview: texto.slice(0, 500),
  }
}
