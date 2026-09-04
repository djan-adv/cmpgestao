// Cadastrar processos EM LOTE, a partir da OAB.
//
// O caminho de hoje é um a um: o advogado abre o processo no tribunal, copia o
// número, cola em "Cadastrar por número" e digita as partes na ficha. Para quem
// está chegando com o acervo inteiro para cadastrar, isso é o que trava a
// adoção do sistema — e é justamente o que o Diário de Justiça já sabe
// responder: quem publicou naquela OAB, em qual processo, e quem são as partes.
//
//   GET  /api/cadastro-oab?numero=16593&uf=PB&dias=90   -> a lista (NÃO grava)
//   POST /api/cadastro-oab { itens:[{numero, ativo, passivo}] }  -> grava os marcados
//
// Duas regras que valem a pena estarem escritas:
//   - a busca NÃO grava nada. A lista fica na tela; entra no acervo só o que o
//     advogado marcar. É a mesma regra da tela de Diários, pelo mesmo motivo: a
//     OAB traz processo de colega, de escritório anterior e de caso já encerrado.
//   - as partes são SUGESTÃO. O DJEN marca cada destinatário com o polo (A ou
//     P); pegamos o nome que mais aparece de cada lado. Em processo com vários
//     autores ou vários réus, vem um de cada — o resto é completado na ficha, e
//     a tela deixa inverter os polos antes de gravar.
//
// O limite de processos do plano é conferido ANTES de escrever a primeira
// linha: parar no meio de um lote deixaria o acervo pela metade sem aviso.

import { createClient } from '@supabase/supabase-js'
import { usuarioDoRequest, escritorioDoUsuario, semEscritorio } from '../_lib/inquilino.js'
import { consultaDataJud } from '../processo/route.js'
import { fraseTeto } from '../_lib/planos.js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 300

const DJEN = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao'
const UA = 'Mozilla/5.0 (compatible; Gestao/1.0)'
const iso = (d) => d.toISOString().slice(0, 10)
const soDig = (s) => String(s || '').replace(/\D/g, '')
const MAX_LOTE = 25          // por requisição; a tela manda em fatias e mostra o andamento

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })
}

async function quem(request) {
  const user = await usuarioDoRequest(request)
  if (!user) return { erro: 'não autenticado', status: 401 }
  const esc = await escritorioDoUsuario(user.id)
  if (!esc) return { semEsc: true }
  return { user, esc, sb: admin() }
}

// Uma consulta ao Comunica, paginada. Falha de rede é DEVOLVIDA, nunca engolida:
// "a API do CNJ está fora" e "não há publicação" não podem parecer a mesma coisa.
async function consulta(params, falhas) {
  let itens = [], pagina = 1
  while (pagina <= 20) {
    const url = DJEN + '?' + params + '&meio=D&pagina=' + pagina + '&itensPorPagina=100'
    let r
    try { r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA }, cache: 'no-store', signal: AbortSignal.timeout(25000) }) }
    catch (e) { falhas.push(String((e && e.message) || e)); break }
    if (!r.ok) { falhas.push('CNJ respondeu ' + r.status); break }
    let d
    try { d = await r.json() } catch (e) { falhas.push('resposta do CNJ não era JSON'); break }
    const lote = d.items || d.content || d.comunicacoes || []
    if (!lote.length) break
    itens = itens.concat(lote)
    if (lote.length < 100) break
    pagina++
  }
  return itens
}

const maisFrequente = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(e => e[0])[0] || ''

/* O TEOR só existe no Diário.
   O DataJud entrega o TÍTULO do movimento ("Conclusos para despacho", 27
   caracteres) e o jus.br entrega o mesmo título; nenhum dos dois traz o texto
   da decisão. Quem publica o inteiro teor é o DJEN. Por isso, ao cadastrar,
   além do histórico do DataJud, buscamos as comunicações DO PROCESSO no
   Comunica e gravamos o texto inteiro: sem isto o processo entra no acervo com
   176 andamentos e "Com teor (0)", que foi exatamente o que apareceu na tela.
   Volta quantas publicações entraram. Nunca lança: o processo já está
   cadastrado, e ficar sem o teor é menos ruim do que perder o cadastro. */
