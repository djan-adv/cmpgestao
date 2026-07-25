// Diagnóstico da sessão do jus.br — mostra EXATAMENTE o que o servidor enxerga.
// Não devolve o token; só metadados (validade, origem, projeto do banco, relógio).
//   GET /api/jusbr/diag
import { createClient } from '@supabase/supabase-js'
import { lerSessao, getFreshToken, ESCRITORIO_CMP } from '../lib.js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0
export const maxDuration = 20

export async function GET() {
  const agora = new Date()
  const out = {
    relogio_do_servidor_utc: agora.toISOString(),
    relogio_brasilia: new Date(agora.getTime() - 3 * 3600000).toISOString().replace('T', ' ').slice(0, 19),
    projeto_supabase: String(process.env.NEXT_PUBLIC_SUPABASE_URL || '(vazio)').replace(/^https?:\/\//, '').split('.')[0],
    tem_service_key: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    tem_enc_key: !!process.env.JUSBR_ENC_KEY,
    escritorio: ESCRITORIO_CMP.slice(0, 8) + '…',
  }
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    // 1) o que a TABELA diz (leitura direta, sem cache)
    const { data: linha, error: e1 } = await sb.from('jusbr_sessao').select('expira,atualizado_em,atualizado_por').eq('escritorio_id', ESCRITORIO_CMP).maybeSingle()
    out.tabela = e1 ? { erro: e1.message } : (linha ? {
      expira: linha.expira,
      faltam_min: linha.expira ? Math.round((new Date(linha.expira).getTime() - agora.getTime()) / 60000) : null,
      gravado_em: linha.atualizado_em, por: linha.atualizado_por,
    } : { erro: 'sem linha' })
    // 2) o que a FUNÇÃO de leitura devolve (é o que as rotas usam)
    const sess = await lerSessao(sb)
    out.funcao = sess.erro ? { erro: sess.erro } : {
      expira: sess.expira,
      faltam_min: sess.expira ? Math.round((new Date(sess.expira).getTime() - agora.getTime()) / 60000) : null,
      tem_token: !!sess.token, tem_refresh: !!sess.refresh,
      token_termina_em: sess.token ? String(sess.token).slice(-12) : null,
    }
    // 3) o veredito que as rotas de download recebem
    const fresco = await getFreshToken(sb)
    out.veredito = fresco.erro ? { erro: fresco.erro, detalhe: fresco.detalhe || null } : { ok: true, expira: fresco.expira, token_termina_em: String(fresco.token).slice(-12) }
  } catch (e) {
    out.excecao = String((e && e.message) || e)
  }
  return Response.json(out, { headers: { 'Cache-Control': 'no-store' } })
}
