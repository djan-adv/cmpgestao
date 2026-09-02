// API do site do corretor (djan.net.br) — separada da CMP: schema/role próprios
// (imoveis_app, sem privilégio no `public`). Ver ops/PROJETO-CORRETOR-IMOVEIS.md.
//
// Portal tipo OLX: o dono do imóvel (anunciante) se cadastra, publica o próprio
// anúncio (tipo='terceiro') aceitando o termo de autorização/intermediação, e o
// anúncio entra como 'pendente' até o Djan aprovar. Impulsionar (destaque) é pago
// por fora por enquanto — o admin liga manualmente depois de confirmar o pagamento.
//
//   GET  /api/imoveis?secao=perfil
//   GET  /api/imoveis?secao=imoveis[&tipo=proprio|parceria|terceiro][&destaque=1]
//   GET  /api/imoveis?secao=imovel&id=<uuid>
//   GET  /api/imoveis?secao=anuncios
//   GET  /api/imoveis?secao=termo                 -> termo de autorização vigente
//   POST {acao:'lead', tipo, nome, telefone, email, imovel_id?, endereco_imovel?, mensagem?}
//     tipo: avaliacao | imovel | parceria | contato | certidao (certidão do imóvel, R$ 360, cobrança manual)
//   POST {acao:'anunciante_cadastro', nome, telefone, email, senha, papel?}  -> { ok, token }
//     papel: 'proprietario' (padrão, publica tipo='terceiro') | 'corretor' (publica tipo='parceria')
//   POST {acao:'anunciante_login', email, senha}                     -> { ok, token }
//   POST {acao:'anunciante_sair'}                                    (Bearer anunciante)
//   POST {acao:'anunciante_meus_anuncios'}                           (Bearer anunciante)
//   POST {acao:'anunciante_imovel_salvar', ...campos, termo_aceito}  (Bearer anunciante)
//   POST {acao:'anunciante_imovel_excluir', id}                      (Bearer anunciante)
//   POST {acao:'login', senha}                    -> { ok, token }     (admin)
//   POST {acao:'sair'}                             (Bearer admin)
//   POST {acao:'perfil_salvar', ...campos}         (Bearer admin)
//   POST {acao:'imovel_salvar', ...campos}         (Bearer admin) -> upsert (com id = edita)
//   POST {acao:'imovel_excluir', id}               (Bearer admin)
//   POST {acao:'anuncio_salvar', ...campos}        (Bearer admin) -> upsert
//   POST {acao:'anuncio_excluir', id}              (Bearer admin)
//   POST {acao:'termo_salvar', texto, versao}      (Bearer admin)
//   POST {acao:'leads'}                            (Bearer admin) -> lista
//   POST {acao:'lead_status', id, status}          (Bearer admin)

import {
  q, q1, hashSenha, confereSenha, sessaoAdminValida, sessaoAnunciante, tokenDo,
  ip, podeTentar, marcaTentativa, erro, SESSAO_DIAS,
} from './lib.js'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RE_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const TIPOS_LEAD = ['avaliacao', 'imovel', 'parceria', 'contato', 'certidao']

async function exigeAdmin(request) {
  const token = tokenDo(request)
  if (!(await sessaoAdminValida(token))) return null
  return token
}