async function trazerTeorDoProcesso(sb, esc, numeroDigitos) {
  const dig = soDig(numeroDigitos)
  if (dig.length < 16) return { novas: 0 }
  let brutos = []
  try {
    for (let pagina = 1; pagina <= 5; pagina++) {
      const url = DJEN + '?numeroProcesso=' + dig + '&pagina=' + pagina + '&itensPorPagina=100'
      const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA }, cache: 'no-store', signal: AbortSignal.timeout(25000) })
      if (!r.ok) break
      const d = await r.json().catch(() => null)
      const lote = (d && (d.items || d.content || d.comunicacoes)) || []
      if (!lote.length) break
      brutos = brutos.concat(lote)
      if (lote.length < 100) break
    }
  } catch (e) { return { novas: 0, erro: String((e && e.message) || e) } }

  // a mesma publicação sai em mais de uma OAB do escritório: entra uma vez só
  const vistos = new Set()
  let novas = 0
  for (const b of brutos) {
    const texto = String(b.texto || b.teor || '')
      .replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/[ \t]+\n/g, '\n').trim()
    if (!texto) continue
    const data = String(b.dataDisponibilizacao || b.data_disponibilizacao || '').slice(0, 10) || null
    const chave = (data || '') + '|' + texto.slice(0, 120)
    if (vistos.has(chave)) continue
    vistos.add(chave)
    try {
      const { data: res } = await sb.rpc('robot_add_andamento_esc', {
        p_esc: esc, p_num: dig, p_data: data, p_texto: texto, p_fonte: 'djen', p_tipo: 'publicacao',
      })
      if (res === 'inserido') novas++
    } catch (e) {}
  }
  return { novas }
}

