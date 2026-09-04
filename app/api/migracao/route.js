// Migração de acervo: a planilha do sistema antigo vira fichas aqui dentro.
//
// É a porta de entrada de quem já usa outro sistema. Sem ela, contratar
// significa redigitar mil processos — e ninguém troca de sistema por isso.
//
// O desenho todo gira em torno de uma coisa: o advogado precisa poder errar.
// Ele vai subir uma planilha que nunca conferiu coluna por coluna, exportada de
// um sistema que não é dele. Então:
//
//   1. ANALISAR  — lê o arquivo, mostra as colunas e CHUTA o destino de cada
//                  uma. O chute aparece como chute, para ser corrigido.
//   2. CONFERIR  — com o mapa já corrigido, diz exatamente o que vai acontecer:
//                  quantos entram, quantos já existem, o que fica de fora e por
//                  quê. Não grava nada.
//   3. IMPORTAR  — grava, e guarda a lista do que ESTA importação criou.
//   4. DESFAZER  — apaga só isso, e só o que ninguém tocou depois.
//
// Duas regras que valem mais que a comodidade:
//   - nunca sobrescrever dado que a equipe digitou. O padrão para processo que
//     já existe é COMPLETAR o que está vazio; sobrescrever é escolha explícita.
//   - linha sem número de processo não entra calada. Sai na lista de recusadas,
//     com o motivo, porque o acervo que "sumiu" na migração é o que destrói a
//     confiança no sistema novo.

import { createClient } from '@supabase/supabase-js'
import { usuarioDoRequest, escritorioDoUsuario, semEscritorio } from '../_lib/inquilino.js'
import {
  CAMPOS, lerPlanilha, sugerirMapa, normalizar, soDigitos, converter, textoCurto,
} from '../_lib/planilha.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_BYTES = 20 * 1024 * 1024
const MAX_LINHAS = 20000
const AMOSTRA = 8        // linhas mostradas na conferência da leitura
const PREVIA = 25        // linhas mostradas já convertidas

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })
}

// Migrar acervo é ato de quem responde pelo escritório, não de estagiário: uma
// planilha errada mexe em todas as fichas de uma vez.
async function quemPode(request) {
  const user = await usuarioDoRequest(request)
  if (!user) return { erro: 'não autenticado', status: 401 }
  const esc = await escritorioDoUsuario(user.id)
  if (!esc) return { semEsc: true }
  const sb = admin()
  const { data: perfil } = await sb.from('usuarios').select('papel,nome').eq('id', user.id).maybeSingle()
  // mesmos papéis que mandam no escritório (ver PAPEIS_QUE_MANDAM em /api/acessos)
  const papel = String(perfil?.papel || '')
  if (!['contratante', 'socio'].includes(papel)) {
    return { erro: 'A migração do acervo é feita pelo contratante ou por um sócio do escritório.', status: 403 }
  }
  return { user, esc, sb, nome: perfil?.nome || user.email || '' }
}

// ---------------------------------------------------------------------------
// GET: o que a tela precisa saber antes de qualquer arquivo — os campos que
// existem, o histórico do que já foi migrado e quanto ainda cabe no plano.
export async function GET(request) {
  const q = await quemPode(request)
  if (q.semEsc) return semEscritorio()
  if (q.erro) return Response.json({ erro: q.erro }, { status: q.status })
  const { sb, esc } = q

  const { data: hist } = await sb.from('migracoes')
    .select('id,arquivo,criado_em,criado_por_nome,linhas,criados,atualizados,ignorados,desfeita_em,desfeitos,lote_id')
    .eq('escritorio_id', esc).order('criado_em', { ascending: false }).limit(20)

  const { data: e } = await sb.from('escritorios').select('limite_processos').eq('id', esc).maybeSingle()
  const { count } = await sb.from('processos').select('id', { count: 'exact', head: true }).eq('escritorio_id', esc)

  return Response.json({
    ok: true,
    campos: CAMPOS.map(c => ({ chave: c.chave, rotulo: c.rotulo, obrigatorio: !!c.obrigatorio, tipo: c.tipo || 'texto' })),
    historico: hist || [],
    plano: { limite_processos: e?.limite_processos ?? null, usados: count || 0 },
  })
}

