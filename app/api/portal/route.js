// API do Portal do Cliente (app estilo TJ-PB) — o que o CELULAR DO CLIENTE chama.
// O cliente NUNCA fala direto com o Supabase: tudo passa por aqui, com o service
// role no servidor. As tabelas portal_* têm RLS ligada e sem políticas públicas.
//
//   POST /api/portal {acao:'login', email, senha, dispositivo_id, dispositivo_nome}
//        -> { ok, token, nome }  (sessão ÚNICA por pessoa: derruba a anterior)
//        Regra de segurança: no 5º aparelho diferente o acesso é BLOQUEADO.
//   POST {acao:'sair'}                       (Bearer token do portal)
//   POST {acao:'meus'}                       -> cards de processos do cliente
//   POST {acao:'processo', id}               -> ficha completa (detalhes/partes/
//                                               movimentações/documentos/cartório)
//   POST {acao:'chat', processo_id, desde_id}-> mensagens do chat do processo
//   POST {acao:'chat_enviar', processo_id, texto}
//   POST {acao:'push_subscribe', subscription} / {acao:'push_unsubscribe', endpoint}
//   GET  /api/portal?doc=jusbr:<id>|peticao:<id>|comprovante:<id>&t=<token>[&dl=1]
//        -> serve o arquivo (PDF/HTML) para abrir no navegador do cliente
//
// Documentos que o cliente vê: os OFICIAIS já públicos (despachos, decisões,
// sentenças, acórdãos, atas/acordos homologados) + as NOSSAS petições protocoladas.

import webpush from 'web-push'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { tipoRealDoArquivo, pdfDeTexto } from '../jusbr/lib.js'
import { svc, confereSenha, sessao, tokenDo, digitos, processosPermitidos, FILTRO_HIST_CLIENTE } from './lib.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const DOCS_ROOT = '/opt/cmpdocs'
const MAX_APARELHOS = 4         // o 5º aparelho diferente bloqueia o acesso
const SESSAO_DIAS = 60
const MAX_TEXTO_CHAT = 4000
const MAX_ANEXO = 15 * 1024 * 1024   // mesmo teto do chat da equipe

/* ---------- trava simples contra chute de senha (por processo do Node) ---------- */
const _tentativas = new Map()
function podeTentar(chave) {
  const agora = Date.now()
  const t = _tentativas.get(chave) || []
  const rec = t.filter(x => agora - x < 10 * 60000)
  _tentativas.set(chave, rec)
  return rec.length < 10
}
function marcaTentativa(chave) {
  const t = _tentativas.get(chave) || []
  t.push(Date.now()); _tentativas.set(chave, t)
}

/* papéis das partes no modelo do TJ (heurística pela classe) */
function papeisDaClasse(classe, assunto, fase) {
  const t = ((classe || '') + ' ' + (assunto || '') + ' ' + (fase || '')).toLowerCase()
  if (/execu|cumprimento de senten|monit[óo]r/.test(t)) return ['EXEQUENTE', 'EXECUTADO']
  return ['AUTOR(A)', 'RÉU (RÉ)']
}

/* documentos oficiais (já públicos) — filtro sobre as peças do jus.br */
// Confere com o acervo real: pega sentença, despacho, decisão, acórdão, acordo,
// homologação, ata/termo de audiência (onde o acordo é lavrado) e alvará; deixa de
// fora petição de terceiro, intimação, mandado, certidão, ato ordinatório, procuração.
const RE_OFICIAL = /(senten|despach|decis|ac[óo]rd|acordo|homolog|(ata|termo)\s+d[aeo]s?\s+audi|alvar)/i

