// Robô que avisa o CLIENTE pelo chat do app quando sai sentença ou acórdão no
// processo dele — a mesma coisa que o escritório já faz na mão (como o aviso que
// foi escrito para o Givalso, explicando o resultado em linguagem simples), só que
// automático: lê os andamentos novos do DJEN/jus.br, filtra por palavras de decisão,
// pede para a IA confirmar se é mesmo sentença/acórdão de mérito e redigir o aviso,
// e manda direto no chat do cliente (se ele tiver acesso ativo ao app).
//
//   GET /api/robo/avisos-cliente   → processa um lote (idempotente, dedupe por andamento)
//
// Nunca inventa dado: a instrução fixa proíbe a IA de citar valor/data que não esteja
// no teor da publicação. Se a IA não tiver certeza de que é decisão de mérito
// (eh_decisao_final=false), a linha fica registrada e nada é enviado — evita alarme
// falso disparado sozinho para o cliente.

import { createClient } from '@supabase/supabase-js'
import webpush from 'web-push'
import { chamarClaude, orcamento } from '../../_ia/claude.js'
import { ESCRITORIO_CMP } from '../../peticao/core.js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 60

const JANELA_DIAS = 5     // publicações mais antigas que isto o robô não pega
const LOTE = 5             // andamentos analisados por rodada (custo de IA)
const RESERVA_USD = 0.1    // só chama a IA se sobrar isto do teto do mês

// pré-filtro barato (sem IA): só manda para classificação quem tem chance real de
// ser sentença/acórdão — a maioria das publicações do DJEN não é isso
const RE_DECISAO = /senten[çc]a|ac[oó]rd[ãa]o|julgo\s+(totalmente\s+)?(procedente|improcedente)|julgo\s+parcialmente\s+procedente|dou[-\s]lhe?\s+provimento|nego[-\s]lhe?\s+provimento|nega[-\s]se\s+provimento/i

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}

// ————— manual FIXO (vai com cache_control — byte a byte idêntico entre chamadas) —————
const MANUAL_AVISO =
  'Você é o(a) advogado(a) do escritório Crispim, Mendonça e Pinheiro (CMP), que atua em Direito do Consumidor e Direito Civil no Nordeste. ' +
  'Sua tarefa é olhar UMA publicação do Diário de Justiça (DJEN) ou movimento do jus.br e decidir se ela é uma SENTENÇA ou ACÓRDÃO DE MÉRITO — ' +
  'ou seja, uma decisão que julga o pedido do processo (procedente, improcedente ou parcialmente procedente) — e, se for, redigir o aviso que vai ' +
  'direto para o CLIENTE, pelo chat do aplicativo do escritório.\n\n' +

  'eh_decisao_final = true SOMENTE quando o teor é mesmo uma sentença ou um acórdão julgando o mérito. NÃO marque true para: despacho, decisão ' +
  'interlocutória, decisão sobre tutela de urgência, citação/intimação para se manifestar, mera menção à palavra "sentença" ou "acórdão" sem ser ' +
  'o teor da decisão em si, homologação de acordo, extinção sem resolução do mérito, certidão de trânsito em julgado isolada. Na dúvida, marque false ' +
  '— é preferível o escritório avisar na mão do que o robô mandar aviso errado para o cliente.\n\n' +

  'resultado: do ponto de vista do CLIENTE do escritório (nunca da parte contrária) — "favoravel" (pedido julgado procedente, no todo ou na parte ' +
  'relevante), "parcial" (procedente em parte, com alguma rejeição relevante) ou "desfavoravel" (improcedente, ou provimento ao recurso da parte ' +
  'contrária).\n\n' +

  'mensagem: o texto pronto para enviar ao cliente pelo chat, em português do Brasil, tom acolhedor e direto — como um advogado escrevendo pessoalmente ' +
  'para o cliente, NUNCA como um aviso automático ou robótico. Comece pela saudação indicada (se houver nome, use-o; senão comece com "Bom dia!" ou ' +
  '"Boa tarde!" conforme fizer sentido, sem se comprometer com hora do dia se não souber). Explique o resultado em linguagem simples, sem juridiquês, ' +
  'citando SOMENTE valores/datas/fatos que estejam explicitamente no teor da publicação — nunca invente ou estime número que não esteja lá; se o teor ' +
  'não trouxer valores, explique o resultado sem citar valor nenhum. Diga o que acontece a seguir (ex.: início do prazo recursal da parte contrária, ' +
  'ou que o escritório vai avaliar o recurso cabível se o resultado não foi favorável) SOMENTE se isso puder ser afirmado com segurança a partir do ' +
  'teor. Termine oferecendo-se para esclarecer dúvidas pelo próprio chat. Tamanho: 3 a 6 parágrafos curtos, sem saudação de fechamento tipo ' +
  '"Atenciosamente" (é uma conversa de chat, não um ofício). Responda SEMPRE chamando a ferramenta registrar_aviso.'