export async function GET(request) {
  const q = await quem(request)
  if (q.semEsc) return semEscritorio()
  if (q.erro) return Response.json({ erro: q.erro }, { status: q.status })
  const { sb, esc } = q

  const { searchParams } = new URL(request.url)
  let dias = parseInt(searchParams.get('dias') || '90', 10) || 90
  dias = Math.min(Math.max(dias, 7), 365)
  const janela = 'dataDisponibilizacaoInicio=' + iso(new Date(Date.now() - dias * 86400000)) +
    '&dataDisponibilizacaoFim=' + iso(new Date())

  // a OAB escolhida, ou todas as do cadastro do escritório
  let oabs = []
  const num = soDig(searchParams.get('numero'))
  const uf = String(searchParams.get('uf') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2)
  if (num && uf.length === 2) oabs = [{ numero: num, uf }]
  else {
    const { data } = await sb.from('escritorios').select('oabs').eq('id', esc).maybeSingle()
    oabs = Array.isArray(data && data.oabs) ? data.oabs : []
  }
  if (!oabs.length) {
    return Response.json({ erro: 'Nenhuma inscrição na OAB cadastrada. Cadastre em ⚙ → Inscrições na OAB, ou informe uma aqui na busca.' }, { status: 400 })
  }

  const falhas = []
  const porProc = {}
  for (const o of oabs) {
    const brutos = await consulta('numeroOab=' + soDig(o.numero) + '&ufOab=' + o.uf + '&' + janela, falhas)
    for (const b of brutos) {
      const dig = soDig(b.numeroProcesso || b.numero_processo)
      if (dig.length < 16) continue
      const p = porProc[dig] || (porProc[dig] = {
        numero: String(b.numeroProcesso || b.numero_processo || ''),
        digitos: dig,
        tribunal: b.siglaTribunal || b.tribunal || '',
        orgao: b.nomeOrgao || b.orgao || '',
        data: null, publicacoes: 0, ativo: {}, passivo: {},
      })
      p.publicacoes++
      const d = String(b.dataDisponibilizacao || b.data_disponibilizacao || '').slice(0, 10)
      if (d && (!p.data || d > p.data)) p.data = d
      if (!p.orgao) p.orgao = b.nomeOrgao || b.orgao || ''
      for (const dst of (b.destinatarios || [])) {
        const nm = String(dst.nome || '').trim()
        if (!nm) continue
        if (dst.polo === 'A') p.ativo[nm] = (p.ativo[nm] || 0) + 1
        else if (dst.polo === 'P') p.passivo[nm] = (p.passivo[nm] || 0) + 1
      }
    }
  }

  const lista = Object.values(porProc).map(p => ({
    numero: p.numero, digitos: p.digitos, tribunal: p.tribunal, orgao: p.orgao,
    data: p.data, publicacoes: p.publicacoes,
    ativo: maisFrequente(p.ativo), passivo: maisFrequente(p.passivo),
  })).sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')))

  // quais já estão no acervo DESTE escritório — para travar a caixa e não duplicar
  const digs = lista.map(i => i.digitos)
  const meus = new Set()
  for (let i = 0; i < digs.length; i += 300) {
    const { data } = await sb.from('processos').select('numero_digitos')
      .eq('escritorio_id', esc).in('numero_digitos', digs.slice(i, i + 300))
    for (const r of (data || [])) meus.add(r.numero_digitos)
  }

  // quanto ainda cabe no plano: quem tem 300 processos e plano de 200 precisa
  // saber disso ANTES de marcar cinquenta linhas
  const { data: e } = await sb.from('escritorios').select('limite_processos').eq('id', esc).maybeSingle()
  const { count } = await sb.from('processos').select('id', { count: 'exact', head: true }).eq('escritorio_id', esc)

  // RASTRO DA BUSCA. O campo da OAB aceita qualquer inscrição, inclusive a de
  // outro advogado — o que se obtém com isso é público (o Diário é público), mas
  // sai daqui reunido e pronto para levar. Não dá para impedir sem conferência
  // de identidade de verdade; dá para deixar de ser anônimo. Fica gravado quem
  // pesquisou o quê, e quando.
  try {
    await sb.from('activity_events').insert({
      escritorio_id: esc, user_id: user.id, event_type: 'oab_busca',
      entity_type: 'oab', entity_id: oabs.map(o => o.numero + '/' + o.uf).join(','),
      metadata: { dias, encontrados: lista.length, informada_na_busca: !!(num && uf.length === 2) },
    })
  } catch (er) {}

  return Response.json({
    ok: falhas.length === 0,
    busca: oabs.map(o => 'OAB ' + o.numero + '/' + o.uf).join(', '),
    dias,
    total: lista.length,
    cadastrados: lista.filter(i => meus.has(i.digitos)).length,
    itens: lista.slice(0, 400).map(i => ({ ...i, meu: meus.has(i.digitos) })),
    plano: { limite_processos: (e && e.limite_processos) ?? null, usados: count || 0 },
    falhas: falhas.slice(0, 5),
    ...(falhas.length && !lista.length
      ? { alerta: 'A consulta ao CNJ falhou — isto NÃO quer dizer que não há processo nesta OAB. Tente de novo em alguns minutos.' }
      : {}),
  })
}

