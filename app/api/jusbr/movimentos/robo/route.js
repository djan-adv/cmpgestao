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

import { jusbrAdmin, getFreshToken } from '../../lib.js'
import { buscarProcesso, movimentosDoProcesso, aplicarMeta, gravarMovimentos } from '../core.js'
import { escritoriosAtivos } from '../../../_lib/inquilino.js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0
export const maxDuration = 300

const LOTE_PADRAO = 20
const soDig = (s) => String(s || '').replace(/\D/g, '')
const ENCERRADO = /encerrad|arquivad|baixad/i

// Uma rodada para UM escritório. O robô não tem usuário logado, então o
// escritório não vem de um login: vem do laço em GET, que percorre os
// escritórios ativos que têm sessão do jus.br própria. Antes isto rodava
// sempre com o id do escritório dono escrito no código — o que, com um cliente
// dentro, seria o robô dele varrendo o acervo do fornecedor com o certificado
// do fornecedor.
async function rodarPara(esc, opcoes) {
  const { debug, soNumero, lote } = opcoes
  const sb = jusbrAdmin()

  const tk = await getFreshToken(sb, null, esc.id)
  if (tk.erro) return { ok: false, escritorio: esc.nome, erro: 'jus.br: ' + tk.erro + ' — sincronize a sessão do jus.br', motivo: tk.erro }
  const token = tk.token

  // ——— escolhe os alvos ———
  let alvos = []
  let relFora = 0   // quantos saíram da fila por serem encerrados/sem número CNJ
  if (soNumero) {
    const { data } = await sb.from('processos')
      .select('id,numero,numero_digitos')
      .eq('escritorio_id', esc.id).eq('numero_digitos', soNumero).limit(1)
    alvos = data || []
  } else {
    // Puxa mais que o lote porque o filtro de encerrado/arquivado é feito aqui
    // (status é texto livre e não dá para expressar bem no filtro do PostgREST).
    const { data, error } = await sb.from('processos')
      .select('id,numero,numero_digitos,status,suspenso,jusbr_mov_em')
      .eq('escritorio_id', esc.id)
      .or('suspenso.is.null,suspenso.eq.false')
      .order('jusbr_mov_em', { ascending: true, nullsFirst: true })
      // janela folgada: se muitos descartáveis vierem seguidos, ainda sobra
      // processo ativo para varrer na MESMA rodada, em vez de gastá-la só
      // carimbando (ver "TRAVA DA FILA" abaixo)
      .limit(lote * 12)
    if (error) return { ok: false, escritorio: esc.nome, erro: error.message }
    // processo com audiência HOJE ou AMANHÃ fura a fila do rodízio: é quando o
    // cliente está olhando o app e a linha do tempo não pode estar atrasada
    // (pedido do dono, 18/08/2026 — a audiência do dia aparecia com movimentação
    // de um mês antes).
    let prioritarios = []
    try {
      const hojeBR = new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10)
      const amanhaBR = new Date(Date.now() - 3 * 3600000 + 86400000).toISOString().slice(0, 10)
      const { data: evs } = await sb.from('agenda_eventos').select('data,tipo,titulo,processo_numero')
        .in('data', [hojeBR, amanhaBR]).limit(300)
      const digs = [...new Set((evs || [])
        .filter(e => e.processo_numero && (e.tipo === 'az' || /audi[êe]ncia/i.test(e.titulo || '')))
        .map(e => soDig(e.processo_numero)))].filter(d => d.length === 20)
      if (digs.length) {
        const { data: pri } = await sb.from('processos')
          .select('id,numero,numero_digitos,status,suspenso,jusbr_mov_em')
          .eq('escritorio_id', esc.id).in('numero_digitos', digs).limit(50)
        prioritarios = (pri || [])
          .filter(p => !ENCERRADO.test(p.status || '') && p.suspenso !== true)
          // já atualizado na última hora não fura de novo — senão monopoliza o lote
          .filter(p => !p.jusbr_mov_em || (Date.now() - new Date(p.jusbr_mov_em).getTime()) > 3600000)
      }
    } catch (e) {}
    const jaNoLote = new Set(prioritarios.map(p => p.id))
    const brutos = (data || []).filter(p => !jaNoLote.has(p.id))
    // Descartáveis: encerrado/arquivado/baixado e o que não tem número CNJ.
    const fora = (p) => soDig(p.numero_digitos || p.numero).length !== 20 || ENCERRADO.test(p.status || '')
    const descartados = brutos.filter(fora)
    alvos = prioritarios.concat(brutos.filter(p => !fora(p))).slice(0, lote)

    // ——— TRAVA DA FILA (corrigida em 26/08/2026) ———
    // O filtro de encerrado é feito AQUI, não no banco (status é texto livre).
    // Só que o descartado saía da rodada SEM ser carimbado — e como a fila é
    // ordenada por jusbr_mov_em com NULOS PRIMEIRO, ele voltava ao topo na
    // rodada seguinte, para sempre. Com 155 encerrados sem carimbo e uma janela
    // de lote*4, as vagas eram todas ocupadas por eles: o robô respondia
    // "processos: 0" a cada 15 minutos e NENHUM processo ativo era varrido.
    // Efeito real: juntada de carta de citação de 24/08 não entrou no sistema,
    // que seguia mostrando 03/08 — risco de perda de prazo (0804936-40.2018.8.15.0251).
    // A correção é a mesma que este arquivo já aplicava ao caso 'sem_acesso'
    // logo abaixo: carimbar o que foi descartado, para ir ao fim da fila e não
    // travar o rodízio. Auto-corretivo — em poucas rodadas a fila desentope.
    if (descartados.length) {
      const ids = descartados.map(p => p.id)
      await sb.from('processos').update({ jusbr_mov_em: new Date().toISOString() }).in('id', ids)
      relFora = descartados.length
    }
  }

  const rel = {
    ok: true, quando: new Date().toISOString(),
    processos: alvos.length, novos: 0, jaTinha: 0, sem_acesso: 0, erros: 0, detalhe: [],
    fora_do_rodizio: relFora,
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

    const { movs } = movimentosDoProcesso(busca.procs)
    await aplicarMeta(sb, numero, busca.procs)
    const g = await gravarMovimentos(sb, numero, movs, 'jusbr', esc.id)

    rel.novos += g.inseridos
    rel.jaTinha += g.jaTinha
    rel.erros += g.erros
    await sb.from('processos').update({ jusbr_mov_em: new Date().toISOString() }).eq('id', p.id)
    if (debug || g.inseridos) rel.detalhe.push({ numero, movimentos: movs.length, novos: g.inseridos })
  }

  return { ...rel, escritorio: esc.nome }
}