/* HTML do jus.br → texto corrido, para a conversão em PDF na entrega ao cliente */
function _htmlParaTexto(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#\d+;/g, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

async function docsDoProcesso(sb, p) {
  const chaves = [p.numero, digitos(p.numero)].filter(Boolean)
  const j = await sb.from('jusbr_arquivos')
    .select('id,doc_nome,doc_tipo,tamanho,baixado_em')
    .eq('escritorio_id', p.escritorio_id)
    .in('processo_numero', chaves)
    .order('baixado_em', { ascending: false })
    .limit(400)
  const oficiais = (j.data || [])
    .filter(d => RE_OFICIAL.test((d.doc_tipo || '') + ' ' + (d.doc_nome || '')))
    .map(d => ({ id: d.id, nome: d.doc_nome, tipo: d.doc_tipo, tamanho: d.tamanho, data: d.baixado_em }))

  let qp = sb.from('peticoes_protocolo')
    .select('id,titulo,arquivo_nome,arquivo_caminho,comprovante_caminho,protocolada_em,processo_id,processo_numero')
    .eq('escritorio_id', p.escritorio_id)
    .not('protocolada_em', 'is', null)
    .order('protocolada_em', { ascending: false })
    .limit(200)
  const pr = await qp
  const dig = digitos(p.numero)
  const peticoes = (pr.data || [])
    .filter(x => x.processo_id === p.id || digitos(x.processo_numero) === dig)
    .map(x => ({
      id: x.id, titulo: x.titulo || x.arquivo_nome || 'Petição',
      data: x.protocolada_em, tem_arquivo: !!x.arquivo_caminho, tem_comprovante: !!x.comprovante_caminho,
    }))
  return { oficiais, peticoes }
}

/* Processo VINCULADO (ex.: a ação principal que decide o caso de todos os clientes
   contra a mesma construtora). O cliente acompanha os andamentos e os documentos
   oficiais dele DENTRO do próprio processo, sem entrar na ficha do vinculado — que
   costuma ser de outro titular e tem o chat de outro cliente. É o que mantém o app
   vivo quando o processo do cliente está suspenso esperando essa ação. */
function numerosVinculados(p) {
  const v = Array.isArray(p && p.vinculados) ? p.vinculados : []
  return v.map(n => digitos(n)).filter(d => d.length >= 10).slice(0, 3)
}
async function vinculadosDoProcesso(sb, p) {
  const digs = numerosVinculados(p)
  if (!digs.length) return []
  const { data: vps } = await sb.from('processos')
    .select('id,numero,classe,assunto,foro,orgao,status,escritorio_id')
    .eq('escritorio_id', p.escritorio_id).in('numero_digitos', digs)
  const saida = []
  for (const v of (vps || [])) {
    const { data: ands } = await sb.from('andamentos')
      .select('id,data,texto').eq('processo_id', v.id).or(FILTRO_HIST_CLIENTE)
      .order('data', { ascending: false }).order('id', { ascending: false }).limit(60)
    const docs = await docsDoProcesso(sb, v)
    saida.push({
      numero: v.numero,
      titulo: v.assunto || v.classe || 'Ação judicial',
      foro: v.foro || v.orgao,
      movimentacoes: ands || [],
      // só os documentos oficiais (já públicos); as petições do vinculado são da
      // ficha de outro titular e não entram aqui
      documentos: docs.oficiais,
    })
  }
  return saida
}

/* contato do cartório da vara — melhor esforço a partir do cadastro do escritório */
function normaliza(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ª ]+/g, ' ').replace(/\s+/g, ' ').trim()
}
async function cartorioDaVara(sb, p) {
  const { data } = await sb.from('contatos_orgao')
    .select('orgao,comarca,tribunal,email,whatsapp,telefones,balcao_link')
    .eq('escritorio_id', p.escritorio_id).limit(800)
  const alvo = normaliza((p.orgao || '') + ' ' + (p.foro || ''))
  if (!alvo || !(data || []).length) return null
  let melhor = null, melhorPts = 0
  for (const c of data) {
    const co = normaliza(c.orgao), cc = normaliza(c.comarca)
    if (!co && !cc) continue
    let pts = 0
    if (co && (alvo.indexOf(co) > -1 || co.indexOf(alvo) > -1)) pts += 4
    if (cc && alvo.indexOf(cc) > -1) pts += 2
    const vAlvo = (alvo.match(/(\d+)ª? ?vara/) || [])[1]
    const vCand = (co.match(/(\d+)ª? ?vara/) || [])[1]
    if (vAlvo && vCand && vAlvo === vCand) pts += 2
    if (vAlvo && vCand && vAlvo !== vCand) pts -= 3
    // sobreposição de palavras (civel, familia, fazenda, juizado…)
    const palavras = co.split(' ').filter(w => w.length > 3)
    for (const w of palavras) if (alvo.indexOf(w) > -1) pts += 0.5
    if (pts > melhorPts) { melhorPts = pts; melhor = c }
  }
  if (melhorPts < 3) return null
  return { orgao: melhor.orgao, comarca: melhor.comarca, email: melhor.email, whatsapp: melhor.whatsapp, telefones: melhor.telefones, balcao_link: melhor.balcao_link }
}