const FERRAMENTA_AVISO = [{
  name: 'registrar_aviso',
  description: 'Registra se a publicação é sentença/acórdão de mérito e, se for, o aviso pronto para o cliente.',
  strict: true,
  input_schema: {
    type: 'object',
    properties: {
      eh_decisao_final: { type: 'boolean', description: 'É sentença ou acórdão julgando o mérito do pedido?' },
      resultado: { type: 'string', enum: ['favoravel', 'parcial', 'desfavoravel'], description: 'Resultado do ponto de vista do cliente. Vazio/qualquer valor se eh_decisao_final=false.' },
      mensagem: { type: 'string', description: 'Mensagem pronta para o chat do cliente. Vazio se eh_decisao_final=false.' },
    },
    required: ['eh_decisao_final', 'resultado', 'mensagem'],
    additionalProperties: false,
  },
}]

function primeiroNome(s) {
  const n = String(s || '').trim().split(/\s+/)[0] || ''
  return n ? (n.charAt(0).toUpperCase() + n.slice(1).toLowerCase()) : ''
}

// mesmo silêncio noturno do resto do app: nada toca o celular do cliente antes das
// 06:00 nem depois das 18:30 — fora disso, a entrega do push fica para o
// /api/cron/avisos-app (a mensagem já fica gravada no chat, só o toque é adiado)
function foraDoHorario() {
  const local = new Date(Date.now() - 3 * 3600000)
  const m = local.getUTCHours() * 60 + local.getUTCMinutes()
  return m < 6 * 60 || m > 18 * 60 + 30
}

async function processaUm(sb, a, proc) {
  const variavel =
    'PROCESSO nº ' + (proc.numero || '') + ' | Cliente do escritório: ' + (proc.cliente_nome || '?') +
    ' | Parte contrária: ' + (proc.oponente || '?') + ' | Classe/Assunto: ' + ((proc.classe || '') + ' ' + (proc.assunto || '')).trim() +
    ' | Órgão: ' + (proc.orgao || '?') + ' | Data da publicação: ' + (a.data || '?') + '\n\n' +
    'TEOR DA PUBLICAÇÃO:\n' + String(a.texto || '').slice(0, 12000)

  const r = await chamarClaude({
    rotina: 'aviso_cliente', sb, ref: proc.numero, escritorioId: ESCRITORIO_CMP,
    modelo: 'claude-sonnet-5', maxTokens: 1500,
    sistemaFixo: MANUAL_AVISO,
    conteudo: [{ type: 'text', text: variavel }],
    ferramentas: FERRAMENTA_AVISO,
    toolChoice: { type: 'tool', name: 'registrar_aviso' },
  })
  if (r.erro) return { linha: { escritorio_id: ESCRITORIO_CMP, processo_id: proc.id, processo_numero: proc.numero, andamento_id: a.id, motivo: 'erro: ' + r.erro } }
  const t = (r.ferramenta && r.ferramenta.input) || null
  if (!t) return { linha: { escritorio_id: ESCRITORIO_CMP, processo_id: proc.id, processo_numero: proc.numero, andamento_id: a.id, motivo: 'erro: a IA não devolveu a classificação' } }

  const linhaBase = {
    escritorio_id: ESCRITORIO_CMP, processo_id: proc.id, processo_numero: proc.numero, andamento_id: a.id,
    eh_decisao: !!t.eh_decisao_final, resultado: t.eh_decisao_final ? (t.resultado || null) : null,
    custo_usd: r.custoUsd,
  }
  if (!t.eh_decisao_final) return { linha: { ...linhaBase, motivo: 'nao_e_decisao' } }

  // só manda quem tem acesso ativo ao app — sem acesso, o escritório continua
  // avisando pelo canal de sempre (WhatsApp/e-mail), este robô não cria login
  const { data: acessos } = await sb.rpc('portal_acessos_do_processo', { p_processo: proc.id })
  const vivos = (acessos || []).filter(x => x.ativo && !x.bloqueado_em)
  if (!vivos.length) return { linha: { ...linhaBase, motivo: 'sem_acesso', mensagem: t.mensagem } }

  const ins = await sb.from('portal_chat').insert({
    escritorio_id: ESCRITORIO_CMP, processo_id: proc.id, autor_tipo: 'escritorio',
    autor_id: null, autor_nome: 'CMP Advogados', texto: t.mensagem,
    lida_escritorio: true, lida_cliente: false,
  }).select('id').single()
  if (ins.error) return { linha: { ...linhaBase, motivo: 'erro: ' + ins.error.message, mensagem: t.mensagem } }

  // trilha no histórico do processo, para quem olhar a linha do tempo saber que
  // o aviso saiu sozinho (mesmo padrão do "[App] Aviso de audiência..." do robô de audiências)
  try {
    await sb.rpc('robot_add_andamento_fonte', {
      p_num: String(proc.numero || '').replace(/\D/g, ''),
      p_data: new Date().toISOString().slice(0, 10),
      p_texto: '[App] Aviso automático de ' + (t.resultado === 'favoravel' ? 'decisão favorável' : (t.resultado === 'parcial' ? 'decisão parcial' : 'decisão')) + ' enviado ao cliente pelo chat.',
      p_fonte: 'app',
    })
  } catch (e) {}

  // push: imediato dentro da janela 06:00–18:30, senão fica na fila do
  // /api/cron/avisos-app (a mensagem já está gravada e visível no app de qualquer forma)
  try {
    if (foraDoHorario()) {
      await sb.from('avisos_app_fila').insert({
        escritorio_id: ESCRITORIO_CMP, processo_id: proc.id, processo_numero: proc.numero,
        etapa: 'chat:decisao:' + a.id,
        enviar_em: (() => { const d = new Date(Date.now() - 3 * 3600000); if (d.getUTCHours() * 60 + d.getUTCMinutes() > 18 * 60 + 30) d.setUTCDate(d.getUTCDate() + 1); d.setUTCHours(6, 0, 0, 0); return new Date(d.getTime() + 3 * 3600000).toISOString() })(),
        titulo: 'mensagem no seu processo',
        corpo: String(t.mensagem || '').slice(0, 140),
        url: '/portal.html?proc=' + proc.id,
      })
    } else {
      const { data: v } = await sb.from('app_secrets').select('valor').eq('chave', 'vapid_chat').maybeSingle()
      if (v && v.valor) {
        webpush.setVapidDetails('mailto:contato@cmpadvogados.com.br', v.valor.public, v.valor.private)
        const { data: subs } = await sb.from('portal_push_subs').select('*').in('acesso_id', vivos.map(x => x.id))
        const payload = JSON.stringify({ titulo: 'CMP Advogados — mensagem no seu processo', corpo: String(t.mensagem || '').slice(0, 140), url: '/portal.html?proc=' + proc.id })
        const mortos = []
        await Promise.all((subs || []).map(async (s) => {
          try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } }, payload) }
          catch (e) { if (e && (e.statusCode === 404 || e.statusCode === 410)) mortos.push(s.endpoint) }
        }))
        if (mortos.length) { try { await sb.from('portal_push_subs').delete().in('endpoint', mortos) } catch (e) {} }
      }
    }
  } catch (e) { /* o push é acessório: a mensagem já está gravada no chat */ }

  return { linha: { ...linhaBase, motivo: 'enviado', enviado: true, mensagem: t.mensagem } }
}