// ---------------------------------------------------------------------------
export async function POST(request) {
  const q = await quemPode(request)
  if (q.semEsc) return semEscritorio()
  if (q.erro) return Response.json({ erro: q.erro }, { status: q.status })

  const tipo = String(request.headers.get('content-type') || '')
  if (tipo.includes('application/json')) {
    let body = {}
    try { body = await request.json() } catch (e) {}
    if (body.acao === 'desfazer') return desfazer(q, body)
    return Response.json({ erro: 'ação desconhecida' }, { status: 400 })
  }

  let form
  try { form = await request.formData() } catch (e) {
    return Response.json({ erro: 'Não consegui ler o arquivo enviado.' }, { status: 400 })
  }
  const arquivo = form.get('arquivo')
  if (!arquivo || typeof arquivo.arrayBuffer !== 'function') {
    return Response.json({ erro: 'Escolha o arquivo da planilha.' }, { status: 400 })
  }
  const nome = String(arquivo.name || 'planilha')
  if (!/\.(csv|txt|xlsx|xlsm)$/i.test(nome)) {
    return Response.json({ erro: 'Envie a planilha em CSV ou XLSX. Se o arquivo for XLS antigo, abra no Excel e salve como XLSX.' }, { status: 400 })
  }
  const buf = Buffer.from(await arquivo.arrayBuffer())
  if (buf.length > MAX_BYTES) {
    return Response.json({ erro: 'O arquivo passa de 20 MB. Divida a planilha em partes e importe uma de cada vez.' }, { status: 400 })
  }

  let planilha
  try { planilha = await lerPlanilha(buf, nome) } catch (e) {
    return Response.json({ erro: 'Não consegui abrir a planilha: ' + String((e && e.message) || e) }, { status: 400 })
  }
  if (!planilha.colunas.length || !planilha.linhas.length) {
    return Response.json({ erro: 'A planilha veio sem cabeçalho ou sem linhas.' }, { status: 400 })
  }
  if (planilha.linhas.length > MAX_LINHAS) {
    return Response.json({ erro: 'A planilha tem ' + planilha.linhas.length + ' linhas; o limite por importação é ' + MAX_LINHAS + '. Divida em partes.' }, { status: 400 })
  }

  const acao = String(form.get('acao') || 'analisar')

  if (acao === 'analisar') {
    return Response.json({
      ok: true,
      arquivo: nome,
      colunas: planilha.colunas,
      total: planilha.linhas.length,
      mapa: sugerirMapa(planilha.colunas),
      amostra: planilha.linhas.slice(0, AMOSTRA).map(l => l.map(c => textoCurto(c))),
    })
  }

  let mapa = {}
  try { mapa = JSON.parse(String(form.get('mapa') || '{}')) } catch (e) {}
  let opcoes = {}
  try { opcoes = JSON.parse(String(form.get('opcoes') || '{}')) } catch (e) {}

  const temNumero = Object.values(mapa).includes('numero')
  if (!temNumero) {
    return Response.json({ erro: 'Aponte qual coluna tem o número do processo. Sem ela não há como identificar a ficha.' }, { status: 400 })
  }

  if (acao === 'conferir') return conferir(q, planilha, mapa, nome)
  if (acao === 'importar') return importar(q, planilha, mapa, opcoes, nome)
  return Response.json({ erro: 'ação desconhecida' }, { status: 400 })
}


