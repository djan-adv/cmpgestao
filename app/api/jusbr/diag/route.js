// Diagnóstico da sessão do jus.br — mostra EXATAMENTE o que o servidor enxerga.
// Não devolve o token; só metadados (validade, origem, projeto do banco, relógio).
//   GET /api/jusbr/diag
import { createClient } from '@supabase/supabase-js'
import { lerSessao, getFreshToken, resumoClaims, ehEmissorPdpj, ESCRITORIO_RAIZ } from '../lib.js'
import { usuarioDoRequest, escritorioDoUsuario } from '../../_lib/inquilino.js'

const PDPJ = 'https://portaldeservicos.pdpj.jus.br'
const PDPJ_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'Origin': PDPJ,
  'Referer': PDPJ + '/consulta/autosdigitais',
}

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0
export const maxDuration = 20

// Diagnóstico DA SESSÃO DE QUEM PERGUNTA: logado, é o escritório do usuário;
// chamado do console do servidor (cron, curl no VPS), é o da instalação.
export async function GET(request) {
  const agora = new Date()
  let esc = ESCRITORIO_RAIZ
  try {
    const user = await usuarioDoRequest(request)
    if (user) esc = (await escritorioDoUsuario(user.id)) || esc
  } catch (e) {}
  const out = {
    relogio_do_servidor_utc: agora.toISOString(),
    relogio_brasilia: new Date(agora.getTime() - 3 * 3600000).toISOString().replace('T', ' ').slice(0, 19),
    projeto_supabase: String(process.env.NEXT_PUBLIC_SUPABASE_URL || '(vazio)').replace(/^https?:\/\//, '').split('.')[0],
    tem_service_key: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    tem_enc_key: !!process.env.JUSBR_ENC_KEY,
    escritorio: esc.slice(0, 8) + '…',
  }
  try {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    // 1) o que a TABELA diz (leitura direta, sem cache)
    const { data: linha, error: e1 } = await sb.from('jusbr_sessao').select('expira,atualizado_em,atualizado_por').eq('escritorio_id', esc).maybeSingle()
    out.tabela = e1 ? { erro: e1.message } : (linha ? {
      expira: linha.expira,
      faltam_min: linha.expira ? Math.round((new Date(linha.expira).getTime() - agora.getTime()) / 60000) : null,
      gravado_em: linha.atualizado_em, por: linha.atualizado_por,
    } : { erro: 'sem linha' })
    // 2) o que a FUNÇÃO de leitura devolve (é o que as rotas usam)
    const sess = await lerSessao(sb, esc)
    out.funcao = sess.erro ? { erro: sess.erro } : {
      expira: sess.expira,
      faltam_min: sess.expira ? Math.round((new Date(sess.expira).getTime() - agora.getTime()) / 60000) : null,
      tem_token: !!sess.token, tem_refresh: !!sess.refresh,
      token_termina_em: sess.token ? String(sess.token).slice(-12) : null,
    }
    // 3) o veredito que as rotas de download recebem
    const fresco = await getFreshToken(sb, null, esc)
    out.veredito = fresco.erro ? { erro: fresco.erro, detalhe: fresco.detalhe || null } : { ok: true, expira: fresco.expira, token_termina_em: String(fresco.token).slice(-12) }

    // 4) DE ONDE veio o token. O navegador guarda vários JWTs; se o userscript
    // pegar o de outro emissor (gov.br, outro cliente), o banco fica "válido" e
    // mesmo assim o PDPJ devolve 401. Aqui isso aparece na hora.
    if (fresco.token) {
      out.token_claims = resumoClaims(fresco.token)
      out.emissor_pdpj = ehEmissorPdpj(fresco.token)
    }
    // última captura recusada (se houve) — ajuda a ver o que o portal mandou
    try {
      const { data: rej } = await sb.from('produtividade_config').select('valor')
        .eq('escritorio_id', esc).eq('chave', 'jusbr_ultima_rejeicao').maybeSingle()
      if (rej && rej.valor) { try { out.ultima_rejeicao = JSON.parse(rej.valor) } catch (e) { out.ultima_rejeicao = rej.valor } }
    } catch (e) {}

    // 5) PROVA REAL: chama o PDPJ com o token guardado, usando um processo do
    // escritório. É o único teste que distingue "token válido" de "token aceito".
    if (fresco.token) {
      try {
        const { data: pr } = await sb.from('processos').select('numero_digitos')
          .not('numero_digitos', 'is', null).limit(1)
        const numero = pr && pr[0] && String(pr[0].numero_digitos || '').replace(/\D/g, '')
        if (numero && numero.length >= 16) {
          const r = await fetch(`${PDPJ}/api/v2/processos/${numero}`, {
            headers: { ...PDPJ_HEADERS, Authorization: 'Bearer ' + fresco.token, Accept: 'application/json' },
            cache: 'no-store', signal: AbortSignal.timeout(20000),
          })
          const corpo = await r.text().catch(() => '')
          out.teste_pdpj = {
            processo: numero, http: r.status, aceito: r.ok,
            www_authenticate: r.headers.get('www-authenticate') || null,
            corpo: String(corpo).slice(0, 300),
          }
        } else out.teste_pdpj = { erro: 'sem processo cadastrado para testar' }
      } catch (e) { out.teste_pdpj = { erro: String((e && e.message) || e) } }
    }
  } catch (e) {
    out.excecao = String((e && e.message) || e)
  }
  return Response.json(out, { headers: { 'Cache-Control': 'no-store' } })
}
