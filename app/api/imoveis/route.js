// API do site do corretor (djan.net.br) — separada da CMP: schema/role próprios
// (imoveis_app, sem privilégio no `public`). Ver ops/PROJETO-CORRETOR-IMOVEIS.md.
//
//   GET  /api/imoveis?secao=perfil
//   GET  /api/imoveis?secao=imoveis[&tipo=proprio|parceria][&destaque=1]
//   GET  /api/imoveis?secao=imovel&id=<uuid>
//   GET  /api/imoveis?secao=anuncios
//   POST {acao:'lead', tipo, nome, telefone, email, imovel_id?, endereco_imovel?, mensagem?}
//   POST {acao:'login', senha}                    -> { ok, token }
//   POST {acao:'sair'}                             (Bearer)
//   POST {acao:'perfil_salvar', ...campos}         (Bearer)
//   POST {acao:'imovel_salvar', ...campos}         (Bearer) -> upsert (com id = edita)
//   POST {acao:'imovel_excluir', id}               (Bearer)
//   POST {acao:'anuncio_salvar', ...campos}        (Bearer) -> upsert
//   POST {acao:'anuncio_excluir', id}              (Bearer)
//   POST {acao:'leads'}                            (Bearer) -> lista
//   POST {acao:'lead_status', id, status}          (Bearer)

import { q, q1, confereSenha, sessaoValida, tokenDo, ip, podeTentar, marcaTentativa, erro, SESSAO_DIAS } from './lib.js'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TIPOS_LEAD = ['avaliacao', 'imovel', 'parceria', 'contato']

async function exigeAdmin(request) {
  const token = tokenDo(request)
  if (!(await sessaoValida(token))) return null
  return token
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const secao = searchParams.get('secao')

  if (secao === 'perfil') {
    const p = await q1('select * from imoveis.perfil where id = 1')
    return Response.json({ perfil: p })
  }

  if (secao === 'imoveis') {
    const tipo = searchParams.get('tipo')
    const cond = ["status = 'ativo'"]
    const params = []
    if (tipo === 'proprio' || tipo === 'parceria') { params.push(tipo); cond.push(`tipo = $${params.length}`) }
    if (searchParams.get('destaque') === '1') cond.push('destaque = true')
    const lista = await q(
      `select * from imoveis.imoveis where ${cond.join(' and ')} order by destaque desc, criado_em desc`,
      params)
    return Response.json({ imoveis: lista })
  }

  if (secao === 'imovel') {
    const id = searchParams.get('id') || ''
    if (!RE_UUID.test(id)) return erro('Imóvel não encontrado.', 404)
    const im = await q1('select * from imoveis.imoveis where id = $1', [id])
    if (!im) return erro('Imóvel não encontrado.', 404)
    return Response.json({ imovel: im })
  }

  if (secao === 'anuncios') {
    const lista = await q('select * from imoveis.anuncios where ativo = true order by criado_em desc')
    return Response.json({ anuncios: lista })
  }

  return erro('Seção inválida.', 404)
}

