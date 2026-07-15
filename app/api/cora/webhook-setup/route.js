// Ativação da baixa automática: registra no Cora o webhook de fatura paga.
//
//   POST /api/cora/webhook-setup   (Authorization: Bearer <jwt do Supabase>)
//     -> cadastra no Cora (POST /endpoints) a URL pública do nosso webhook
//        (/api/cora/webhook?secret=...) para o evento de fatura paga.
//        Idempotente: se a URL já está cadastrada lá, não duplica.
//   GET  /api/cora/webhook-setup   (Authorization: Bearer <jwt>)
//     -> lista os webhooks registrados no Cora (para conferência).
//
// Restrito ao coordenador (mesmo padrão das rotas de deploy/acessos).

import { coraConfigurado, coraApi, usuarioDoToken } from '../lib.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const ALLOW = ['djan.adv@gmail.com']

function autorizado(user) {
  return !!user && ALLOW.includes(String(user.email || '').toLowerCase())
}

// URL pública do sistema, deduzida do próprio request (atrás de proxy usa x-forwarded-*)
function urlPublica(request) {
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host') || ''
  const proto = request.headers.get('x-forwarded-proto') || 'https'
  return host ? (proto + '://' + host.split(',')[0].trim()) : ''
}

// a lista pode vir como array puro ou embrulhada ({endpoints|items|content})
function listaEndpoints(json) {
  if (Array.isArray(json)) return json
  if (!json) return []
  return json.endpoints || json.items || json.content || []
}

export async function GET(request) {
  const { user } = await usuarioDoToken(request)
  if (!autorizado(user)) return Response.json({ erro: 'Sem permissão.' }, { status: 403 })
  if (!coraConfigurado()) return Response.json({ erro: 'Integração Cora não configurada no servidor.' }, { status: 503 })
  try {
    const r = await coraApi('GET', '/endpoints', null)
    return Response.json({ ok: r.status >= 200 && r.status < 300, status: r.status, endpoints: listaEndpoints(r.json), raw: (r.raw || '').slice(0, 800) })
  } catch (e) {
    return Response.json({ erro: 'Erro ao consultar o Cora: ' + ((e && e.message) || e) }, { status: 502 })
  }
}

export async function POST(request) {
  const { user } = await usuarioDoToken(request)
  if (!autorizado(user)) return Response.json({ erro: 'Sem permissão.' }, { status: 403 })
  if (!coraConfigurado()) return Response.json({ erro: 'Integração Cora não configurada no servidor.' }, { status: 503 })
  const secret = process.env.CORA_WEBHOOK_SECRET || ''
  if (!secret) return Response.json({ erro: 'CORA_WEBHOOK_SECRET não está no .env.local do servidor.' }, { status: 503 })

  const base = urlPublica(request)
  if (!base) return Response.json({ erro: 'Não consegui deduzir a URL pública do sistema.' }, { status: 500 })
  const hookUrl = base + '/api/cora/webhook?secret=' + encodeURIComponent(secret)

  try {
    // já existe? (idempotência: não cadastrar a mesma URL duas vezes)
    const atual = await coraApi('GET', '/endpoints', null)
    const jaTem = listaEndpoints(atual.json).find(e => e && e.url === hookUrl)
    if (jaTem) return Response.json({ ok: true, jaCadastrado: true, id: jaTem.id || null })

    // cadastra o aviso de fatura paga
    const r = await coraApi('POST', '/endpoints', { url: hookUrl, resource: 'invoice', trigger: 'paid' })
    if (r.status < 200 || r.status >= 300) {
      return Response.json({
        erro: 'O Cora recusou o cadastro do webhook (' + r.status + '). Detalhe: ' + String(r.raw || '').slice(0, 400)
      }, { status: 502 })
    }
    return Response.json({ ok: true, criado: true, id: (r.json && r.json.id) || null })
  } catch (e) {
    return Response.json({ erro: 'Erro ao falar com o Cora: ' + ((e && e.message) || e) }, { status: 502 })
  }
}
