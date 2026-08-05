// API do Portal da Inove — o que o navegador do perito chama.
//
// A Inove NUNCA fala direto com o Supabase: tudo passa por aqui, e daqui para o banco
// pelo role `inove_app`, que não tem privilégio nenhum no schema `public`. É esse
// desenho que faz a tarja valer alguma coisa — se o navegador pudesse baixar o
// arquivo por fora, o carimbo seria decorativo.
//
//   POST /api/inove {acao:'login', email, senha}      -> { ok, token, nome, lgpd }
//   POST {acao:'sair'}                                 (Bearer token da Inove)
//   POST {acao:'meus'}                                -> lista dos processos
//   POST {acao:'processo', id}                        -> ficha + movimentações + peças
//   POST {acao:'etiquetas'}                           -> as 57 situações e os 9 quesitos
//   POST {acao:'etiquetar', processo_id, dimensao, etiqueta_id}
//   POST {acao:'cadastrar_processo', numero, cliente, oponente, assunto}
//   POST {acao:'atualizar', processo_id}              -> puxa documentos novos do jus.br
//   POST {acao:'financeiro'} / {acao:'financeiro_salvar', ...}
//   POST {acao:'chat', processo_id, desde_id} / {acao:'chat_enviar', processo_id, texto}
//   POST {acao:'acessos'} / {acao:'acesso_criar'|'acesso_editar'|'acesso_desativar'}
//   POST {acao:'lgpd_aceitar'}
//   GET  /api/inove?doc=<id>&t=<token>[&dl=1]         -> o arquivo, já carimbado
//
// Documentos: a Inove vê TUDO dos processos dela, não só as peças oficiais. Perito
// não acompanha processo, ele produz o laudo — precisa de quesito, impugnação,
// proposta e petição das partes. O controle está na tarja e no log, não no filtro.

import {
  q, q1, hashSenha, confereSenha, sessao, tokenDo, ip, podeTentar, marcaTentativa,
  config, num, carimbarPdf, lerDocumento, logDoc, alertarEscritorio, erro, SESSAO_DIAS,
} from './lib.js'
import { tipoRealDoArquivo, pdfDeTexto } from '../jusbr/lib.js'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_TEXTO_CHAT = 4000
const RE_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/* Etiqueta que vai carimbada em cada página. Identifica a pessoa, não a empresa —
   a Inove tem 5 acessos e a tarja precisa apontar para um deles. */
function etiquetaTarja(acesso, doc) {
  const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
  const proc = doc.processo_numero ? ' · ' + doc.processo_numero : ''
  return acesso.email + ' · ' + agora + proc + ' · uso restrito'
}