/* push para a EQUIPE quando o cliente manda mensagem */
async function avisarEscritorio(sb, acesso, p, texto) {
  try {
    const { data: v } = await sb.from('app_secrets').select('valor').eq('chave', 'vapid_chat').maybeSingle()
    if (!(v && v.valor)) return
    webpush.setVapidDetails('mailto:contato@cmpadvogados.com.br', v.valor.public, v.valor.private)
    const { data: pessoas } = await sb.from('usuarios').select('id').eq('escritorio_id', acesso.escritorio_id)
    const ids = (pessoas || []).map(u => u.id)
    if (!ids.length) return
    const { data: subs } = await sb.from('chat_push_subs').select('*').in('user_id', ids)
    const payload = JSON.stringify({
      titulo: '📩 ' + (acesso.nome || 'Cliente') + ' (app do cliente)',
      corpo: ('Proc ' + (p.numero || '') + ': ' + String(texto || '')).slice(0, 140),
      url: '/sistema.html?proc=' + digitos(p.numero) + '&clichat=1',
    })
    const mortos = []
    await Promise.all((subs || []).map(async (s) => {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } }, payload) }
      catch (e) { if (e && (e.statusCode === 404 || e.statusCode === 410)) mortos.push(s.endpoint) }
    }))
    if (mortos.length) { try { await sb.from('chat_push_subs').delete().in('endpoint', mortos) } catch (e) {} }
  } catch (e) { /* push é melhor esforço — nunca derruba o chat */ }
}

