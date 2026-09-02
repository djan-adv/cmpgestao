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

/* A Anthropic responde em inglês. Quem lê isso na tela é advogado no meio de um
   prazo — as mensagens que aparecem de verdade viram português, com o que fazer. */
function emPortugues(msg) {
  const m = String(msg || '')
  if (/credit balance is too low/i.test(m)) return 'acabaram os créditos da API da Anthropic — recarregue em Robôs › conta da API › "abrir conta / créditos" (nada foi cobrado nesta tentativa)'
  if (/rate.?limit|429/i.test(m)) return 'a Anthropic limitou a velocidade agora (muitas chamadas seguidas) — espere um minuto e rode de novo'
  if (/overloaded/i.test(m)) return 'a Anthropic está sobrecarregada neste momento — rode de novo em alguns minutos'
  if (/invalid.*api.?key|authentication/i.test(m)) return 'a chave da API da Anthropic foi recusada — confira a ANTHROPIC_API_KEY no servidor'
  if (/exceeds the maximum size|request too large/i.test(m)) return 'os documentos enviados passaram do tamanho máximo de uma requisição — tire da pasta os PDFs que não interessam e rode de novo'
  return 'IA: ' + m
}

/* Teto de tempo de uma chamada. Alto de propósito: um diagnóstico lê a íntegra
   inteira dos autos. Em streaming o servidor manda evento o tempo todo, então
   este relógio só dispara se a Anthropic realmente parar de responder. */
const TIMEOUT_MS = 900000

/* Remonta a resposta a partir do SSE, no MESMO formato do modo não-streaming
   (content[], usage, stop_reason) — assim nada mais no sistema muda. */
async function montarDoStream(r) {
  const out = { content: [], usage: {}, stop_reason: null, completo: false }
  const parciais = {}          // índice → json cru do tool_use
  const dec = new TextDecoder()
  let buf = ''
  const reader = r.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let corte
    while ((corte = buf.indexOf('\n\n')) > -1) {
      const bloco = buf.slice(0, corte); buf = buf.slice(corte + 2)
      for (const linha of bloco.split('\n')) {
        if (!linha.startsWith('data:')) continue
        const cru = linha.slice(5).trim()
        if (!cru || cru === '[DONE]') continue
        let ev
        try { ev = JSON.parse(cru) } catch (e) { continue }
        if (ev.type === 'message_start' && ev.message) {
          out.usage = Object.assign({}, ev.message.usage || {})
        } else if (ev.type === 'content_block_start') {
          const b = ev.content_block || {}
          if (b.type === 'tool_use') { out.content[ev.index] = { type: 'tool_use', id: b.id, name: b.name, input: {} }; parciais[ev.index] = '' }
          else out.content[ev.index] = { type: b.type || 'text', text: '' }
        } else if (ev.type === 'content_block_delta') {
          const d = ev.delta || {}
          if (d.type === 'text_delta') { const c = out.content[ev.index] || (out.content[ev.index] = { type: 'text', text: '' }); c.text = (c.text || '') + (d.text || '') }
          else if (d.type === 'input_json_delta') parciais[ev.index] = (parciais[ev.index] || '') + (d.partial_json || '')
        } else if (ev.type === 'content_block_stop') {
          if (parciais[ev.index] != null && out.content[ev.index]) {
            try { out.content[ev.index].input = JSON.parse(parciais[ev.index] || '{}') } catch (e) { out.content[ev.index].input = {} }
          }
        } else if (ev.type === 'message_delta') {
          if (ev.delta && ev.delta.stop_reason) out.stop_reason = ev.delta.stop_reason
          if (ev.usage) out.usage = Object.assign({}, out.usage, ev.usage)
        } else if (ev.type === 'message_stop') {
          out.completo = true
        } else if (ev.type === 'error') {
          out.erroStream = (ev.error && ev.error.message) || 'erro no streaming'
        }
      }
    }
  }
  out.content = out.content.filter(Boolean)
  return out
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

  /* SEMPRE em streaming. Sem isso, um pedido grande (a íntegra dos autos inteira
     + 16k de saída) fica minutos sem devolver byte nenhum e a conexão morre —
     foi o "IA indisponível: The operation was aborted due to timeout" de
     02/09/2026, com a peça já paga e perdida. Em streaming os eventos chegam o
     tempo todo, então o relógio nunca zera. A resposta é remontada aqui e o
     resto do sistema continua recebendo o mesmo objeto de antes. */
  corpo.stream = true

  let r, data
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!r.ok) {
      let err = null
      try { err = await r.json() } catch (e) {}
      const msg = (err && err.error && err.error.message) || String(r.status)
      return { erro: emPortugues(msg), status: 502, semCredito: /credit balance is too low/i.test(msg) }
    }
    data = await montarDoStream(r)
  } catch (e) {
    return { erro: 'IA indisponível: ' + ((e && e.message) || e), status: 502 }
  }
  if (data && data.erroStream) return { erro: 'IA: ' + data.erroStream, status: 502 }
  /* Stream que morre no meio devolve texto pela metade — e uma petição pela
     metade é pior que petição nenhuma: em 02/09/2026 saiu um .doc de 2.827
     bytes cortado no meio da frase, salvo como se estivesse pronto. Só aceita
     resposta que chegou ao fim (message_stop). */
  if (!data || !data.completo) return { erro: 'a resposta da IA foi cortada no meio (conexão interrompida) — nada foi gravado; rode de novo', status: 502, cortada: true }
  if (data.stop_reason === 'max_tokens') return { erro: 'a peça ficou maior que o limite de saída do modelo e foi cortada — nada foi gravado; peça um recorte menor', status: 502, cortada: true }

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

  return { texto, ferramenta: ferramentaUsada, usage, custoUsd: custo, modelo, stopReason: data.stop_reason || null, bruto: data }
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
