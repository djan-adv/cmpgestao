// Suporte que responde dentro do sistema.
//
// Quem compra um sistema jurídico desiste dele na primeira dúvida sem resposta —
// e ninguém abre chamado no meio de um prazo. Este é o atendimento de primeira
// linha: responde "onde clico para…" na hora, com o manual do produto na frente,
// e manda para gente de verdade quando não sabe.
//
//   POST /api/suporte  { pergunta, tela?, historico?: [{quem,texto}] }
//
// Três decisões que valem estar escritas:
//
//   - o manual é o PREFIXO CACHEADO (lib/manual-sistema.js). Ele não muda entre
//     as chamadas, então a segunda pergunta em diante custa uma fração da
//     primeira. Nada de variável entra nele: o escritório, a tela e a pergunta
//     vão depois do breakpoint, que é o que o cache exige.
//   - a conta de IA é de quem OPERA o sistema, não do escritório que pergunta.
//     Por isso há teto diário por escritório e o teto mensal da instalação vale
//     aqui como em qualquer robô: suporte não pode consumir o orçamento da
//     redação de peça.
//   - modelo barato de propósito. Isto é atendimento sobre botão e menu, não
//     redação de peça; Haiku responde bem com o manual na frente.

import { createClient } from '@supabase/supabase-js'
import { usuarioDoRequest, escritorioDoUsuario, semEscritorio } from '../_lib/inquilino.js'
import { chamarClaude, orcamento } from '../_ia/claude.js'
import { MANUAL_SISTEMA } from '../../../lib/manual-sistema.js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 60

const LIMITE_DIA = 60          // perguntas por escritório por dia
const RESERVA_USD = 0.05       // não começa se o teto do mês já estiver no fim

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}

export async function POST(request) {
  const user = await usuarioDoRequest(request)
  if (!user) return Response.json({ erro: 'não autenticado' }, { status: 401 })
  const esc = await escritorioDoUsuario(user.id)
  if (!esc) return semEscritorio()
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ erro: 'O suporte automático não está configurado neste servidor. Escreva para contato@djan.app.br.' }, { status: 501 })
  }

  let b = {}
  try { b = await request.json() } catch (e) {}
  const pergunta = String(b.pergunta || '').trim().slice(0, 1000)
  if (pergunta.length < 3) return Response.json({ erro: 'Escreva a sua dúvida.' }, { status: 400 })
  const tela = String(b.tela || '').trim().slice(0, 60)

  const sb = admin()

  // teto do mês da instalação (o mesmo dos robôs)
  const orc = await orcamento(sb)
  if (!orc.ativo) return Response.json({ erro: 'O suporte automático está desligado no momento. Escreva para contato@djan.app.br.' }, { status: 503 })
  if (orc.restanteUsd < RESERVA_USD) return Response.json({ erro: 'O suporte automático atingiu o limite deste mês. Escreva para contato@djan.app.br — respondo por lá.' }, { status: 429 })

  // teto do dia deste escritório: segura tanto abuso quanto laço de tela repetindo pergunta
  try {
    const desde = new Date(Date.now() - 24 * 3600000).toISOString()
    const { count } = await sb.from('activity_events')
      .select('id', { count: 'exact', head: true })
      .eq('escritorio_id', esc).eq('event_type', 'suporte_pergunta').gte('occurred_at', desde)
    if ((count || 0) >= LIMITE_DIA) {
      return Response.json({ erro: 'Você já fez muitas perguntas ao suporte automático hoje. Escreva para contato@djan.app.br que eu respondo pessoalmente.' }, { status: 429 })
    }
  } catch (e) {}

  // ——— o que é variável vai DEPOIS do manual (o manual é o bloco cacheado) ———
  const historico = (Array.isArray(b.historico) ? b.historico : []).slice(-6)
    .map(h => (h && h.quem === 'assistente' ? 'ASSISTENTE: ' : 'PESSOA: ') + String((h && h.texto) || '').slice(0, 600))
    .join('\n')

  const variavel =
    (tela ? ('A pessoa está na tela: ' + tela + '\n') : '') +
    (historico ? ('CONVERSA ATÉ AGORA:\n' + historico + '\n\n') : '') +
    'PERGUNTA: ' + pergunta

  const r = await chamarClaude({
    rotina: 'suporte', sb, ref: tela || null, escritorioId: esc,
    modelo: 'claude-haiku-4-5', maxTokens: 700,
    sistemaFixo: MANUAL_SISTEMA,
    conteudo: [{ type: 'text', text: variavel }],
  })
  if (r.erro) return Response.json({ erro: r.erro }, { status: r.status || 502 })
  const texto = String(r.texto || '').trim()
  if (!texto) return Response.json({ erro: 'Não consegui responder agora. Tente de novo, ou escreva para contato@djan.app.br.' }, { status: 502 })

  /* Fica registrado o que foi perguntado — sem isso não há como saber qual parte
     do sistema não se explica sozinha, que é a informação mais útil que este
     robô produz. A resposta não é guardada: o que interessa é a dúvida. */
  try {
    await sb.from('activity_events').insert({
      escritorio_id: esc, user_id: user.id, event_type: 'suporte_pergunta',
      entity_type: 'suporte', entity_id: tela || null,
      metadata: { pergunta: pergunta.slice(0, 300), custo_usd: r.custoUsd || 0 },
    })
  } catch (e) {}

  return Response.json({ ok: true, resposta: texto })
}