async function exigeAnunciante(request) {
  return await sessaoAnunciante(tokenDo(request))
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
    if (['proprio', 'parceria', 'terceiro'].includes(tipo)) { params.push(tipo); cond.push(`tipo = $${params.length}`) }
    if (searchParams.get('destaque') === '1') cond.push('destaque = true')
    const lista = await q(
      `select * from imoveis.imoveis where ${cond.join(' and ')} order by destaque desc, criado_em desc`,
      params)
    return Response.json({ imoveis: lista })
  }

  if (secao === 'termo') {
    const t = await q1('select versao, texto, atualizado_em from imoveis.termo where id = 1')
    return Response.json({ termo: t })
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

  /* ---------- cadastro e login do anunciante (dono do imóvel ou corretor parceiro) ---------- */
  if (acao === 'anunciante_cadastro') {
    const nome = String(body.nome || '').trim()
    const email = String(body.email || '').trim().toLowerCase()
    const senha = String(body.senha || '')
    const papel = ['proprietario', 'corretor'].includes(body.papel) ? body.papel : 'proprietario'
    if (!nome) return erro('Informe seu nome.')
    if (!RE_EMAIL.test(email)) return erro('Informe um e-mail válido.')
    if (senha.length < 6) return erro('A senha precisa ter pelo menos 6 caracteres.')

    const existe = await q1('select id from imoveis.anunciantes where email = $1', [email])
    if (existe) return erro('Já existe um cadastro com este e-mail. Faça login.', 409)

    const a = await q1(
      `insert into imoveis.anunciantes (nome, telefone, email, senha_hash, papel)
       values ($1,$2,$3,$4,$5) returning id, nome, email`,
      [nome, String(body.telefone || '').trim() || null, email, hashSenha(senha), papel])

    const token = crypto.randomBytes(24).toString('hex')
    await q(
      `insert into imoveis.anunciante_sessoes (token, anunciante_id, expira_em, ip)
       values ($1, $2, now() + ($3 || ' days')::interval, $4)`,
      [token, a.id, String(SESSAO_DIAS), ip(request)])
    return Response.json({ ok: true, token, nome: a.nome })
  }

  if (acao === 'anunciante_login') {
    const email = String(body.email || '').trim().toLowerCase()
    const senha = String(body.senha || '')
    if (!RE_EMAIL.test(email) || !senha) return erro('Informe e-mail e senha.')
    const chave = 'anun-login|' + (ip(request) || 'sem-ip') + '|' + email
    if (!podeTentar(chave)) return erro('Muitas tentativas. Aguarde 10 minutos.', 429)

    const a = await q1('select * from imoveis.anunciantes where email = $1', [email])
    if (!a || !confereSenha(senha, a.senha_hash)) {
      marcaTentativa(chave)
      return erro('E-mail ou senha incorretos.', 401)
    }
    if (!a.ativo) return erro('Este cadastro foi desativado.', 403)

    const token = crypto.randomBytes(24).toString('hex')
    await q(
      `insert into imoveis.anunciante_sessoes (token, anunciante_id, expira_em, ip)
       values ($1, $2, now() + ($3 || ' days')::interval, $4)`,
      [token, a.id, String(SESSAO_DIAS), ip(request)])
    return Response.json({ ok: true, token, nome: a.nome })
  }

  if (acao === 'anunciante_sair') {
    const token = tokenDo(request)
    if (token) { try { await q('delete from imoveis.anunciante_sessoes where token = $1', [token]) } catch (e) {} }
    return Response.json({ ok: true })
  }

  if (acao === 'anunciante_meus_anuncios') {
    const anunciante = await exigeAnunciante(request)
    if (!anunciante) return erro('Sessão inválida ou expirada.', 401)
    const lista = await q('select * from imoveis.imoveis where anunciante_id = $1 order by criado_em desc', [anunciante.id])
    return Response.json({ imoveis: lista })
  }

  if (acao === 'anunciante_imovel_salvar') {
    const anunciante = await exigeAnunciante(request)
    if (!anunciante) return erro('Sessão inválida ou expirada.', 401)

    const finalidade = String(body.finalidade || '')
    const titulo = String(body.titulo || '').trim()
    if (!['venda', 'aluguel'].includes(finalidade)) return erro('Finalidade inválida.')
    if (!titulo) return erro('Informe um título.')

    const campos = {
      finalidade, titulo,
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
      video_url: String(body.video_url || '').trim() || null,
    }

    if (body.id && RE_UUID.test(String(body.id))) {
      const dono = await q1('select id from imoveis.imoveis where id = $1 and anunciante_id = $2', [body.id, anunciante.id])
      if (!dono) return erro('Anúncio não encontrado.', 404)
      const nomes = Object.keys(campos)
      const params = nomes.map(n => campos[n])
      params.push(String(body.id))
      const sets = nomes.map((n, i) => `${n} = $${i + 1}`).join(', ')
      await q(`update imoveis.imoveis set ${sets}, atualizado_em = now() where id = $${params.length}`, params)
      const im = await q1('select * from imoveis.imoveis where id = $1', [body.id])
      return Response.json({ ok: true, imovel: im })
    }

    // anúncio novo: exige aceite do termo vigente
    if (!body.termo_aceito) return erro('É preciso aceitar o termo de autorização para publicar o anúncio.')
    const termo = await q1('select versao from imoveis.termo where id = 1')
    const versao = termo?.versao || 'v1'

    // corretor de outra imobiliária publicando = parceria; dono do imóvel = terceiro
    campos.tipo = anunciante.papel === 'corretor' ? 'parceria' : 'terceiro'
    campos.anunciante_id = anunciante.id
    campos.status = 'pendente'
    campos.destaque = false
    campos.termo_versao = versao
    campos.termo_aceito_em = new Date().toISOString()
    if (anunciante.papel === 'corretor') {
      campos.parceiro_nome = anunciante.nome
      campos.parceiro_contato = anunciante.telefone || anunciante.email
    }

    const nomes = Object.keys(campos)
    const params = nomes.map(n => campos[n])
    const cols = nomes.join(', ')
    const marcas = nomes.map((_, i) => `$${i + 1}`).join(', ')
    const im = await q1(`insert into imoveis.imoveis (${cols}) values (${marcas}) returning *`, params)

    await q(
      `insert into imoveis.termo_aceites (anunciante_id, imovel_id, versao, ip) values ($1,$2,$3,$4)`,
      [anunciante.id, im.id, versao, ip(request)])

    return Response.json({ ok: true, imovel: im })
  }

  if (acao === 'anunciante_imovel_excluir') {
    const anunciante = await exigeAnunciante(request)
    if (!anunciante) return erro('Sessão inválida ou expirada.', 401)
    if (!RE_UUID.test(String(body.id || ''))) return erro('Anúncio inválido.')
    await q('delete from imoveis.imoveis where id = $1 and anunciante_id = $2', [body.id, anunciante.id])
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
    if (!['proprio', 'parceria', 'terceiro'].includes(tipo)) return erro('Tipo inválido.')
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
      video_url: String(body.video_url || '').trim() || null,
      destaque: !!body.destaque,
      destaque_ate: body.destaque_ate || null,
      status: ['pendente', 'ativo', 'inativo', 'rejeitado', 'vendido', 'alugado'].includes(body.status) ? body.status : 'ativo',
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

  /* ---------- todos os imóveis, com dados do anunciante quando for de terceiro ---------- */
  if (acao === 'imoveis_todos') {
    const lista = await q(
      `select i.*, a.nome as anunciante_nome_conta, a.email as anunciante_email, a.telefone as anunciante_telefone_conta
         from imoveis.imoveis i
         left join imoveis.anunciantes a on a.id = i.anunciante_id
        order by (i.status = 'pendente') desc, i.criado_em desc`)
    return Response.json({ imoveis: lista })
  }

  if (acao === 'termo_salvar') {
    const texto = String(body.texto || '')
    const versao = String(body.versao || '').trim()
    if (!texto.trim()) return erro('Informe o texto do termo.')
    if (!versao) return erro('Informe a versão do termo.')
    await q('update imoveis.termo set texto = $1, versao = $2, atualizado_em = now() where id = 1', [texto, versao])
    const t = await q1('select * from imoveis.termo where id = 1')
    return Response.json({ ok: true, termo: t })
  }

  return erro('Ação inválida.', 404)
}