export async function POST(request) {
  let body = {}
  try { body = await request.json() } catch (e) {}
  const acao = String(body.acao || '')

  /* ---------- lead público (avaliação, interesse em imóvel, parceria, contato) ---------- */
  if (acao === 'lead') {
    const tipo = String(body.tipo || '')
    const nome = String(body.nome || '').trim()
    if (!TIPOS_LEAD.includes(tipo)) return erro('Tipo de solicitação inválido.')
    if (!nome) return erro('Informe seu nome.')
    if (!String(body.telefone || '').trim() && !String(body.email || '').trim()) {
      return erro('Informe telefone ou e-mail para contato.')
    }
    const chave = 'lead|' + (ip(request) || 'sem-ip')
    if (!podeTentar(chave)) return erro('Muitas solicitações. Tente novamente em alguns minutos.', 429)
    marcaTentativa(chave)

    let imovelId = null
    if (body.imovel_id && RE_UUID.test(String(body.imovel_id))) imovelId = String(body.imovel_id)

    await q(
      `insert into imoveis.leads (tipo, nome, telefone, email, imovel_id, endereco_imovel, mensagem, ip)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [tipo, nome, String(body.telefone || '').trim() || null, String(body.email || '').trim() || null,
       imovelId, String(body.endereco_imovel || '').trim() || null, String(body.mensagem || '').trim() || null,
       ip(request)])

    return Response.json({ ok: true })
  }

  /* ---------- login do admin (único usuário) ---------- */
  if (acao === 'login') {
    const senha = String(body.senha || '')
    if (!senha) return erro('Informe a senha.')
    const chave = 'login|' + (ip(request) || 'sem-ip')
    if (!podeTentar(chave)) return erro('Muitas tentativas. Aguarde 10 minutos.', 429)

    const hash = process.env.IMOVEIS_ADMIN_SENHA_HASH || ''
    if (!hash || !confereSenha(senha, hash)) {
      marcaTentativa(chave)
      return erro('Senha incorreta.', 401)
    }

    const token = crypto.randomBytes(24).toString('hex')
    await q(
      `insert into imoveis.sessoes (token, expira_em, ip)
       values ($1, now() + ($2 || ' days')::interval, $3)`,
      [token, String(SESSAO_DIAS), ip(request)])
    return Response.json({ ok: true, token })
  }

  if (acao === 'sair') {
    const token = tokenDo(request)
    if (token) { try { await q('delete from imoveis.sessoes where token = $1', [token]) } catch (e) {} }
    return Response.json({ ok: true })
  }

  /* ---------- a partir daqui, todas as ações exigem sessão do admin ---------- */
  if (!(await exigeAdmin(request))) return erro('Sessão inválida ou expirada.', 401)

  if (acao === 'perfil_salvar') {
    const campos = ['nome', 'titulo', 'creci', 'cnai', 'bio', 'telefone', 'whatsapp', 'email', 'instagram', 'foto_url']
    const sets = []
    const params = []
    for (const c of campos) {
      if (body[c] === undefined) continue
      params.push(String(body[c] ?? '').trim() || null)
      sets.push(`${c} = $${params.length}`)
    }
    if (!sets.length) return erro('Nada para salvar.')
    sets.push('atualizado_em = now()')
    await q(`update imoveis.perfil set ${sets.join(', ')} where id = 1`, params)
    const p = await q1('select * from imoveis.perfil where id = 1')
    return Response.json({ ok: true, perfil: p })
  }

  if (acao === 'imovel_salvar') {
    const tipo = String(body.tipo || '')
    const finalidade = String(body.finalidade || '')
    const titulo = String(body.titulo || '').trim()
    if (!['proprio', 'parceria'].includes(tipo)) return erro('Tipo inválido.')
    if (!['venda', 'aluguel'].includes(finalidade)) return erro('Finalidade inválida.')
    if (!titulo) return erro('Informe um título.')

    const campos = {
      tipo, finalidade, titulo,
      descricao: body.descricao ?? null,
      categoria: body.categoria ?? null,
      preco: body.preco !== undefined && body.preco !== '' ? Number(body.preco) : null,
      endereco: body.endereco ?? null,
      bairro: body.bairro ?? null,
      cidade: body.cidade ?? null,
      uf: body.uf ?? null,
      quartos: body.quartos !== undefined && body.quartos !== '' ? parseInt(body.quartos, 10) : null,
      banheiros: body.banheiros !== undefined && body.banheiros !== '' ? parseInt(body.banheiros, 10) : null,
      vagas: body.vagas !== undefined && body.vagas !== '' ? parseInt(body.vagas, 10) : null,
      area_util: body.area_util !== undefined && body.area_util !== '' ? Number(body.area_util) : null,
      area_total: body.area_total !== undefined && body.area_total !== '' ? Number(body.area_total) : null,
      fotos: JSON.stringify(Array.isArray(body.fotos) ? body.fotos : []),
      destaque: !!body.destaque,
      status: ['ativo', 'inativo', 'vendido', 'alugado'].includes(body.status) ? body.status : 'ativo',
      parceiro_nome: body.parceiro_nome ?? null,
      parceiro_contato: body.parceiro_contato ?? null,
    }

    if (body.id && RE_UUID.test(String(body.id))) {
      const nomes = Object.keys(campos)
      const params = nomes.map(n => campos[n])
      params.push(String(body.id))
      const sets = nomes.map((n, i) => `${n} = $${i + 1}`).join(', ')
      await q(`update imoveis.imoveis set ${sets}, atualizado_em = now() where id = $${params.length}`, params)
      const im = await q1('select * from imoveis.imoveis where id = $1', [body.id])
      return Response.json({ ok: true, imovel: im })
    } else {
      const nomes = Object.keys(campos)
      const params = nomes.map(n => campos[n])
      const cols = nomes.join(', ')
      const marcas = nomes.map((_, i) => `$${i + 1}`).join(', ')
      const im = await q1(`insert into imoveis.imoveis (${cols}) values (${marcas}) returning *`, params)
      return Response.json({ ok: true, imovel: im })
    }
  }

  if (acao === 'imovel_excluir') {
    if (!RE_UUID.test(String(body.id || ''))) return erro('Imóvel inválido.')
    await q('delete from imoveis.imoveis where id = $1', [body.id])
    return Response.json({ ok: true })
  }

  if (acao === 'anuncio_salvar') {
    const titulo = String(body.titulo || '').trim()
    if (!titulo) return erro('Informe um título.')
    const campos = {
      titulo,
      descricao: body.descricao ?? null,
      link_externo: body.link_externo ?? null,
      imagem_url: body.imagem_url ?? null,
      anunciante_nome: body.anunciante_nome ?? null,
      anunciante_contato: body.anunciante_contato ?? null,
      ativo: body.ativo === undefined ? true : !!body.ativo,
    }
    if (body.id && RE_UUID.test(String(body.id))) {
      const nomes = Object.keys(campos)
      const params = nomes.map(n => campos[n])
      params.push(String(body.id))
      const sets = nomes.map((n, i) => `${n} = $${i + 1}`).join(', ')
      await q(`update imoveis.anuncios set ${sets} where id = $${params.length}`, params)
      const a = await q1('select * from imoveis.anuncios where id = $1', [body.id])
      return Response.json({ ok: true, anuncio: a })
    } else {
      const nomes = Object.keys(campos)
      const params = nomes.map(n => campos[n])
      const cols = nomes.join(', ')
      const marcas = nomes.map((_, i) => `$${i + 1}`).join(', ')
      const a = await q1(`insert into imoveis.anuncios (${cols}) values (${marcas}) returning *`, params)
      return Response.json({ ok: true, anuncio: a })
    }
  }

  if (acao === 'anuncio_excluir') {
    if (!RE_UUID.test(String(body.id || ''))) return erro('Anúncio inválido.')
    await q('delete from imoveis.anuncios where id = $1', [body.id])
    return Response.json({ ok: true })
  }

  if (acao === 'leads') {
    const lista = await q('select * from imoveis.leads order by criado_em desc limit 300')
    return Response.json({ leads: lista })
  }

  if (acao === 'lead_status') {
    if (!RE_UUID.test(String(body.id || ''))) return erro('Lead inválido.')
    if (!['novo', 'em_andamento', 'concluido'].includes(body.status)) return erro('Status inválido.')
    await q('update imoveis.leads set status = $1 where id = $2', [body.status, body.id])
    return Response.json({ ok: true })
  }

  /* ---------- imóveis próprios em destaque, todos os imóveis (uso interno do painel) ---------- */
  if (acao === 'imoveis_todos') {
    const lista = await q('select * from imoveis.imoveis order by criado_em desc')
    return Response.json({ imoveis: lista })
  }

  return erro('Ação inválida.', 404)
}