/* ============================== POST ============================== */
export async function POST(request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ erro: 'Servidor sem SUPABASE_SERVICE_ROLE_KEY.' }, { status: 500 })
  }
  let body = {}
  try { body = await request.json() } catch (e) {}
  const acao = String(body.acao || '')
  const sb = svc()

  /* ---------- login ---------- */
  if (acao === 'login') {
    const email = String(body.email || '').trim().toLowerCase()
    const senha = String(body.senha || '')
    const devId = String(body.dispositivo_id || '').slice(0, 64)
    const devNome = String(body.dispositivo_nome || '').slice(0, 160)
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !senha) {
      return Response.json({ erro: 'Informe e-mail e senha.' }, { status: 400 })
    }
    const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'sem-ip'
    if (!podeTentar(ip + '|' + email)) {
      return Response.json({ erro: 'Muitas tentativas. Aguarde 10 minutos e tente de novo.' }, { status: 429 })
    }
    const { data: a } = await sb.from('portal_acessos').select('*').eq('email', email).maybeSingle()
    if (!a || !confereSenha(senha, a.senha_hash)) {
      marcaTentativa(ip + '|' + email)
      return Response.json({ erro: 'E-mail ou senha incorretos. Confira os dados que o escritório enviou por e-mail.' }, { status: 401 })
    }
    if (!a.ativo) return Response.json({ erro: 'Este acesso foi desativado. Fale com o escritório.' }, { status: 403 })
    if (a.bloqueado_em) return Response.json({ erro: 'Acesso bloqueado por segurança (muitos aparelhos diferentes). Fale com o escritório para desbloquear.' }, { status: 403 })

    // aparelhos: registra este e conta os distintos — no 5º diferente, bloqueia
    if (devId) {
      await sb.from('portal_dispositivos').upsert(
        { acesso_id: a.id, dispositivo_id: devId, user_agent: devNome, ultimo_uso: new Date().toISOString() },
        { onConflict: 'acesso_id,dispositivo_id' }
      )
    }
    const { data: devs } = await sb.from('portal_dispositivos').select('id').eq('acesso_id', a.id)
    if ((devs || []).length > MAX_APARELHOS) {
      await sb.from('portal_acessos').update({
        bloqueado_em: new Date().toISOString(),
        bloqueio_motivo: 'acesso em ' + devs.length + ' aparelhos diferentes',
      }).eq('id', a.id)
      await sb.from('portal_sessoes').delete().eq('acesso_id', a.id)
      return Response.json({ erro: 'Acesso bloqueado por segurança: uso em muitos aparelhos diferentes. Fale com o escritório para desbloquear.' }, { status: 403 })
    }

    // sessão ÚNICA por pessoa: derruba a anterior (1 login simultâneo por autor)
    await sb.from('portal_sessoes').delete().eq('acesso_id', a.id)
    const token = crypto.randomBytes(24).toString('hex')
    const exp = new Date(Date.now() + SESSAO_DIAS * 86400000).toISOString()
    const ins = await sb.from('portal_sessoes').insert({ token, acesso_id: a.id, expira_em: exp, dispositivo: devNome || devId })
    if (ins.error) return Response.json({ erro: 'Falha ao criar a sessão. Tente de novo.' }, { status: 500 })

    const marca = { ultimo_login_em: new Date().toISOString() }
    if (!a.primeiro_login_em) marca.primeiro_login_em = marca.ultimo_login_em
    await sb.from('portal_acessos').update(marca).eq('id', a.id)

    // entrou: encerra a cobrança do convite (o robô app-convite para de insistir)
    if (!a.primeiro_login_em) {
      try {
        const { encerrarConvite } = await import('./convite-lib.js')
        await encerrarConvite(sb, { escritorio_id: a.escritorio_id, email: a.email, motivo: 'logou' })
      } catch (e) {}
    }

    return Response.json({ ok: true, token, nome: a.nome || '' })
  }

  /* ---------- daqui pra baixo, tudo exige sessão ---------- */
  const acesso = await sessao(sb, tokenDo(request))
  if (!acesso) return Response.json({ erro: 'Sessão expirada. Entre de novo.' }, { status: 401 })

  if (acao === 'sair') {
    await sb.from('portal_sessoes').delete().eq('token', tokenDo(request))
    return Response.json({ ok: true })
  }

  if (acao === 'meus') {
    const todosIds = await processosPermitidos(sb, acesso)
    if (!todosIds.length) return Response.json({ ok: true, nome: acesso.nome || '', processos: [] })
    const { data: brutos } = await sb.from('processos')
      .select('id,numero,classe,assunto,foro,orgao,orgao_atual,grau_atual,tramitacoes,fase,status,distribuido_em,valor_causa,ultima_movimentacao,oponente,cliente_nome,vinculados')
      .in('id', todosIds).order('ultima_movimentacao', { ascending: false, nullsFirst: false })
    // processo encerrado não vai para o app do cliente — a lista mostra o que está em
    // andamento. (Filtrado aqui, e não na consulta, para não derrubar status vazio.)
    const procs = (brutos || []).filter(p => !/encerrad|arquivad|baixad/i.test(p.status || ''))
    const ids = procs.map(p => p.id)
    if (!ids.length) return Response.json({ ok: true, nome: acesso.nome || '', processos: [] })
    // última movimentação OFICIAL de cada processo (uma por processo, resolvido no banco)
    const { data: movs } = await sb.rpc('portal_ultima_mov', { p_ids: ids })
    const ultima = {}
    for (const m of (movs || [])) if (!ultima[m.processo_id]) ultima[m.processo_id] = m
    // não lidas do chat (mensagens do escritório que o cliente ainda não viu)
    const { data: naoLidas } = await sb.from('portal_chat')
      .select('processo_id').in('processo_id', ids).eq('autor_tipo', 'escritorio').eq('lida_cliente', false).limit(1000)
    const badge = {}
    for (const n of (naoLidas || [])) badge[n.processo_id] = (badge[n.processo_id] || 0) + 1

    // Movimentação do processo VINCULADO também vai para o card: quando o processo
    // do cliente está suspenso esperando a ação principal, é lá que a coisa anda —
    // sem isso o app pareceria parado justamente para quem mais espera notícia.
    const digsVinc = new Set()
    procs.forEach(p => numerosVinculados(p).forEach(d => digsVinc.add(d)))
    const vincDoProc = {}
    if (digsVinc.size) {
      const { data: vps } = await sb.from('processos').select('id,numero,numero_digitos')
        .eq('escritorio_id', acesso.escritorio_id).in('numero_digitos', Array.from(digsVinc))
      if (vps && vps.length) {
        const { data: vmovs } = await sb.rpc('portal_ultima_mov', { p_ids: vps.map(v => v.id) })
        const ultimaV = {}
        for (const m of (vmovs || [])) if (!ultimaV[m.processo_id]) ultimaV[m.processo_id] = m
        const porDig = {}
        vps.forEach(v => { porDig[v.numero_digitos] = v })
        procs.forEach(p => {
          const d = numerosVinculados(p).find(x => porDig[x])
          const v = d && porDig[d]
          const m = v && ultimaV[v.id]
          if (v && m) vincDoProc[p.id] = { numero: v.numero, data: m.data, texto: String(m.texto || '').slice(0, 200) }
        })
      }
    }

    const lista = (procs || []).map(p => ({
      id: p.id, numero: p.numero,
      titulo: p.assunto || p.classe || 'Ação judicial',
      classe: p.classe, foro: p.foro || p.orgao, fase: p.fase, status: p.status || 'ativo',
      cliente: p.cliente_nome, oponente: p.oponente,
      ultima: ultima[p.id] ? { data: ultima[p.id].data, texto: String(ultima[p.id].texto || '').slice(0, 220) } : null,
      vinculado: vincDoProc[p.id] || null,
      nao_lidas: badge[p.id] || 0,
    }))
    return Response.json({ ok: true, nome: acesso.nome || '', processos: lista })
  }

  if (acao === 'processo') {
    const id = String(body.id || '')
    const ids = await processosPermitidos(sb, acesso)
    if (!ids.includes(id)) return Response.json({ erro: 'Processo não disponível para este acesso.' }, { status: 403 })
    const { data: p } = await sb.from('processos').select('*').eq('id', id).maybeSingle()
    if (!p) return Response.json({ erro: 'Processo não encontrado.' }, { status: 404 })
    const { data: ands } = await sb.from('andamentos')
      .select('id,data,texto,fonte').eq('processo_id', id).or(FILTRO_HIST_CLIENTE)
      .order('data', { ascending: false }).order('id', { ascending: false }).limit(300)
    const [docs, cart, vinculados] = await Promise.all([
      docsDoProcesso(sb, p), cartorioDaVara(sb, p), vinculadosDoProcesso(sb, p),
    ])
    const [papelAtivo, papelPassivo] = papeisDaClasse(p.classe, p.assunto, p.fase)
    const partes = [
      { papel: papelAtivo, nome: p.cliente_nome || (acesso.nome || 'Você'), voce: true },
      { papel: papelPassivo, nome: p.oponente || 'Parte contrária', voce: false },
    ]
    const { count } = await sb.from('portal_chat')
      .select('id', { count: 'exact', head: true })
      .eq('processo_id', id).eq('autor_tipo', 'escritorio').eq('lida_cliente', false)
    return Response.json({
      ok: true,
      dados: {
        id: p.id, numero: p.numero, classe: p.classe, assunto: p.assunto,
        foro: p.foro, orgao: p.orgao, fase: p.fase, status: p.status || 'ativo',
        orgao_atual: p.orgao_atual, grau_atual: p.grau_atual,
        tramitacoes: Array.isArray(p.tramitacoes) ? p.tramitacoes : [],
        distribuido_em: p.distribuido_em, valor_causa: p.valor_causa, ultima_movimentacao: p.ultima_movimentacao,
      },
      partes,
      movimentacoes: ands || [],
      documentos: docs,
      cartorio: cart,
      vinculados,
      chat_nao_lidas: count || 0,
    })
  }

  if (acao === 'chat') {
    const pid = String(body.processo_id || '')
    const ids = await processosPermitidos(sb, acesso)
    if (!ids.includes(pid)) return Response.json({ erro: 'Processo não disponível.' }, { status: 403 })
    let q = sb.from('portal_chat').select('id,autor_tipo,autor_nome,texto,criado_em,anexo_id,anexo_nome,anexo_tipo,anexo_tamanho').eq('processo_id', pid).order('id', { ascending: true })
    const desde = parseInt(body.desde_id || 0, 10)
    if (desde > 0) q = q.gt('id', desde); else q = q.limit(200)
    const { data: msgs } = await q
    // abrir o chat marca como lidas as mensagens do escritório
    try {
      await sb.from('portal_chat').update({ lida_cliente: true })
        .eq('processo_id', pid).eq('autor_tipo', 'escritorio').eq('lida_cliente', false)
    } catch (e) {}
    return Response.json({ ok: true, mensagens: msgs || [] })
  }

  if (acao === 'chat_enviar') {
    const pid = String(body.processo_id || '')
    const texto = String(body.texto || '').trim().slice(0, MAX_TEXTO_CHAT)
    const arq = body.arquivo || null
    if (!texto && !arq) return Response.json({ erro: 'Escreva a mensagem ou anexe um arquivo.' }, { status: 400 })
    const ids = await processosPermitidos(sb, acesso)
    if (!ids.includes(pid)) return Response.json({ erro: 'Processo não disponível.' }, { status: 403 })
    const { data: p } = await sb.from('processos').select('id,numero,escritorio_id').eq('id', pid).maybeSingle()

    // anexo (Word, PDF, foto, áudio…): sobe para o Storage e vira linha em `anexos`,
    // igual ao chat da equipe — a mensagem guarda só a referência.
    let anexo = null
    if (arq) {
      let buf
      try { buf = Buffer.from(String(arq.b64 || ''), 'base64') } catch (e) { buf = null }
      if (!buf || !buf.length) return Response.json({ erro: 'Arquivo vazio ou inválido.' }, { status: 400 })
      if (buf.length > MAX_ANEXO) return Response.json({ erro: 'O arquivo passa de 15 MB — envie um menor.' }, { status: 400 })
      const tipo = String(arq.tipo || 'application/octet-stream').slice(0, 120)
      const nome = String(arq.nome || 'arquivo').slice(0, 180)
      const ext = ((nome.match(/\.(\w{1,8})$/) || [])[1] || (tipo.split('/')[1] || 'bin')).replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin'
      const caminho = 'portal/' + acesso.escritorio_id + '/' + pid + '/' + crypto.randomUUID() + '.' + ext
      const up = await sb.storage.from('capturas').upload(caminho, buf, { contentType: tipo, upsert: false })
      if (up.error) return Response.json({ erro: 'Não foi possível enviar o arquivo. Tente de novo.' }, { status: 500 })
      const insA = await sb.from('anexos').insert({
        escritorio_id: acesso.escritorio_id, origem: 'portal', processo_numero: (p && p.numero) || null,
        nome, tipo, tamanho: buf.length, path: caminho, criado_por: acesso.nome || acesso.email,
      }).select('id').single()
      if (insA.error) {
        try { await sb.storage.from('capturas').remove([caminho]) } catch (e) {}
        return Response.json({ erro: 'Não foi possível guardar o arquivo. Tente de novo.' }, { status: 500 })
      }
      anexo = { anexo_id: insA.data.id, anexo_nome: nome, anexo_tipo: tipo, anexo_tamanho: buf.length }
    }

    const ins = await sb.from('portal_chat').insert(Object.assign({
      escritorio_id: acesso.escritorio_id, processo_id: pid, acesso_id: acesso.id,
      autor_tipo: 'cliente', autor_nome: acesso.nome || acesso.email, texto: texto || null,
      lida_cliente: true, lida_escritorio: false,
    }, anexo || {})).select('id,autor_tipo,autor_nome,texto,criado_em,anexo_id,anexo_nome,anexo_tipo,anexo_tamanho').single()
    if (ins.error) return Response.json({ erro: 'Falha ao enviar. Tente de novo.' }, { status: 500 })
    avisarEscritorio(sb, acesso, p || { numero: '' }, texto || ('anexo: ' + (anexo ? anexo.anexo_nome : '')))
    return Response.json({ ok: true, mensagem: ins.data })
  }

  if (acao === 'push_subscribe') {
    const s = body.subscription
    if (!s || !s.endpoint || !s.keys) return Response.json({ erro: 'inscrição inválida' }, { status: 400 })
    const r = await sb.from('portal_push_subs').upsert({
      acesso_id: acesso.id, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth_key: s.keys.auth,
    }, { onConflict: 'endpoint' })
    if (r.error) return Response.json({ erro: r.error.message }, { status: 500 })
    return Response.json({ ok: true })
  }
  if (acao === 'push_unsubscribe') {
    await sb.from('portal_push_subs').delete().eq('endpoint', String(body.endpoint || '')).eq('acesso_id', acesso.id)
    return Response.json({ ok: true })
  }

  return Response.json({ erro: 'Ação desconhecida.' }, { status: 400 })
}