export async function GET() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ erro: 'falta service key' }, { status: 500 })
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ erro: 'falta ANTHROPIC_API_KEY' }, { status: 501 })
  const sb = admin()

  const orc = await orcamento(sb)
  if (!orc.ativo) return Response.json({ ok: true, pulou: 'robô desligado no painel (mesmo teto do Estagiário Virtual)' })
  if (orc.restanteUsd < RESERVA_USD) return Response.json({ ok: true, pulou: 'teto do mês atingido', orcamento: orc })

  const desde = new Date(Date.now() - JANELA_DIAS * 86400000).toISOString()
  const { data: ands, error } = await sb.from('andamentos')
    .select('id,processo_id,data,texto')
    .in('fonte', ['djen', 'jusbr', 'datajud']).gte('criado_em', desde)
    .order('id', { ascending: false }).limit(300)
  if (error) return Response.json({ erro: 'não consegui ler os andamentos: ' + error.message }, { status: 500 })
  const candidatos = (ands || []).filter(a => RE_DECISAO.test(String(a.texto || '')))
  if (!candidatos.length) return Response.json({ ok: true, processados: 0, nada: true })

  const ids = candidatos.map(a => a.id)
  const { data: jaVistos } = await sb.from('robo_avisos_cliente').select('andamento_id').in('andamento_id', ids)
  const vistos = new Set((jaVistos || []).map(r => Number(r.andamento_id)))
  const novos = candidatos.filter(a => !vistos.has(Number(a.id)))
  if (!novos.length) return Response.json({ ok: true, processados: 0, nada: true })

  const pids = [...new Set(novos.map(a => a.processo_id))]
  const { data: procs } = await sb.from('processos')
    .select('id,numero,cliente_nome,oponente,classe,assunto,orgao,status,suspenso')
    .eq('escritorio_id', ESCRITORIO_CMP).in('id', pids)
  const mapaProc = {}
  ;(procs || []).forEach(p => {
    const arquivado = /arquiv|encerr|baixad/i.test(String(p.status || ''))
    if (!arquivado && p.suspenso !== true) mapaProc[p.id] = p
  })

  const fila = novos.filter(a => mapaProc[a.processo_id]).slice(0, LOTE)
  const resultados = []
  for (const a of fila) {
    const { linha } = await processaUm(sb, a, mapaProc[a.processo_id])
    const ins = await sb.from('robo_avisos_cliente').insert(linha)
    resultados.push({ andamento_id: a.id, processo: linha.processo_numero, motivo: linha.motivo })
  }
  return Response.json({ ok: true, processados: resultados.length, restam: novos.length - fila.length, resultados })
}
