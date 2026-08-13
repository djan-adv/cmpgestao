// Chat público de captação — cliente novo, sem processo ainda.
// Usado pela página pública app/cliente (gestao.cmpadvogados.com.br/cliente):
// sem login, aberta a qualquer pessoa (link pro site ou mandado direto).
//
// Grava direto em crm_leads (o mesmo funil que a equipe já usa), em etapas —
// nome, mensagem, e-mail — puxadas pela conversa. O "proc_ref" guarda uma
// referência curta (data/hora) que aparece pro visitante e vai junto no texto
// pronto do botão de WhatsApp, pra dar pra cruzar as duas conversas depois.
//
// Sem chave/segredo: é EXATAMENTE o mesmo modelo de acesso que leads_publicos
// já usa (INSERT liberado pro anon) — só que passando pela API (em vez do
// client direto) porque crm_leads não é gravável por anon, e porque aqui
// precisamos de UPDATE incremental por id (leads_publicos só aceita INSERT).
//
//   POST { acao:'criar', origem_url, nome?, email? }                  -> { ok, id, ref }
//   POST { acao:'atualizar', id, nome?, email?, mensagem?, arquivo? } -> { ok }

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const ESCRITORIO_CMP = '908f77fc-19f5-4d86-9576-f5590af09e0a'
const MAX_TEXTO = 4000

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}

// referência curta tipo "13/08-0952" — não é o número CNJ (ainda não existe),
// é só pra achar essa conversa rápido no funil e cruzar com o WhatsApp
function referencia(d) {
  const dt = d || new Date()
  const dd = String(dt.getDate()).padStart(2, '0')
  const mm = String(dt.getMonth() + 1).padStart(2, '0')
  const hh = String(dt.getHours()).padStart(2, '0')
  const mi = String(dt.getMinutes()).padStart(2, '0')
  return dd + '/' + mm + '-' + hh + mi
}

export async function POST(request) {
  let body
  try { body = await request.json() } catch (e) { return Response.json({ erro: 'json inválido' }, { status: 400 }) }
  const sb = admin()

  if (body.acao === 'criar') {
    const agora = new Date()
    const ref = referencia(agora)
    const nome = String(body.nome || '').trim().slice(0, 200) || null
    const email = String(body.email || '').trim().slice(0, 200) || null
    const origem = String(body.origem_url || '').slice(0, 500)
    const ins = await sb.from('crm_leads').insert({
      escritorio_id: ESCRITORIO_CMP, nome, email, canal: 'Chat do site', estagio: 'novo',
      prioridade: 'media', proc_ref: ref, data: agora.toISOString().slice(0, 10),
      obs: origem ? ('Origem: ' + origem) : null,
      capturado_em: agora.toISOString(), ultima_atividade: agora.toISOString(), ordem: Date.now(),
    }).select('id').single()
    if (ins.error) return Response.json({ erro: ins.error.message }, { status: 500 })
    // já veio com nome (link personalizado) -> avisa o escritório de cara
    if (nome) {
      try { fetch(new URL('/api/notificar-jader?lead=' + ins.data.id, request.url).toString(), { cache: 'no-store' }).catch(() => {}) } catch (e) {}
    }
    return Response.json({ ok: true, id: ins.data.id, ref })
  }

  if (body.acao === 'atualizar') {
    const id = String(body.id || '')
    if (!id) return Response.json({ erro: 'id ausente' }, { status: 400 })
    const atual = await sb.from('crm_leads').select('obs,arquivos,nome').eq('id', id).eq('escritorio_id', ESCRITORIO_CMP).maybeSingle()
    if (!atual.data) return Response.json({ erro: 'não encontrado' }, { status: 404 })

    const patch = { ultima_atividade: new Date().toISOString() }
    if (body.nome) patch.nome = String(body.nome).trim().slice(0, 200)
    if (body.email) patch.email = String(body.email).trim().slice(0, 200)
    if (body.mensagem) {
      const linha = String(body.mensagem).trim().slice(0, MAX_TEXTO)
      if (linha) patch.obs = (atual.data.obs ? (atual.data.obs + '\n\n') : '') + linha
    }
    if (body.arquivo && body.arquivo.path) {
      const lista = Array.isArray(atual.data.arquivos) ? atual.data.arquivos.slice() : []
      lista.push({
        nome: String(body.arquivo.nome || 'arquivo').slice(0, 200),
        path: String(body.arquivo.path).slice(0, 500),
        tipo: String(body.arquivo.tipo || ''),
        tamanho: Number(body.arquivo.tamanho) || 0,
        quando: new Date().toISOString(),
      })
      patch.arquivos = lista
    }
    const upd = await sb.from('crm_leads').update(patch).eq('id', id)
    if (upd.error) return Response.json({ erro: upd.error.message }, { status: 500 })

    // primeira vez que dá pra identificar quem é (nome chegou) -> avisa o escritório
    if (patch.nome && !atual.data.nome) {
      try { fetch(new URL('/api/notificar-jader?lead=' + id, request.url).toString(), { cache: 'no-store' }).catch(() => {}) } catch (e) {}
    }
    return Response.json({ ok: true })
  }

  return Response.json({ erro: 'ação inválida' }, { status: 400 })
}
