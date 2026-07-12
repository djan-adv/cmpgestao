// API do CMPGestão — leitura de lead por IA (server-side).
// Lê os anexos (prints/PDFs) do bucket "leads-publicos" e a mensagem do lead e
// devolve 2 camadas: "card" (nome, telefone, assunto, observação curta) e
// "memoria" (contexto/história completos, para uso interno futuro).
// A chave da Anthropic NUNCA sai do servidor. Exige usuário autenticado.
//
// Variáveis de ambiente necessárias (no .env.local do VPS):
//   ANTHROPIC_API_KEY, SUPABASE_SERVICE_ROLE_KEY,
//   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const BUCKET = 'leads-publicos'

async function usuario(request) {
  const auth = request.headers.get('authorization') || ''
  const jwt = auth.replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const u = await sb.auth.getUser(jwt)
  return (u && u.data && u.data.user) || null
}

export async function POST(request) {
  const user = await usuario(request)
  if (!user) return Response.json({ erro: 'não autenticado' }, { status: 401 })

  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return Response.json({ erro: 'IA não configurada: defina ANTHROPIC_API_KEY no servidor.' }, { status: 501 })

  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, svc)

  const b = await request.json().catch(() => ({}))
  const paths = Array.isArray(b.paths) ? b.paths.slice(0, 10) : []

  const content = []
  for (const p of paths) {
    try {
      const dl = await admin.storage.from(BUCKET).download(p)
      if (dl.error || !dl.data) continue
      const buf = Buffer.from(await dl.data.arrayBuffer())
      const b64 = buf.toString('base64')
      const mt = dl.data.type || ''
      if (/^image\//.test(mt)) {
        content.push({ type: 'image', source: { type: 'base64', media_type: mt, data: b64 } })
      } else if (mt === 'application/pdf' || /\.pdf$/i.test(p)) {
        content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } })
      }
      // outros tipos (docx, xlsx, etc.) são ignorados aqui — a mensagem de texto abaixo ainda é lida
    } catch (e) { /* ignora arquivo problemático */ }
  }

  const instr =
    'Você extrai dados de um possível cliente (lead) de um escritório de advocacia, a partir de prints/mensagens.\n' +
    'Mensagem digitada pelo lead: ' + (b.mensagem || '(vazia)') + '\n' +
    'Nome já informado: ' + (b.nome || '(vazio)') + ' · Telefone já informado: ' + (b.telefone || '(vazio)') + '\n\n' +
    'Responda SOMENTE com um JSON válido, sem nenhum texto fora dele, exatamente neste formato:\n' +
    '{"card":{"nome":"","telefone":"","assunto":"","observacao":""},"memoria":{"historia":"","contexto":"","partes":"","valores":"","prazos":"","detalhes":""}}\n\n' +
    'REGRAS OBRIGATÓRIAS:\n' +
    '- NUNCA invente nome, telefone, valores ou qualquer dado. Se um campo não estiver claramente identificado, deixe-o como string vazia "".\n' +
    '- card.assunto = resumo curto (poucas palavras) do problema jurídico.\n' +
    '- card.observacao = 1 a 2 frases objetivas.\n' +
    '- memoria = TODO o contexto e a história detalhada, para uso interno futuro (montar ficha/histórico).\n' +
    '- telefone: só os dígitos que realmente aparecem.'
  content.push({ type: 'text', text: instr })

  const payload = { model: 'claude-sonnet-5', max_tokens: 1500, messages: [{ role: 'user', content }] }

  let data
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(payload),
    })
    data = await r.json()
    if (!r.ok) return Response.json({ erro: 'IA: ' + ((data && data.error && data.error.message) || r.status) }, { status: 502 })
  } catch (e) {
    return Response.json({ erro: 'IA indisponível: ' + (e.message || e) }, { status: 502 })
  }

  let txt = ''
  try { txt = (data.content || []).map((c) => c.text || '').join('\n') } catch (e) {}
  let out = { card: {}, memoria: null }
  try { const m = txt.match(/\{[\s\S]*\}/); if (m) out = JSON.parse(m[0]) } catch (e) {}

  const card = out.card || {}
  return Response.json({
    card: {
      nome: card.nome || '',
      telefone: card.telefone ? String(card.telefone) : '',
      assunto: card.assunto || '',
      observacao: card.observacao || '',
    },
    memoria: out.memoria || null,
  })
}
