// Busca no Diário de Justiça — sob demanda, pelo escritório.
//
// O robô do DJEN roda sozinho de duas em duas horas e só enxerga o que sai nas
// OAB cadastradas. Falta o outro caso, que é o do dia a dia: o advogado quer
// procurar AGORA — o nome de uma parte, um processo que ainda não está
// cadastrado, um período maior do que a janela do robô, ou a OAB de um colega
// que acabou de entrar no escritório. Sem isso ele volta ao site do CNJ, e a
// pergunta "o sistema não faz isso?" tem resposta ruim.
//
//   GET  /api/diarios?...   -> procura e devolve o que achou (NÃO grava)
//        alvo=oab    &numero=16593&uf=PB
//        alvo=nome   &nome=Fulano de Tal
//        alvo=processo&numero=0801234-55.2024.8.15.0001
//        dias=30 (1 a 180)
//   POST /api/diarios  { itens: [...] }  -> leva os escolhidos para as fichas
//
// Duas coisas de propósito:
//   - a busca NÃO grava. O que o DJEN devolve por nome traz homônimo e processo
//     de terceiro; jogar isso direto no acervo sujaria fichas alheias. O
//     advogado vê, escolhe, e só então entra.
//   - o que entra, entra pelo escritório de quem pediu (robot_add_andamento_esc).
//     Número de processo se repete entre tribunais.
//
// Sobre CPF/CNPJ: o DJEN/Comunica do CNJ não aceita — só nome da parte. Está
// dito na tela para ninguém procurar em vão.

import { createClient } from '@supabase/supabase-js'
import { usuarioDoRequest, escritorioDoUsuario, semEscritorio } from '../_lib/inquilino.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const DJEN = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao'
const UA = 'Mozilla/5.0 (compatible; Gestao/1.0)'
const iso = (d) => d.toISOString().slice(0, 10)

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
// "a API do CNJ está fora" e "não há publicação" precisam parecer coisas
// diferentes na tela, senão o advogado conclui que o diário está limpo.
async function consulta(params, falhas) {
  let itens = [], pagina = 1
  while (pagina <= 10) {
    const url = DJEN + '?' + params + '&meio=D&pagina=' + pagina + '&itensPorPagina=100'
    let r
    try { r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA }, signal: AbortSignal.timeout(25000) }) }
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