// ---------------------------------------------------------------------------
// CONFERIR: o passo em que o advogado vê o que vai acontecer antes de acontecer.
async function conferir(q, planilha, mapa, nome) {
  const { sb, esc } = q
  const { bons, recusadas } = converter(planilha, mapa)

  const existentes = await digitosExistentes(sb, esc, bons.map(b => b.p.numero_digitos))
  let novos = 0, jaExistem = 0
  for (const b of bons) { if (existentes.has(b.p.numero_digitos)) jaExistem++; else novos++ }

  const { data: e } = await sb.from('escritorios').select('limite_processos').eq('id', esc).maybeSingle()
  const { count } = await sb.from('processos').select('id', { count: 'exact', head: true }).eq('escritorio_id', esc)
  const limite = e?.limite_processos ?? null
  const cabe = limite === null ? true : (count || 0) + novos <= limite

  return Response.json({
    ok: true,
    arquivo: nome,
    total: planilha.linhas.length,
    novos, ja_existem: jaExistem,
    recusadas: recusadas.slice(0, 200),
    recusadas_total: recusadas.length,
    previa: bons.slice(0, PREVIA).map(b => ({ linha: b.linha, ...b.p, _cliente: b.contato })),
    plano: { limite_processos: limite, usados: count || 0, cabe },
    // um contato só é criado se houver com o que preencher além do nome
    contatos_possiveis: bons.filter(b => b.contato.nome && (b.contato.cpf_cnpj || b.contato.email || b.contato.telefone)).length,
  })
}

// consulta em blocos: `in` com 10 mil itens estoura a linha da requisição
async function digitosExistentes(sb, esc, digs) {
  const achados = new Set()
  for (let i = 0; i < digs.length; i += 400) {
    const bloco = digs.slice(i, i + 400)
    const { data } = await sb.from('processos').select('numero_digitos')
      .eq('escritorio_id', esc).in('numero_digitos', bloco)
    for (const r of (data || [])) achados.add(r.numero_digitos)
  }
  return achados
}