/* ============================== GET (arquivos + chave push) ============================== */
export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const sb = svc()

  // chave pública VAPID (para o cliente ativar o alarme no celular)
  if (searchParams.get('push') === 'key') {
    const { data: v } = await sb.from('app_secrets').select('valor').eq('chave', 'vapid_chat').maybeSingle()
    if (!(v && v.valor)) return Response.json({ erro: 'push não configurado' }, { status: 501 })
    return Response.json({ ok: true, publicKey: v.valor.public })
  }

  const doc = String(searchParams.get('doc') || '')
  const t = String(searchParams.get('t') || '')
  const dl = searchParams.get('dl')
  if (!doc) return Response.json({ erro: 'informe o documento' }, { status: 400 })

  const acesso = await sessao(sb, t)
  if (!acesso) return Response.json({ erro: 'Sessão expirada. Entre de novo no portal.' }, { status: 401 })

  const [tipo, id] = doc.split(':')
  const permitidos = await processosPermitidos(sb, acesso)
  // números que este acesso pode abrir documento: os processos dele + os vinculados
  // (a ação principal em que ele é credor), cujos atos oficiais já são públicos
  const { data: meusProcs } = await sb.from('processos').select('id,numero,vinculados').in('id', permitidos)
  const numerosOk = new Set()
  ;(meusProcs || []).forEach(p => {
    numerosOk.add(digitos(p.numero))
    numerosVinculados(p).forEach(d => numerosOk.add(d))
  })

  /* peça oficial do jus.br */
  if (tipo === 'jusbr') {
    const { data } = await sb.from('jusbr_arquivos')
      .select('processo_numero,doc_nome,doc_tipo,conteudo_b64,caminho_disco')
      .eq('id', id).eq('escritorio_id', acesso.escritorio_id).maybeSingle()
    if (!data) return Response.json({ erro: 'Documento não encontrado (pode ter expirado).' }, { status: 404 })
    // o documento precisa ser de um processo que este acesso enxerga (ou do vinculado)
    if (!numerosOk.has(digitos(data.processo_numero))) {
      return Response.json({ erro: 'Documento não disponível para este acesso.' }, { status: 403 })
    }
    if (!RE_OFICIAL.test((data.doc_tipo || '') + ' ' + (data.doc_nome || ''))) {
      return Response.json({ erro: 'Documento não disponível no portal.' }, { status: 403 })
    }
    let buf = null
    if (data.conteudo_b64) buf = Buffer.from(data.conteudo_b64, 'base64')
    else if (data.caminho_disco) { try { buf = fs.readFileSync(data.caminho_disco) } catch (e) { buf = null } }
    if (!buf || !buf.length) return Response.json({ erro: 'Arquivo não encontrado (pode ter expirado).' }, { status: 404 })
    let mime = tipoRealDoArquivo(buf, data.doc_tipo, data.doc_nome)
    // O cliente recebe PDF: peça que chega em texto ou HTML (ex.: "Sentença.html"
    // salva pelo visor do jus.br) é convertida na entrega — no celular, PDF abre
    // e se guarda melhor do que uma página HTML solta.
    if (mime === 'text/plain' || mime === 'text/html') {
      try {
        const txt = mime === 'text/html' ? _htmlParaTexto(buf.toString('utf8')) : buf.toString('utf8')
        buf = await pdfDeTexto(txt, data.doc_nome); mime = 'application/pdf'
      } catch (e) { mime = (mime === 'text/html' ? 'text/html' : 'text/plain') + '; charset=utf-8' }
    }
    let nome = (data.doc_nome || 'documento').replace(/[^\w.\- ]+/g, '_')
    if (mime === 'application/pdf' && !/\.pdf$/i.test(nome)) nome = nome.replace(/\.(html?|txt)$/i, '') + '.pdf'
    return new Response(buf, {
      headers: {
        'Content-Type': mime,
        'Content-Disposition': (dl ? 'attachment' : 'inline') + '; filename="' + nome + (/\.\w+$/.test(nome) ? '' : '.pdf') + '"',
        'Cache-Control': 'private, max-age=300',
      },
    })
  }

  /* anexo do chat (o que o cliente mandou e o que o escritório respondeu) */
  if (tipo === 'anexo') {
    // o anexo só abre se estiver numa mensagem de um processo que este acesso enxerga
    const { data: msg } = await sb.from('portal_chat').select('processo_id').eq('anexo_id', id).limit(1).maybeSingle()
    if (!msg || !permitidos.includes(msg.processo_id)) {
      return Response.json({ erro: 'Arquivo não disponível para este acesso.' }, { status: 403 })
    }
    const { data: meta } = await sb.from('anexos').select('nome,tipo,path').eq('id', id).eq('escritorio_id', acesso.escritorio_id).maybeSingle()
    if (!meta || !meta.path) return Response.json({ erro: 'Arquivo não encontrado.' }, { status: 404 })
    const baixa = await sb.storage.from('capturas').download(meta.path)
    if (baixa.error || !baixa.data) return Response.json({ erro: 'Falha ao ler o arquivo.' }, { status: 502 })
    const buf = Buffer.from(await baixa.data.arrayBuffer())
    const nome = (meta.nome || 'anexo').replace(/[^\w.\- ]+/g, '_')
    return new Response(buf, {
      headers: {
        'Content-Type': meta.tipo || 'application/octet-stream',
        'Content-Disposition': (dl ? 'attachment' : 'inline') + '; filename="' + nome + '"',
        'Cache-Control': 'private, max-age=300',
      },
    })
  }

  /* nossa petição protocolada (ou o comprovante de protocolo) */
  if (tipo === 'peticao' || tipo === 'comprovante') {
    const { data } = await sb.from('peticoes_protocolo')
      .select('processo_id,processo_numero,titulo,arquivo_nome,arquivo_caminho,comprovante_nome,comprovante_caminho,protocolada_em')
      .eq('id', id).eq('escritorio_id', acesso.escritorio_id).maybeSingle()
    if (!data || !data.protocolada_em) return Response.json({ erro: 'Petição não encontrada.' }, { status: 404 })
    const { data: procs } = await sb.from('processos').select('id,numero').in('id', permitidos)
    const dono = (procs || []).find(p => p.id === data.processo_id || digitos(p.numero) === digitos(data.processo_numero))
    if (!dono) return Response.json({ erro: 'Documento não disponível para este acesso.' }, { status: 403 })
    const rel = tipo === 'peticao' ? data.arquivo_caminho : data.comprovante_caminho
    const nomeArq = (tipo === 'peticao' ? (data.arquivo_nome || data.titulo) : (data.comprovante_nome || 'comprovante')) || 'documento'
    if (!rel) return Response.json({ erro: 'Arquivo não disponível.' }, { status: 404 })
    const abs = path.resolve(rel.startsWith('/') ? rel : path.join(DOCS_ROOT, rel))
    if (!abs.startsWith(DOCS_ROOT + path.sep) && abs !== DOCS_ROOT) {
      return Response.json({ erro: 'Caminho inválido.' }, { status: 400 })
    }
    let buf = null
    try { buf = fs.readFileSync(abs) } catch (e) { buf = null }
    if (!buf || !buf.length) return Response.json({ erro: 'Arquivo não encontrado no servidor.' }, { status: 404 })
    const ext = (abs.match(/\.(\w+)$/) || [])[1] || ''
    const mimes = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', doc: 'application/msword', html: 'text/html; charset=utf-8', txt: 'text/plain; charset=utf-8' }
    const nome = String(nomeArq).replace(/[^\w.\- ]+/g, '_')
    return new Response(buf, {
      headers: {
        'Content-Type': mimes[ext.toLowerCase()] || 'application/octet-stream',
        'Content-Disposition': (dl ? 'attachment' : 'inline') + '; filename="' + nome + (/\.\w+$/.test(nome) ? '' : ('.' + (ext || 'pdf'))) + '"',
        'Cache-Control': 'private, max-age=300',
      },
    })
  }

  return Response.json({ erro: 'Tipo de documento desconhecido.' }, { status: 400 })
}