export async function POST(request) {
  let body = {}
  try { body = await request.json() } catch (e) {}
  const acao = String(body.acao || '')

  /* ---------- login ---------- */
  if (acao === 'login') {
    const email = String(body.email || '').trim().toLowerCase()
    const senha = String(body.senha || '')
    if (!RE_EMAIL.test(email) || !senha) return erro('Informe e-mail e senha.')

    const chave = (ip(request) || 'sem-ip') + '|' + email
    if (!podeTentar(chave)) return erro('Muitas tentativas. Aguarde 10 minutos.', 429)

    const a = await q1('select * from inove.acessos where email = $1', [email])
    if (!a || !confereSenha(senha, a.senha_hash)) {
      marcaTentativa(chave)
      return erro('E-mail ou senha incorretos.', 401)
    }
    if (!a.ativo) return erro('Este acesso foi desativado. Fale com o escritório.', 403)
    if (a.bloqueado_em) return erro('Acesso bloqueado. Fale com o escritório.', 403)

    const token = crypto.randomBytes(24).toString('hex')
    await q(
      `insert into inove.sessoes (token, acesso_id, expira_em, ip)
       values ($1, $2, now() + ($3 || ' days')::interval, $4)`,
      [token, a.id, String(SESSAO_DIAS), ip(request)])
    await q(
      `update inove.acessos
          set ultimo_login_em = now(),
              primeiro_login_em = coalesce(primeiro_login_em, now())
        where id = $1`, [a.id])

    // o aviso de LGPD é por dia: quem já aceitou hoje não vê de novo
    const c = await config()
    const aceitou = await q1(
      `select 1 from inove.aceites_lgpd
        where acesso_id = $1 and versao = $2
          and criado_em >= date_trunc('day', now() at time zone 'America/Sao_Paulo')
        limit 1`, [a.id, c.lgpd_versao || '1'])

    return Response.json({ ok: true, token, nome: a.nome || '', email: a.email, lgpd: !aceitou })
  }

  /* ---------- daqui pra baixo, tudo exige sessão ---------- */
  const acesso = await sessao(tokenDo(request))
  if (!acesso) return erro('Sessão expirada. Entre de novo.', 401)

  if (acao === 'sair') {
    await q('delete from inove.sessoes where token = $1', [tokenDo(request)])
    return Response.json({ ok: true })
  }

  if (acao === 'lgpd_aceitar') {
    const c = await config()
    await q(
      `insert into inove.aceites_lgpd (acesso_id, email, versao, ip, user_agent)
       values ($1,$2,$3,$4,$5)`,
      [acesso.id, acesso.email, c.lgpd_versao || '1', ip(request),
       (request.headers.get('user-agent') || '').slice(0, 400)])
    return Response.json({ ok: true })
  }

  /* ---------- processos ---------- */
  if (acao === 'meus') {
    const linhas = await q(
      `select p.*,
              (select e.nome from inove.processo_etiquetas pe
                 join inove.etiquetas e on e.id = pe.etiqueta_id
                where pe.processo_id = p.id and pe.dimensao = 'situacao') as situacao,
              (select e.nome from inove.processo_etiquetas pe
                 join inove.etiquetas e on e.id = pe.etiqueta_id
                where pe.processo_id = p.id and pe.dimensao = 'quesitos') as quesitos,
              (select count(*) from inove.v_documentos d where d.processo_id = p.id) as docs
         from inove.v_processos p
        order by p.ultima_movimentacao desc nulls last, p.cliente_nome`)
    const c = await config()
    return Response.json({
      ok: true,
      processos: linhas,
      limite: num(c, 'limite_processos', 62),
      usados: linhas.length,
    })
  }

  if (acao === 'processo') {
    const id = String(body.id || '')
    const p = await q1('select * from inove.v_processos where id = $1', [id])
    if (!p) return erro('Processo não encontrado.', 404)
    const [movs, docs, etq] = await Promise.all([
      q('select * from inove.v_andamentos where processo_id = $1 order by data desc nulls last, id desc limit 300', [id]),
      q('select * from inove.v_documentos where processo_id = $1 order by baixado_em desc limit 400', [id]),
      q(`select pe.dimensao, pe.etiqueta_id, e.nome
           from inove.processo_etiquetas pe
           join inove.etiquetas e on e.id = pe.etiqueta_id
          where pe.processo_id = $1`, [id]),
    ])
    return Response.json({ ok: true, processo: p, movimentacoes: movs, documentos: docs, etiquetas: etq })
  }

  if (acao === 'cadastrar_processo') {
    try {
      const r = await q1(
        'select * from inove.cadastrar_processo($1,$2,$3,$4,$5)',
        [String(body.numero || '').trim(), String(body.cliente || '').trim(),
         body.oponente || null, body.assunto || null, body.tipo || 'judicial'])
      // avisa o escritório quando a cota estiver no fim — o teto não pode pegar
      // ninguém de surpresa, nem eles nem nós
      if (r && !r.ja_existia && r.total >= r.limite - 3) {
        await alertarEscritorio(
          'Inove: ' + r.total + ' de ' + r.limite + ' processos',
          'A Inove cadastrou o processo ' + r.numero + ' (' + acesso.email + ').\n\n' +
          'Ficam ' + (r.limite - r.total) + ' vagas até o limite de ' + r.limite + '.')
      }
      return Response.json({ ok: true, ...r })
    } catch (e) {
      const msg = String((e && e.message) || e)
      if (/Limite de/.test(msg)) {
        await alertarEscritorio(
          'Inove: limite de processos atingido',
          acesso.email + ' tentou cadastrar ' + (body.numero || '') + ', mas o limite foi atingido.\n\n' +
          'Para ampliar, altere limite_processos em inove.config.')
        return erro(msg + ' O escritório já foi avisado e vai falar com vocês.', 409)
      }
      return erro('Não foi possível cadastrar: ' + msg)
    }
  }

  /* Puxa documentos novos do jus.br. Quem tem a sessão do jus.br é o ESCRITÓRIO — a
     Inove só dispara o pedido, e o token nunca passa por aqui. Ver
     ops/PROJETO-INOVE.md, seção 7b (c). */
  if (acao === 'atualizar') {
    const p = await q1('select numero from inove.v_processos where id = $1', [String(body.processo_id || '')])
    if (!p) return erro('Processo não encontrado.', 404)
    const base = (process.env.PUBLIC_URL || 'https://gestao.cmpadvogados.com.br').replace(/\/+$/, '')
    try {
      const r = await fetch(base + '/api/jusbr/puxar-docs?numero=' + encodeURIComponent(p.numero), { cache: 'no-store' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || j.erro) {
        await alertarEscritorio(
          'Inove: falha ao atualizar ' + p.numero,
          (acesso.email + ' pediu atualização do processo ' + p.numero + '.\n\n' +
           'Resposta do jus.br: ' + (j.erro || ('HTTP ' + r.status)) + '\n\n' +
           'Se for sessão vencida, sincronize o token pelo userscript.'))
        return Response.json({
          ok: false,
          aviso: 'A busca no jus.br não respondeu agora. O escritório foi avisado e a atualização será feita assim que a sessão estiver ativa.',
        })
      }
      return Response.json({ ok: true, ...j })
    } catch (e) {
      await alertarEscritorio('Inove: falha ao atualizar ' + p.numero,
        acesso.email + ' pediu atualização e a chamada falhou: ' + ((e && e.message) || e))
      return Response.json({ ok: false, aviso: 'Não foi possível falar com o jus.br agora. O escritório foi avisado.' })
    }
  }

  /* ---------- etiquetas ---------- */
  if (acao === 'etiquetas') {
    const linhas = await q('select id, dimensao, nome, ordem, cor from inove.etiquetas where ativo order by dimensao, ordem')
    return Response.json({
      ok: true,
      situacao: linhas.filter(x => x.dimensao === 'situacao'),
      quesitos: linhas.filter(x => x.dimensao === 'quesitos'),
    })
  }

  if (acao === 'etiquetar') {
    const pid = String(body.processo_id || '')
    const dim = String(body.dimensao || '')
    if (!['situacao', 'quesitos'].includes(dim)) return erro('Dimensão inválida.')
    const p = await q1('select id from inove.v_processos where id = $1', [pid])
    if (!p) return erro('Processo não encontrado.', 404)

    if (!body.etiqueta_id) {
      await q('delete from inove.processo_etiquetas where processo_id = $1 and dimensao = $2', [pid, dim])
      return Response.json({ ok: true, removida: true })
    }
    // a chave primária é (processo_id, dimensao): o upsert troca o valor daquela
    // dimensão, nunca acumula duas situações no mesmo processo
    await q(
      `insert into inove.processo_etiquetas (processo_id, dimensao, etiqueta_id, definido_por)
       values ($1,$2,$3,$4)
       on conflict (processo_id, dimensao)
       do update set etiqueta_id = excluded.etiqueta_id,
                     definido_por = excluded.definido_por,
                     definido_em = now()`,
      [pid, dim, String(body.etiqueta_id), acesso.id])
    return Response.json({ ok: true })
  }

  /* ---------- financeiro ---------- */
  if (acao === 'financeiro') {
    const linhas = await q(
      `select f.*, p.numero as processo_numero_cnj, p.cliente_nome
         from inove.financeiro f
         left join inove.v_processos p on p.id = f.processo_id
        order by coalesce(f.data_recebimento, f.data_deposito) desc nulls last, f.criado_em desc`)
    const t = await q1(
      `select coalesce(sum(valor_recebido),0) recebido,
              coalesce(sum(valor_areceber),0) areceber,
              coalesce(sum(despesas),0) despesas,
              count(*) linhas
         from inove.financeiro`)
    return Response.json({ ok: true, linhas, totais: t })
  }

  if (acao === 'financeiro_salvar') {
    const f = body.linha || {}
    const campos = ['processo_id', 'processo_numero', 'valor_proposta', 'honorario_fixado',
      'valor_depositado', 'valor_recebido', 'despesas', 'retencoes', 'valor_areceber',
      'situacao_pagamento', 'data_deposito', 'data_recebimento', 'reu', 'vara', 'foro', 'uf', 'observacoes']
    const vals = campos.map(k => (f[k] === '' || f[k] === undefined ? null : f[k]))

    if (f.id) {
      const sets = campos.map((k, i) => k + ' = $' + (i + 1)).join(', ')
      await q(`update inove.financeiro set ${sets}, atualizado_por = $${campos.length + 1}, atualizado_em = now()
                where id = $${campos.length + 2}`, [...vals, acesso.id, f.id])
      return Response.json({ ok: true, id: f.id })
    }
    const cols = campos.join(', ')
    const ph = campos.map((_, i) => '$' + (i + 1)).join(', ')
    const r = await q1(
      `insert into inove.financeiro (${cols}, atualizado_por) values (${ph}, $${campos.length + 1}) returning id`,
      [...vals, acesso.id])
    return Response.json({ ok: true, id: r && r.id })
  }

  /* ---------- chat ----------
     Fica em inove.chat, e não em public.portal_chat, porque o inove_app não escreve
     no public. Do lado do escritório as duas fontes aparecem na mesma tela. */
  if (acao === 'chat') {
    const pid = body.processo_id ? String(body.processo_id) : null
    const desde = parseInt(body.desde_id || 0, 10) || 0
    const linhas = pid
      ? await q('select * from inove.chat where processo_id = $1 and id > $2 order by id limit 400', [pid, desde])
      : await q('select * from inove.chat where processo_id is null and id > $1 order by id limit 400', [desde])
    if (linhas.length) {
      await q('update inove.chat set lida_inove = true where id = any($1) and autor_tipo = $2',
        [linhas.map(x => x.id), 'escritorio'])
    }
    return Response.json({ ok: true, mensagens: linhas })
  }

  if (acao === 'chat_enviar') {
    const texto = String(body.texto || '').trim().slice(0, MAX_TEXTO_CHAT)
    if (!texto) return erro('Escreva alguma coisa.')
    const pid = body.processo_id ? String(body.processo_id) : null
    let numero = null
    if (pid) {
      const p = await q1('select numero from inove.v_processos where id = $1', [pid])
      if (!p) return erro('Processo não encontrado.', 404)
      numero = p.numero
    }
    const r = await q1(
      `insert into inove.chat (processo_id, processo_numero, acesso_id, autor_tipo, autor_nome, texto)
       values ($1,$2,$3,'inove',$4,$5) returning *`,
      [pid, numero, acesso.id, acesso.nome || acesso.email, texto])
    return Response.json({ ok: true, mensagem: r })
  }

  /* ---------- os 5 acessos, administrados por eles ----------
     O acesso do desenvolvedor tem oculto = true e não aparece aqui: é conta de
     manutenção, não de usuário, e listá-la só geraria pergunta. Ele também não
     conta na cota nem pode ser mexido por eles. */
  if (acao === 'acessos') {
    const linhas = await q(
      `select id, nome, email, ativo, criado_em, primeiro_login_em, ultimo_login_em, bloqueado_em
         from inove.acessos where oculto = false order by nome`)
    const c = await config()
    return Response.json({ ok: true, acessos: linhas, limite: num(c, 'limite_acessos', 5) })
  }

  if (acao === 'acesso_criar') {
    const nome = String(body.nome || '').trim()
    const email = String(body.email || '').trim().toLowerCase()
    const senha = String(body.senha || '')
    if (!nome) return erro('Informe o nome.')
    if (!RE_EMAIL.test(email)) return erro('E-mail inválido.')
    if (senha.length < 8) return erro('A senha precisa de pelo menos 8 caracteres.')

    const c = await config()
    const limite = num(c, 'limite_acessos', 5)
    const atuais = await q1('select count(*)::int n from inove.acessos where oculto = false and ativo')
    if (atuais.n >= limite) {
      return erro('Vocês já têm os ' + limite + ' acessos do plano. Desative um antes de criar outro.', 409)
    }
    const existe = await q1('select 1 from inove.acessos where email = $1', [email])
    if (existe) return erro('Já existe um acesso com esse e-mail.', 409)

    const r = await q1(
      `insert into inove.acessos (nome, email, senha_hash, criado_por)
       values ($1,$2,$3,$4) returning id, nome, email, ativo, criado_em`,
      [nome, email, hashSenha(senha), acesso.email])
    return Response.json({ ok: true, acesso: r })
  }

  if (acao === 'acesso_editar') {
    const id = String(body.id || '')
    const alvo = await q1('select * from inove.acessos where id = $1 and oculto = false', [id])
    if (!alvo) return erro('Acesso não encontrado.', 404)
    const nome = body.nome !== undefined ? String(body.nome).trim() : alvo.nome
    if (!nome) return erro('Informe o nome.')
    if (body.senha) {
      if (String(body.senha).length < 8) return erro('A senha precisa de pelo menos 8 caracteres.')
      await q('update inove.acessos set nome = $1, senha_hash = $2 where id = $3', [nome, hashSenha(String(body.senha)), id])
      await q('delete from inove.sessoes where acesso_id = $1', [id]) // troca de senha derruba sessão
    } else {
      await q('update inove.acessos set nome = $1 where id = $2', [nome, id])
    }
    return Response.json({ ok: true })
  }

  if (acao === 'acesso_desativar') {
    const id = String(body.id || '')
    if (id === acesso.id) return erro('Você não pode desativar o próprio acesso.')
    const alvo = await q1('select * from inove.acessos where id = $1 and oculto = false', [id])
    if (!alvo) return erro('Acesso não encontrado.', 404)
    const ativar = body.ativar === true
    await q('update inove.acessos set ativo = $1 where id = $2', [ativar, id])
    if (!ativar) await q('delete from inove.sessoes where acesso_id = $1', [id])
    return Response.json({ ok: true, ativo: ativar })
  }

  /* ---------- o que já existia no portal antigo, mantido ---------- */
  if (acao === 'tribunais') {
    const linhas = await q('select * from inove.v_tribunais order by uf, tribunal')
    return Response.json({ ok: true, tribunais: linhas })
  }

  if (acao === 'tribunal_marcar') {
    const ok = await q1('select inove.marcar_tribunal($1,$2,$3) as ok',
      [String(body.id || ''), body.situacao || null, body.obs === undefined ? null : String(body.obs)])
    if (!ok || !ok.ok) return erro('Tribunal não encontrado.', 404)
    return Response.json({ ok: true })
  }

  if (acao === 'solicitacoes') {
    const linhas = await q('select * from inove.v_solicitacoes order by criado_em desc limit 300')
    return Response.json({ ok: true, solicitacoes: linhas })
  }

  if (acao === 'solicitar') {
    try {
      const r = await q1('select inove.pedir_funcionalidade($1,$2,$3) as id',
        [String(body.titulo || ''), String(body.descricao || ''), acesso.nome || acesso.email])
      await alertarEscritorio(
        'Inove: novo pedido de funcionalidade',
        (acesso.nome || acesso.email) + ' pediu: ' + String(body.titulo || '') + '\n\n' + String(body.descricao || ''))
      return Response.json({ ok: true, id: r && r.id })
    } catch (e) {
      return erro('Não foi possível enviar: ' + ((e && e.message) || e))
    }
  }

  return erro('Ação desconhecida.')
}

/* ---------- GET: entrega o documento já carimbado ---------- */
export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const docId = searchParams.get('doc')
  if (!docId) return erro('Informe o documento.')

  // o token vem na URL porque o navegador abre o PDF numa aba, sem cabeçalho
  const acesso = await sessao(searchParams.get('t') || '')
  if (!acesso) return erro('Sessão expirada. Entre de novo.', 401)

  const d = await lerDocumento(docId)
  if (!d) return erro('Documento não encontrado ou fora dos processos da Inove.', 404)
  d.id = docId

  const baixar = searchParams.get('dl') === '1'
  await logDoc(acesso, d, baixar ? 'baixou' : 'abriu', request)

  let buf = d.buf
  let mime = tipoRealDoArquivo(buf, d.doc_tipo, d.doc_nome)

  // texto que na origem era PDF: vira PDF de novo, para poder receber a tarja
  if (mime === 'text/plain' && String(d.doc_tipo || '').indexOf('pdf') > -1) {
    try { buf = await pdfDeTexto(buf.toString('utf8'), d.doc_nome); mime = 'application/pdf' } catch (e) {}
  }

  if (mime === 'application/pdf') {
    try {
      buf = await carimbarPdf(buf, etiquetaTarja(acesso, d))
    } catch (e) {
      // PDF que o pdf-lib não consegue reabrir (cifrado, malformado) não pode sair
      // sem tarja: o log até registra, mas a cópia circularia anônima.
      return erro('Este documento não pôde ser preparado para exibição. O escritório foi avisado.', 502)
    }
  }

  const nome = (d.doc_nome || 'documento').replace(/[^\w.\- ]+/g, '_')
  return new Response(buf, {
    headers: {
      'Content-Type': mime,
      'Content-Disposition': (baixar ? 'attachment' : 'inline') + '; filename="' + nome + (/\.\w+$/.test(nome) ? '' : '.pdf') + '"',
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
}