// ---------------------------------------------------------------------------
async function importar(q, planilha, mapa, opcoes, nome) {
  const { sb, esc, user } = q
  const { bons, recusadas } = converter(planilha, mapa)
  const repetidos = ['completar', 'pular', 'substituir'].includes(opcoes.repetidos) ? opcoes.repetidos : 'completar'

  const existentes = await digitosExistentes(sb, esc, bons.map(b => b.p.numero_digitos))
  const paraCriar = bons.filter(b => !existentes.has(b.p.numero_digitos))
  const paraTocar = bons.filter(b => existentes.has(b.p.numero_digitos))

  // O limite do plano é conferido ANTES de escrever a primeira linha: parar no
  // meio deixaria o acervo pela metade, que é o pior dos dois mundos.
  const { data: e } = await sb.from('escritorios').select('limite_processos').eq('id', esc).maybeSingle()
  const { count } = await sb.from('processos').select('id', { count: 'exact', head: true }).eq('escritorio_id', esc)
  const limite = e?.limite_processos ?? null
  if (limite !== null && (count || 0) + paraCriar.length > limite) {
    return Response.json({
      erro: 'O plano permite ' + limite + ' processos e o escritório já tem ' + (count || 0) + '. ' +
            'Esta planilha traria mais ' + paraCriar.length + '. Nada foi importado.',
      limite_estourado: true,
    }, { status: 400 })
  }

  // Lote da migração: dá ao acervo migrado um lugar próprio no menu, separado do
  // que for cadastrado daqui pra frente. Também é o que torna simples achar
  // tudo depois — inclusive para conferir por amostragem.
  let loteId = null
  const nomeLote = String(opcoes.lote || '').trim().slice(0, 80)
  if (nomeLote) {
    const { data: ja } = await sb.from('lotes').select('id').eq('escritorio_id', esc).eq('nome', nomeLote).maybeSingle()
    if (ja) loteId = ja.id
    else {
      const { data: ult } = await sb.from('lotes').select('ordem')
        .eq('escritorio_id', esc).order('ordem', { ascending: false }).limit(1).maybeSingle()
      const { data: criado } = await sb.from('lotes')
        .insert({ escritorio_id: esc, nome: nomeLote, ordem: (ult?.ordem || 0) + 1 })
        .select('id').maybeSingle()
      loteId = criado?.id || null
    }
  }

  const contatos = await resolverContatos(sb, esc, bons, opcoes)

  // ---- criar ---------------------------------------------------------------
  const criadosIds = []
  const erros = []
  // Todas as linhas do bloco precisam ter EXATAMENTE as mesmas colunas: o
  // PostgREST recusa um insert em lote com chaves diferentes entre os objetos, e
  // planilha real tem célula vazia em umas linhas e preenchida em outras. Daí a
  // união das chaves, com null no que faltar.
  const colunasUsadas = new Set()
  for (const b of paraCriar) for (const k of Object.keys(b.p)) colunasUsadas.add(k)
  const linhaCheia = (b) => {
    const r = { escritorio_id: esc, fonte: 'migracao', lote_id: loteId,
                cliente_id: contatos.get(chaveContato(b.contato)) || null }
    for (const k of colunasUsadas) r[k] = b.p[k] === undefined ? null : b.p[k]
    // status vazio na planilha não pode virar ficha sem situação nenhuma
    if (!r.status) r.status = 'ativo'
    return r
  }
  for (let i = 0; i < paraCriar.length; i += 300) {
    const bloco = paraCriar.slice(i, i + 300).map(linhaCheia)
    const { data, error } = await sb.from('processos').insert(bloco).select('id')
    if (error) { erros.push(error.message); continue }
    for (const r of (data || [])) criadosIds.push(r.id)
  }

  // ---- já existentes -------------------------------------------------------
  let atualizados = 0
  if (repetidos !== 'pular' && paraTocar.length) {
    const digs = paraTocar.map(b => b.p.numero_digitos)
    const atuais = new Map()
    for (let i = 0; i < digs.length; i += 400) {
      const { data } = await sb.from('processos').select('*')
        .eq('escritorio_id', esc).in('numero_digitos', digs.slice(i, i + 400))
      for (const r of (data || [])) atuais.set(r.numero_digitos, r)
    }
    for (const b of paraTocar) {
      const atual = atuais.get(b.p.numero_digitos)
      if (!atual) continue
      const patch = {}
      for (const [k, v] of Object.entries(b.p)) {
        if (k === 'numero' || k === 'numero_digitos') continue
        // "completar" só preenche buraco; "substituir" manda o que veio na
        // planilha. Em nenhum dos dois um campo vazio da planilha apaga o que
        // já estava escrito na ficha.
        if (repetidos === 'completar' && atual[k] !== null && atual[k] !== undefined && atual[k] !== '') continue
        patch[k] = v
      }
      if (loteId && !atual.lote_id) patch.lote_id = loteId
      const cid = contatos.get(chaveContato(b.contato))
      if (cid && !atual.cliente_id) patch.cliente_id = cid
      if (!Object.keys(patch).length) continue
      const { error } = await sb.from('processos').update(patch).eq('id', atual.id)
      if (error) erros.push(error.message); else atualizados++
    }
  }

  const { data: reg } = await sb.from('migracoes').insert({
    escritorio_id: esc,
    criado_por: user.id,
    criado_por_nome: q.nome,
    arquivo: nome,
    mapa,
    lote_id: loteId,
    linhas: planilha.linhas.length,
    criados: criadosIds.length,
    atualizados,
    ignorados: repetidos === 'pular' ? paraTocar.length : Math.max(0, paraTocar.length - atualizados),
    recusadas: recusadas.slice(0, 500),
    processos_ids: criadosIds,
  }).select('id').maybeSingle()

  return Response.json({
    ok: true,
    migracao_id: reg?.id || null,
    criados: criadosIds.length,
    atualizados,
    ja_existiam: paraTocar.length,
    recusadas: recusadas.slice(0, 200),
    recusadas_total: recusadas.length,
    contatos: contatos.size,
    lote: nomeLote || null,
    erros: erros.slice(0, 10),
  })
}

function chaveContato(c) {
  if (!c || !c.nome) return ''
  return c.cpf_cnpj ? ('d:' + c.cpf_cnpj) : ('n:' + normalizar(c.nome))
}

