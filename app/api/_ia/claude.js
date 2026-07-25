// Ponto ÚNICO de chamada à API da Anthropic no CMPGestão.
//
// Toda rota que fala com o Claude passa por aqui — é o que garante, de uma vez só,
// as duas regras do projeto: (1) prompt caching no último bloco fixo, com o
// conteúdo variável SEMPRE depois do breakpoint; (2) o gasto de cada chamada
// registrado em `ia_uso`, que é o que sustenta o teto mensal do robô.
//
//   const r = await chamarClaude({ rotina:'triagem', sistemaFixo: MANUAL, conteudo:[...] })
//   r.texto / r.usage / r.custoUsd

// Preços por 1 milhão de tokens (USD). Sonnet 5 está no valor promocional
// vigente até 31/08/2026 ($2/$10); depois volta para 3/15 — trocar aqui.
const PRECOS = {
  'claude-haiku-4-5': { entrada: 1, saida: 5 },
  'claude-sonnet-5': { entrada: 2, saida: 10 },
  'claude-opus-5': { entrada: 5, saida: 25 },
}
// cache: escrita custa 1,25x a entrada; leitura custa 0,1x
const FATOR_CACHE_ESCRITA = 1.25
const FATOR_CACHE_LEITURA = 0.1

export function custoUsd(modelo, usage) {
  const p = PRECOS[modelo] || PRECOS['claude-sonnet-5']
  const u = usage || {}
  const inTok = u.input_tokens || 0
  const outTok = u.output_tokens || 0
  const cw = u.cache_creation_input_tokens || 0
  const cr = u.cache_read_input_tokens || 0
  const total =
    (inTok * p.entrada + cw * p.entrada * FATOR_CACHE_ESCRITA + cr * p.entrada * FATOR_CACHE_LEITURA + outTok * p.saida) / 1e6
  return Math.round(total * 1e6) / 1e6
}

// Chamada padrão. `sistemaFixo` é o prefixo byte a byte idêntico entre chamadas
// (persona + manual + formato de saída) — é ele que leva o cache_control.
// `conteudo` é o bloco variável (dados do processo, PDFs, pedido): vem depois.
export async function chamarClaude({
  rotina,
  sistemaFixo,
  conteudo,
  modelo = 'claude-sonnet-5',
  maxTokens = 16000,
  ferramentas = null,
  toolChoice = null,
  sb = null,
  ref = null,
  escritorioId = null,
}) {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return { erro: 'IA não configurada no servidor (falta ANTHROPIC_API_KEY).', status: 501 }

  const corpo = {
    model: modelo,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: Array.isArray(conteudo) ? conteudo : [{ type: 'text', text: String(conteudo || '') }] }],
  }
  // ordem exigida pela API e pelo cache: tools → system → messages.
  // Com ferramentas, o breakpoint vai na ÚLTIMA ferramenta (elas rendem antes do
  // system); sem elas, no último bloco do system.
  if (ferramentas && ferramentas.length) {
    corpo.tools = ferramentas.map((f, i) =>
      i === ferramentas.length - 1 && !sistemaFixo ? { ...f, cache_control: { type: 'ephemeral' } } : f
    )
    if (toolChoice) corpo.tool_choice = toolChoice
  }
  if (sistemaFixo) corpo.system = [{ type: 'text', text: sistemaFixo, cache_control: { type: 'ephemeral' } }]

  let r, data
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(180000),
    })
    data = await r.json()
  } catch (e) {
    return { erro: 'IA indisponível: ' + ((e && e.message) || e), status: 502 }
  }
  if (!r.ok) return { erro: 'IA: ' + ((data && data.error && data.error.message) || r.status), status: 502 }

  const usage = data.usage || {}
  const custo = custoUsd(modelo, usage)
  // confirma no log que o cache pegou (cache_read > 0 a partir da 2ª chamada)
  try {
    console.log('[ia:' + rotina + '] modelo=' + modelo + ' cache_read=' + (usage.cache_read_input_tokens || 0) +
      ' cache_write=' + (usage.cache_creation_input_tokens || 0) + ' in=' + (usage.input_tokens || 0) +
      ' out=' + (usage.output_tokens || 0) + ' US$' + custo.toFixed(4))
  } catch (e) {}
  if (sb) {
    try {
      await sb.from('ia_uso').insert({
        escritorio_id: escritorioId, rotina, modelo,
        tokens_in: usage.input_tokens || 0, tokens_out: usage.output_tokens || 0,
        cache_write: usage.cache_creation_input_tokens || 0, cache_read: usage.cache_read_input_tokens || 0,
        custo_usd: custo, ref: ref ? String(ref).slice(0, 60) : null,
      })
    } catch (e) { /* medir gasto não pode derrubar a rotina */ }
  }

  let texto = ''
  try { texto = (data.content || []).map(c => c.text || '').join('\n').trim() } catch (e) {}
  const ferramentaUsada = (data.content || []).find(c => c && c.type === 'tool_use') || null

  return { texto, ferramenta: ferramentaUsada, usage, custoUsd: custo, modelo, bruto: data }
}

// ————— teto mensal —————
// Devolve o orçamento em USD e quanto já foi gasto no mês (fuso de Brasília).
export async function orcamento(sb) {
  let teto = 100, cambio = 5.4, ativo = true
  try {
    const { data } = await sb.from('ia_config').select('teto_mensal_brl,cambio_usd_brl,robo_minutas_ativo').eq('id', 1).maybeSingle()
    if (data) {
      teto = Number(data.teto_mensal_brl) || 100
      cambio = Number(data.cambio_usd_brl) || 5.4
      ativo = data.robo_minutas_ativo !== false
    }
  } catch (e) {}
  let gastoUsd = 0
  try { const { data } = await sb.rpc('ia_gasto_mes'); gastoUsd = Number(data) || 0 } catch (e) {}
  const tetoUsd = teto / cambio
  return {
    ativo, cambio,
    tetoBrl: teto, tetoUsd,
    gastoUsd, gastoBrl: gastoUsd * cambio,
    restanteUsd: Math.max(0, tetoUsd - gastoUsd),
    estourou: gastoUsd >= tetoUsd,
  }
}