function limpo(p) {
  const texto = String(p.texto || p.teor || '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/[ \t]+\n/g, '\n').trim()
  return {
    numero: String(p.numeroProcesso || p.numero_processo || ''),
    digitos: String(p.numeroProcesso || p.numero_processo || '').replace(/\D/g, ''),
    data: String(p.dataDisponibilizacao || p.data_disponibilizacao || '').slice(0, 10) || null,
    tribunal: p.siglaTribunal || p.tribunal || '',
    orgao: p.nomeOrgao || p.orgao || '',
    tipo: p.tipoComunicacao || p.tipoDocumento || '',
    texto,
  }
}

export async function GET(request) {
  const q = await quem(request)
  if (q.semEsc) return semEscritorio()
  if (q.erro) return Response.json({ erro: q.erro }, { status: q.status })
  const { sb, esc } = q

  const { searchParams } = new URL(request.url)
  const alvo = String(searchParams.get('alvo') || 'oab')
  let dias = parseInt(searchParams.get('dias') || '15', 10) || 15
  dias = Math.min(Math.max(dias, 1), 180)
  const fim = new Date(), ini = new Date(Date.now() - dias * 86400000)
  const janela = 'dataDisponibilizacaoInicio=' + iso(ini) + '&dataDisponibilizacaoFim=' + iso(fim)

  const falhas = []
  let brutos = [], descricao = ''

  if (alvo === 'processo') {
    const dig = String(searchParams.get('numero') || '').replace(/\D/g, '')
    if (dig.length < 16) return Response.json({ erro: 'Informe o número completo do processo.' }, { status: 400 })
    brutos = await consulta('numeroProcesso=' + dig, falhas)
    descricao = 'processo ' + dig
  } else if (alvo === 'nome') {
    const nome = String(searchParams.get('nome') || '').trim()
    if (nome.length < 5) return Response.json({ erro: 'Informe o nome completo da parte (mínimo 5 letras). O CNJ não aceita busca por CPF/CNPJ.' }, { status: 400 })
    brutos = await consulta('nomeParte=' + encodeURIComponent(nome) + '&' + janela, falhas)
    descricao = 'nome "' + nome + '"'
  } else {
    // OAB: a informada, ou todas as do cadastro do escritório
    let oabs = []
    const num = String(searchParams.get('numero') || '').replace(/\D/g, '')
    const uf = String(searchParams.get('uf') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2)
    if (num && uf.length === 2) oabs = [{ numero: num, uf }]
    else {
      const { data } = await sb.from('escritorios').select('oabs').eq('id', esc).maybeSingle()
      oabs = Array.isArray(data?.oabs) ? data.oabs : []
    }
    if (!oabs.length) {
      return Response.json({
        erro: 'Nenhuma OAB cadastrada no escritório. Cadastre em ⚙ → Inscrições na OAB, ou informe uma OAB aqui na busca.',
      }, { status: 400 })
    }
    for (const o of oabs) {
      const it = await consulta('numeroOab=' + String(o.numero).replace(/\D/g, '') + '&ufOab=' + o.uf + '&' + janela, falhas)
      brutos = brutos.concat(it)
    }
    descricao = oabs.map(o => 'OAB ' + o.numero + '/' + o.uf).join(', ')
  }

  // sem duplicata: a mesma publicação sai em mais de uma OAB do mesmo escritório
  const vistos = new Set()
  const itens = []
  for (const b of brutos) {
    const p = limpo(b)
    const chave = p.digitos + '|' + (p.data || '') + '|' + p.texto.slice(0, 120)
    if (vistos.has(chave)) continue
    vistos.add(chave)
    itens.push(p)
  }
  itens.sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')))

  // quais já estão no acervo DESTE escritório — o que muda é o rótulo na tela:
  // "já está na ficha", "processo cadastrado, publicação nova", "não é seu"
  const digs = [...new Set(itens.map(i => i.digitos).filter(d => d.length >= 16))]
  const meus = new Set()
  for (let i = 0; i < digs.length; i += 300) {
    const { data } = await sb.from('processos').select('numero_digitos')
      .eq('escritorio_id', esc).in('numero_digitos', digs.slice(i, i + 300))
    for (const r of (data || [])) meus.add(r.numero_digitos)
  }

  return Response.json({
    ok: falhas.length === 0,
    busca: descricao, dias,
    total: itens.length,
    cadastrados: itens.filter(i => meus.has(i.digitos)).length,
    itens: itens.slice(0, 300).map(i => ({ ...i, meu: meus.has(i.digitos) })),
    falhas: falhas.slice(0, 5),
    ...(falhas.length && !itens.length
      ? { alerta: 'A consulta ao CNJ falhou — isto NÃO quer dizer que não houve publicação. Tente de novo em alguns minutos.' }
      : {}),
  })
}

// Leva para as fichas só o que o advogado marcou.
export async function POST(request) {
  const q = await quem(request)
  if (q.semEsc) return semEscritorio()
  if (q.erro) return Response.json({ erro: q.erro }, { status: q.status })
  const { sb, esc } = q

  let body = {}
  try { body = await request.json() } catch (e) {}
  const itens = Array.isArray(body.itens) ? body.itens.slice(0, 500) : []
  if (!itens.length) return Response.json({ erro: 'Nada marcado.' }, { status: 400 })

  let novos = 0, jaTinha = 0, semProcesso = 0, erros = 0
  for (const it of itens) {
    const dig = String(it.digitos || it.numero || '').replace(/\D/g, '')
    const texto = String(it.texto || '').trim()
    if (dig.length < 16 || !texto) { semProcesso++; continue }
    const { data: res, error } = await sb.rpc('robot_add_andamento_esc', {
      p_esc: esc, p_num: dig,
      p_data: it.data ? String(it.data).slice(0, 10) : null,
      p_texto: texto, p_fonte: 'djen', p_tipo: 'publicacao',
    })
    if (error) { erros++; continue }
    if (res === 'inserido') novos++
    else if (res === 'existe') jaTinha++
    else semProcesso++
  }
  return Response.json({ ok: true, novos, jaTinha, semProcesso, erros })
}