// Cliente da planilha vira contato — mas sem duplicar quem já está cadastrado.
// Casa por CPF/CNPJ quando existe (é o que identifica de verdade) e por nome
// quando não existe. Nome é palpite, então nunca sobrescreve: só completa.
async function resolverContatos(sb, esc, bons, opcoes) {
  const mapa = new Map()
  const querContatos = opcoes.contatos !== false
  const candidatos = bons.filter(b => b.contato.nome)
  if (!querContatos || !candidatos.length) return mapa

  const { data: jaTem } = await sb.from('contatos').select('id,nome,cpf_cnpj,email,telefone').eq('escritorio_id', esc)
  const porDoc = new Map(), porNome = new Map()
  for (const c of (jaTem || [])) {
    const d = soDigitos(c.cpf_cnpj)
    if (d) porDoc.set(d, c)
    const n = normalizar(c.nome)
    if (n && !porNome.has(n)) porNome.set(n, c)
  }

  const novos = []
  const vistos = new Set()
  for (const b of candidatos) {
    const k = chaveContato(b.contato)
    if (!k || mapa.has(k) || vistos.has(k)) continue
    const achado = (b.contato.cpf_cnpj && porDoc.get(b.contato.cpf_cnpj)) || porNome.get(normalizar(b.contato.nome))
    if (achado) {
      mapa.set(k, achado.id)
      const patch = {}
      if (!achado.cpf_cnpj && b.contato.cpf_cnpj) patch.cpf_cnpj = b.contato.cpf_cnpj
      if (!achado.email && b.contato.email) patch.email = b.contato.email
      if (!achado.telefone && b.contato.telefone) patch.telefone = b.contato.telefone
      if (Object.keys(patch).length) await sb.from('contatos').update(patch).eq('id', achado.id)
      continue
    }
    vistos.add(k)
    novos.push({
      chave: k,
      row: {
        escritorio_id: esc, nome: b.contato.nome, tipo: 'cliente',
        cpf_cnpj: b.contato.cpf_cnpj, email: b.contato.email, telefone: b.contato.telefone,
      },
    })
  }

  for (let i = 0; i < novos.length; i += 300) {
    const bloco = novos.slice(i, i + 300)
    const { data, error } = await sb.from('contatos').insert(bloco.map(n => n.row)).select('id')
    if (error || !data) continue
    data.forEach((r, j) => { if (bloco[j]) mapa.set(bloco[j].chave, r.id) })
  }
  return mapa
}

// ---------------------------------------------------------------------------
// DESFAZER: a saída de emergência.
//
// Só apaga ficha que ESTA importação criou, que continua marcada como vinda da
// migração e em que ninguém escreveu depois (nenhum andamento). Ficha que a
// equipe já trabalhou fica — e o resultado diz quantas ficaram, para não haver
// a impressão de que desfez tudo quando não desfez.
async function desfazer(q, body) {
  const { sb, esc } = q
  const id = String(body.id || '')
  if (!id) return Response.json({ erro: 'informe a migração' }, { status: 400 })

  const { data: m } = await sb.from('migracoes').select('*').eq('id', id).eq('escritorio_id', esc).maybeSingle()
  if (!m) return Response.json({ erro: 'migração não encontrada' }, { status: 404 })
  if (m.desfeita_em) return Response.json({ erro: 'Esta migração já foi desfeita.' }, { status: 400 })

  const ids = m.processos_ids || []
  if (!ids.length) {
    await sb.from('migracoes').update({ desfeita_em: new Date().toISOString(), desfeitos: 0 }).eq('id', id)
    return Response.json({ ok: true, apagados: 0, mantidos: 0 })
  }

  let apagados = 0, mantidos = 0
  for (let i = 0; i < ids.length; i += 200) {
    const bloco = ids.slice(i, i + 200)
    // quais destes ainda estão intocados
    const { data: comAnd } = await sb.from('andamentos').select('processo_id').in('processo_id', bloco)
    const tocados = new Set((comAnd || []).map(r => r.processo_id))
    const limpos = bloco.filter(x => !tocados.has(x))
    mantidos += bloco.length - limpos.length
    if (!limpos.length) continue
    const { data, error } = await sb.from('processos').delete()
      .eq('escritorio_id', esc).eq('fonte', 'migracao').in('id', limpos).select('id')
    if (error) return Response.json({ erro: 'Parei no meio: ' + error.message + ' (apagados até aqui: ' + apagados + ')' }, { status: 500 })
    apagados += (data || []).length
    mantidos += limpos.length - (data || []).length
  }

  await sb.from('migracoes').update({ desfeita_em: new Date().toISOString(), desfeitos: apagados }).eq('id', id)
  return Response.json({ ok: true, apagados, mantidos })
}