export async function GET(request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ erro: 'falta service key' }, { status: 500 })
  if (!process.env.JUSBR_ENC_KEY) return Response.json({ erro: 'falta JUSBR_ENC_KEY' }, { status: 500 })
  const { searchParams } = new URL(request.url)
  const opcoes = {
    debug: searchParams.get('debug') != null,
    soNumero: soDig(searchParams.get('numero') || ''),
    lote: Math.min(parseInt(searchParams.get('lote') || String(LOTE_PADRAO), 10) || LOTE_PADRAO, 100),
  }

  // Só escritórios com sessão própria do jus.br entram na fila: sem
  // certificado sincronizado não há o que consultar, e tentar seria usar a
  // credencial de outro.
  const escs = await escritoriosAtivos('jusbr')
  if (!escs.length) return Response.json({ ok: true, nada: true, motivo: 'nenhum escritório com sessão do jus.br' })

  const porEscritorio = []
  for (const esc of escs) {
    try { porEscritorio.push(await rodarPara(esc, opcoes)) }
    catch (e) { porEscritorio.push({ ok: false, escritorio: esc.nome, erro: String((e && e.message) || e) }) }
  }
  // O relatório soma tudo, mas mantém a linha de cada escritório: um cliente
  // com a sessão vencida não pode fazer o robô inteiro parecer quebrado.
  const soma = (campo) => porEscritorio.reduce((t, r) => t + (Number(r[campo]) || 0), 0)
  return Response.json({
    ok: porEscritorio.some(r => r.ok !== false),
    escritorios: porEscritorio.length,
    novos: soma('novos'), jaTinha: soma('jaTinha'), erros: soma('erros'),
    processos: soma('processos'), sem_acesso: soma('sem_acesso'),
    por_escritorio: porEscritorio,
  })
}
