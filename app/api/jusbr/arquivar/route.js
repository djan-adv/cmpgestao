// FAXINA do cache do jus.br — tira o conteúdo dos arquivos de dentro do banco
// (coluna conteudo_b64, em base64) e passa para o disco do VPS, em
// /opt/cmpdocs/<processo>/Autos (jus.br)/. A linha em jusbr_arquivos CONTINUA
// existindo, só que apontando para o disco (caminho_disco) — assim a ficha segue
// mostrando o documento como baixado e o visualizador abre igual.
//
// Motivo: o banco free do Supabase tem 500 MB e essa tabela sozinha passou de
// 1,3 GB. Base64 ainda infla o arquivo em ~33%, então o banco guardava ~1,2 GB
// para ~900 MB de arquivo real.
//
//   GET /api/jusbr/arquivar?dry=1        -> simula, não grava nem apaga nada
//   GET /api/jusbr/arquivar?limite=40    -> processa um lote (padrão 40)
//
// SEGURANÇA (a ordem importa): grava no disco -> confere que o arquivo existe com
// o tamanho certo -> só então limpa o conteudo_b64 daquela linha. Se qualquer
// passo falhar, a linha fica intacta no banco e o arquivo é tentado de novo na
// próxima rodada. Nada é apagado sem cópia conferida no disco.

import fs from 'fs'
import { ESCRITORIO_RAIZ } from '../../_lib/inquilino.js'
import { createClient } from '@supabase/supabase-js'
import { gravarNoDisco } from '../guardar.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Ainda de um escritorio so, de proposito: Faxina do cache de arquivos do jus.br no banco do dono.
// (fase dos robos por inquilino: este nao entra ate ter credencial propria)
const ESCRITORIO_CMP = ESCRITORIO_RAIZ
const LOTE_PADRAO = 40

// IMPORTANTE: cache: 'no-store'. Sem isto o Next.js guarda a resposta da LISTA e
// devolve a mesma leitura antiga em toda rodada — foi o que travou a migração de
// 01/08: os 40 maiores foram migrados na primeira volta e, dali em diante, a lista
// cacheada seguia entregando esses mesmos 40 (agora já sem conteúdo), dando
// "sem conteúdo para migrar" 40 vezes e zero progresso por mais de um dia.
// (O mesmo já tinha mordido a sessão do jus.br — ver comentário em ../lib.js.)
function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    global: { fetch: (input, init) => fetch(input, { ...(init || {}), cache: 'no-store' }) },
  })
}

export async function GET(request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return Response.json({ erro: 'falta service key' }, { status: 500 })
  const { searchParams } = new URL(request.url)
  const dry = searchParams.get('dry') != null
  const limite = Math.min(parseInt(searchParams.get('limite') || String(LOTE_PADRAO), 10) || LOTE_PADRAO, 200)
  const sb = admin()

  // quanto ainda falta (para o painel saber quando acabou)
  const { count: faltam } = await sb.from('jusbr_arquivos')
    .select('id', { count: 'exact', head: true })
    .eq('escritorio_id', ESCRITORIO_CMP).not('conteudo_b64', 'is', null).is('caminho_disco', null)

  // Só a LISTA (sem o conteúdo). Puxar 40 arquivos de uma vez traria centenas de
  // MB para a memória de uma tacada — tem vídeo de 60 MB aqui dentro — e derrubaria
  // o processo no VPS. O conteúdo vem depois, UM DE CADA VEZ.
  // Maiores primeiro: libera espaço mais rápido.
  // O `caminho_disco is null` é cinto e suspensório: quem já está no disco NUNCA
  // pode voltar para a lista, nem que uma leitura velha escape em algum ponto.
  const { data: linhas, error } = await sb.from('jusbr_arquivos')
    .select('id,processo_numero,doc_nome,tamanho')
    .eq('escritorio_id', ESCRITORIO_CMP).not('conteudo_b64', 'is', null).is('caminho_disco', null)
    .order('tamanho', { ascending: false, nullsFirst: false })
    .limit(limite)
  if (error) return Response.json({ erro: error.message }, { status: 500 })

  const rel = { ok: true, dry, faltavam: faltam || 0, processados: 0, bytes_liberados: 0, erros: [], restam: 0 }
  if (!linhas || !linhas.length) { rel.restam = 0; rel.fim = true; return Response.json(rel) }

  for (const r of linhas) {
    if (dry) { rel.processados++; rel.bytes_liberados += (r.tamanho || 0); continue }
    try {
      // busca o conteúdo deste arquivo só agora, e solta da memória ao fim da volta
      const { data: um, error: eSel } = await sb.from('jusbr_arquivos')
        .select('conteudo_b64').eq('id', r.id).maybeSingle()
      if (eSel || !um || !um.conteudo_b64) { rel.erros.push({ id: r.id, erro: 'sem conteúdo para migrar' }); continue }

      const b64len = um.conteudo_b64.length
      const buf = Buffer.from(um.conteudo_b64, 'base64')
      if (!buf.length) { rel.erros.push({ id: r.id, erro: 'conteúdo vazio' }); continue }

      // grava e CONFERE o tamanho no disco; só devolve o caminho se deu certo
      const destino = gravarNoDisco(r.processo_numero, r.doc_nome, r.id, buf)
      if (!destino) { rel.erros.push({ id: r.id, erro: 'falha ao gravar no disco' }); continue }

      const up = await sb.from('jusbr_arquivos')
        .update({ caminho_disco: destino, conteudo_b64: null, tamanho: buf.length })
        .eq('id', r.id)
      if (up.error) { rel.erros.push({ id: r.id, erro: 'banco: ' + up.error.message }); continue }

      rel.processados++
      rel.bytes_liberados += b64len
    } catch (e) {
      rel.erros.push({ id: r.id, erro: String((e && e.message) || e) })
    }
  }

  rel.restam = Math.max(0, (faltam || 0) - rel.processados)
  rel.fim = rel.restam === 0
  rel.liberado_mb = +(rel.bytes_liberados / 1048576).toFixed(1)

  // A FAXINA que faltava: o cache tem validade (expira_em), mas nunca existiu
  // rotina para apagar o vencido — foi assim que a tabela chegou a 1,3 GB. Só o
  // arquivo no disco é removido; a linha some junto, e o documento continua
  // rebaixável do jus.br quando alguém precisar de novo. Os "docs leves"
  // (inicial, procuração) têm expira_em em 2999 e nunca entram aqui.
  try {
    const { data: velhos } = await sb.from('jusbr_arquivos')
      .select('id,caminho_disco').eq('escritorio_id', ESCRITORIO_CMP)
      .lt('expira_em', new Date().toISOString()).limit(200)
    if (velhos && velhos.length) {
      for (const v of velhos) { if (v.caminho_disco) { try { fs.unlinkSync(v.caminho_disco) } catch (e) {} } }
      await sb.from('jusbr_arquivos').delete().in('id', velhos.map(v => v.id))
      rel.vencidos_apagados = velhos.length
    }
  } catch (e) { rel.erro_faxina = String((e && e.message) || e) }

  return Response.json(rel)
}