export async function POST(request) {
  const q = await quem(request)
  if (q.semEsc) return semEscritorio()
  if (q.erro) return Response.json({ erro: q.erro }, { status: q.status })
  const { sb, esc, user } = q

  let body = {}
  try { body = await request.json() } catch (e) {}

  /* Só o teor, para processo que JÁ está no acervo. Existe porque o acervo que
     entrou antes desta correção ficou com o histórico do DataJud e nenhum texto:
     na ficha, "Com teor (0)". */
  if (String(body.acao || '') === 'teor') {
    const nums = (Array.isArray(body.numeros) ? body.numeros : []).slice(0, MAX_LOTE)
    if (!nums.length) return Response.json({ erro: 'Nenhum processo informado.' }, { status: 400 })
    const feitos = []
    for (const n of nums) {
      const r = await trazerTeorDoProcesso(sb, esc, n)
      feitos.push({ numero: String(n), ok: !r.erro, publicacoes: r.novas || 0, motivo: r.erro || null })
    }
    return Response.json({ ok: true, itens: feitos, publicacoes: feitos.reduce((t, f) => t + (f.publicacoes || 0), 0) })
  }

  const itens = (Array.isArray(body.itens) ? body.itens : []).slice(0, MAX_LOTE)
  if (!itens.length) return Response.json({ erro: 'Nada marcado.' }, { status: 400 })

  // ——— limite do plano, antes de escrever a primeira linha ———
  const { data: e } = await sb.from('escritorios').select('limite_processos,teste_ate').eq('id', esc).maybeSingle()
  const { count } = await sb.from('processos').select('id', { count: 'exact', head: true }).eq('escritorio_id', esc)
  const limite = (e && e.limite_processos) ?? null
  if (limite !== null && (count || 0) + itens.length > limite) {
    return Response.json({
      erro: fraseTeto({ oque: 'processos', limite, usados: count || 0, emTeste: !!(e && e.teste_ate) }) +
        ' Cabem ' + Math.max(0, limite - (count || 0)) + ' agora; esta remessa tem ' + itens.length + '.',
      plano: { limite_processos: limite, usados: count || 0 },
    }, { status: 409 })
  }

  const feitos = []
  for (const it of itens) {
    const dig = soDig(it.numero || it.digitos)
    const numero = String(it.numero || '').trim() || dig
    if (dig.length < 16) { feitos.push({ numero, ok: false, motivo: 'número inválido' }); continue }

    // já cadastrado? não duplica — e não é erro: a lista pode estar velha na tela
    const { data: ja } = await sb.from('processos').select('id').eq('escritorio_id', esc).eq('numero_digitos', dig).maybeSingle()
    if (ja) { feitos.push({ numero, ok: false, motivo: 'já estava cadastrado' }); continue }

    // classe, assunto, órgão e histórico pela base pública do CNJ. Processo
    // recém-distribuído ainda não aparece lá — entra assim mesmo, com o que
    // veio do Diário, porque o que o advogado quer é a ficha existindo.
    // Teto de tempo por processo. O DataJud tenta duas vezes por índice, com 30s
    // cada: um tribunal fora do ar segurava o lote inteiro até o servidor
    // desistir, e a tela ficava parada sem dizer nada. Passando de 45s, o
    // processo entra com o que veio do Diário — a ficha existindo é o que
    // importa, e classe/assunto chegam na primeira atualização.
    let dj = {}
    try {
      dj = await Promise.race([
        consultaDataJud(numero),
        new Promise(res => setTimeout(() => res({ erro: 'a base do CNJ demorou a responder' }), 45000)),
      ])
    } catch (er) { dj = { erro: String((er && er.message) || er) } }
    const ands = Array.isArray(dj.andamentos) ? dj.andamentos : []
    const ultmov = (ands[0] && ands[0].data) ? String(ands[0].data).slice(0, 10) : null

    const linha = {
      escritorio_id: esc,
      numero,
      // numero_digitos é coluna gerada pelo banco a partir do número: mandar
      // valor aqui derruba o insert inteiro
      classe: dj.classe || null,
      assunto: dj.assunto || null,
      orgao: dj.orgao || it.orgao || null,
      cliente_nome: String(it.ativo || '').trim() || null,
      oponente: String(it.passivo || '').trim() || null,
      ultima_movimentacao: ultmov,
      fonte: 'oab',      // de onde veio, para a ficha saber contar a história
    }
    const ins = await sb.from('processos').insert(linha).select('id').single()
    if (ins.error) { feitos.push({ numero, ok: false, motivo: ins.error.message }); continue }

    const pid = ins.data.id
    const rows = ands.filter(a => a && a.texto).map(a => ({
      processo_id: pid, data: a.data ? String(a.data).slice(0, 10) : null, texto: a.texto, fonte: 'datajud',
    }))
    if (rows.length) { try { await sb.from('andamentos').insert(rows) } catch (er) {} }

    // e o teor, que é o que o advogado abre para ler
    const teor = await trazerTeorDoProcesso(sb, esc, dig)
    feitos.push({ numero, ok: true, id: pid, andamentos: rows.length, publicacoes: teor.novas, sem_datajud: !!dj.erro })
  }

  // rastro de quem trouxe o lote (é o mesmo log que a tela de Produtividade lê)
  try {
    await sb.from('activity_events').insert(feitos.filter(f => f.ok).map(f => ({
      escritorio_id: esc, user_id: user.id, event_type: 'case_registered',
      entity_type: 'processo', entity_id: f.numero, metadata: { modo: 'oab' },
    })))
  } catch (er) {}

  return Response.json({
    ok: true,
    cadastrados: feitos.filter(f => f.ok).length,
    pulados: feitos.filter(f => !f.ok).length,
    itens: feitos,
  })
}
