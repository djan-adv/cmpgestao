// jus.br / PDPJ — robô diário dos MOVIMENTOS.
//
// Por que existe: a rota de movimentos só rodava por CLIQUE no botão
// "↻ atualizar" da ficha. Resultado prático — o 0863182-07.2024.8.15.2001 estava
// "Conclusos para despacho" desde 30/07/2026 no jus.br e o sistema mostrava
// histórico parado em 26/02, porque ninguém tinha aberto aquela ficha. Conclusão
// e juntada não saem no DJEN: só existem na consulta do PDPJ. Movimento tem que
// entrar sozinho, todo dia.
//
//   GET /api/jusbr/movimentos/robo                  -> rodada do cron
//   GET /api/jusbr/movimentos/robo?numero=NNN&debug=1 -> teste de um processo
//   Parâmetros: ?lote=20 (processos por rodada)
// Aberta (sem login) para rodar pelo cron; não expõe o token.
//
// Rodízio: em vez de varrer os ~470 ativos de uma vez (estouraria o tempo),
// pega o lote mais "esquecido" por processos.jusbr_mov_em (nulls first) e
// carimba ao final. Rodando de 15 em 15 min, o parque inteiro é coberto
// várias vezes ao dia.

import { jusbrAdmin, getFreshToken, ESCRITORIO_CMP } from '../../lib.js'
import { buscarProcesso, movimentosDoProcesso, aplicarMeta, gravarMovimentos } from '../core.js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0
export const maxDuration = 300

const LOTE_PADRAO = 20
const soDig = (s) => String(s || '').replace(/\D/g, '')
const ENCERRADO = /encerrad|arquivad|baixad/i

export async function GET(request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ erro: 'falta service key' }, { status: 500 })
  if (!process.env.JUSBR_ENC_KEY) return Response.json({ erro: 'falta JUSBR_ENC_KEY' }, { status: 500 })
  const { searchParams } = new URL(request.url)
  const debug = searchParams.get('debug') != null
  const soNumero = soDig(searchParams.get('numero') || '')
  const lote = Math.min(parseInt(searchParams.get('lote') || String(LOTE_PADRAO), 10) || LOTE_PADRAO, 100)
  const sb = jusbrAdmin()

  const tk = await getFreshToken(sb)
  if (tk.erro) return Response.json({ ok: false, erro: 'jus.br: ' + tk.erro + ' — sincronize a sessão do jus.br', motivo: tk.erro })
  const token = tk.token

  // ——— escolhe os alvos ———
  let alvos = []
  if (soNumero) {
    const { data } = await sb.from('processos')
      .select('id,numero,numero_digitos')
      .eq('escritorio_id', ESCRITORIO_CMP).eq('numero_digitos', soNumero).limit(1)
    alvos = data || []
  } else {
    // Puxa mais que o lote porque o filtro de encerrado/arquivado é feito aqui
    // (status é texto livre e não dá para expressar bem no filtro do PostgREST).
    const { data, error } = await sb.from('processos')
      .select('id,numero,numero_digitos,status,suspenso,jusbr_mov_em')
      .eq('escritorio_id', ESCRITORIO_CMP)
      .or('suspenso.is.null,suspenso.eq.false')
      .order('jusbr_mov_em', { ascending: true, nullsFirst: true })
      .limit(lote * 4)
    if (error) return Response.json({ ok: false, erro: error.message }, { status: 500 })
    alvos = (data || [])
      .filter(p => soDig(p.numero_digitos || p.numero).length === 20)
      .filter(p => !ENCERRADO.test(p.status || ''))
      .slice(0, lote)
  }

  const rel = {
    ok: true, quando: new Date().toISOString(),
    processos: alvos.length, novos: 0, jaTinha: 0, sem_acesso: 0, erros: 0, detalhe: [],
  }

  for (const p of alvos) {
    const numero = soDig(p.numero_digitos || p.numero)
    const busca = await buscarProcesso(token, numero)

    if (busca.erro) {
      // Sessão caiu: PARA a rodada e NÃO carimba — senão os processos que ainda
      // não foram varridos iriam para o fim da fila sem terem sido lidos, e o
      // rodízio passaria a pular gente a cada expiração de token.
      if (busca.motivo === 'expirado') {
        rel.interrompido = 'token expirado no meio da rodada — sincronize a sessão do jus.br'
        rel.motivo = 'expirado'
        break
      }
      // Processo alheio (não somos advogado habilitado): é permanente, então
      // carimba para ele ir ao fim da fila e não travar o rodízio.
      if (busca.motivo === 'sem_acesso') {
        rel.sem_acesso++
        await sb.from('processos').update({ jusbr_mov_em: new Date().toISOString() }).eq('id', p.id)
        if (debug) rel.detalhe.push({ numero, erro: 'sem_acesso' })
        continue
      }
      rel.erros++
      rel.detalhe.push({ numero, erro: busca.erro })
      continue
    }

    const { movs } = movimentosDoProcesso(busca.proc)
    await aplicarMeta(sb, numero, busca.proc)
    const g = await gravarMovimentos(sb, numero, movs, 'jusbr')

    rel.novos += g.inseridos
    rel.jaTinha += g.jaTinha
    rel.erros += g.erros
    await sb.from('processos').update({ jusbr_mov_em: new Date().toISOString() }).eq('id', p.id)
    if (debug || g.inseridos) rel.detalhe.push({ numero, movimentos: movs.length, novos: g.inseridos })
  }

  return Response.json(rel)
}
