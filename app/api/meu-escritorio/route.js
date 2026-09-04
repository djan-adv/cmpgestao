// O cadastro do próprio escritório, editado por quem contratou.
//
// É a peça que faltava para o sistema deixar de ser "de um escritório só": o
// nome que aparece na tela, e principalmente os dados que entram na PROCURAÇÃO
// e no CONTRATO que o cliente dele assina — nome do advogado, OAB, sociedade,
// CNPJ, endereço. Enquanto isso estava escrito no código, o cliente de um
// escritório assinava procuração nomeando o advogado de outro.
//
//   GET  /api/meu-escritorio   -> devolve o cadastro (qualquer pessoa do escritório)
//   POST /api/meu-escritorio   -> grava (só contratante ou sócio)
//
// O que NÃO se edita aqui, de propósito: plano, limites, endereço de acesso e
// módulos. Isso é contrato — muda no painel de quem vende, não no do cliente.

import { createClient } from '@supabase/supabase-js'
import { usuarioDoRequest, escritorioDoUsuario, semEscritorio } from '../_lib/inquilino.js'
import { chaveCifra, contaDeEnvio } from '../_lib/smtp.js'
import nodemailer from 'nodemailer'

export const dynamic = 'force-dynamic'

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })
}

// Campos aceitos. Lista fechada: sem isso, qualquer chave enviada pelo
// navegador entraria no cadastro e apareceria nos documentos.
const CAMPOS = [
  'socio_nome', 'socio_oab', 'socio_nacionalidade', 'socio_estado_civil', 'socio_cpf',
  'nome_sociedade', 'oab_sociedade', 'cnpj',
  'endereco', 'cidade', 'uf', 'cep',
  'telefone', 'whatsapp', 'email', 'site',
]

export async function GET(request) {
  const user = await usuarioDoRequest(request)
  if (!user) return Response.json({ erro: 'não autenticado' }, { status: 401 })
  const esc = await escritorioDoUsuario(user.id)
  if (!esc) return semEscritorio()

  const sb = admin()
  const { data } = await sb.from('escritorios')
    .select('id,nome,raiz,marca,dados,oabs,modulos,plano_codigo,limite_acessos,limite_processos,limite_gb,mensalidade')
    .eq('id', esc).maybeSingle()
  if (!data) return Response.json({ erro: 'escritório não encontrado' }, { status: 404 })

  const { data: perfil } = await sb.from('usuarios').select('papel').eq('id', user.id).maybeSingle()
  const podeEditar = ['contratante', 'socio'].includes(String(perfil?.papel || ''))

  const { count: usoProc } = await sb.from('processos').select('id', { count: 'exact', head: true }).eq('escritorio_id', esc)
  const { count: usoAcc } = await sb.from('usuarios').select('id', { count: 'exact', head: true }).eq('escritorio_id', esc)

  return Response.json({
    ok: true,
    pode_editar: podeEditar,
    escritorio: {
      id: data.id, nome: data.nome, raiz: data.raiz,
      marca: data.marca || {}, dados: data.dados || {},
      // as inscrições que o robô do diário usa para varrer publicações
      oabs: data.oabs || [],
    },
    // conta de envio: nunca devolve a senha, só se existe e se o teste passou
    email_conta: await (async () => {
      const { data: sm } = await sb.from('escritorio_smtp')
        .select('host,porta,usuario,remetente_nome,imap_host,imap_porta,testado_ok,testado_em,testado_erro')
        .eq('escritorio_id', esc).maybeSingle()
      const mod = data.modulos || {}
      return {
        ...(sm || {}),
        tem_senha: !!sm,
        canal_liberado: data.raiz === true || mod.email === true,
      }
    })(),
    plano: {
      codigo: data.plano_codigo, mensalidade: data.mensalidade,
      limite_acessos: data.limite_acessos, limite_processos: data.limite_processos, limite_gb: data.limite_gb,
      uso_processos: usoProc || 0, uso_acessos: usoAcc || 0,
    },
  })
}

export async function POST(request) {
  const user = await usuarioDoRequest(request)
  if (!user) return Response.json({ erro: 'não autenticado' }, { status: 401 })
  const esc = await escritorioDoUsuario(user.id)
  if (!esc) return semEscritorio()

  const sb = admin()
  const { data: perfil } = await sb.from('usuarios').select('papel').eq('id', user.id).maybeSingle()
  if (!['contratante', 'socio'].includes(String(perfil?.papel || ''))) {
    return Response.json({ erro: 'Só o contratante ou um sócio altera o cadastro do escritório.' }, { status: 403 })
  }

  let body = {}
  try { body = await request.json() } catch (e) {}

  // ---- conta de e-mail do escritório -------------------------------------
  // Salvar não libera o envio: só o teste libera. Sem isso, o escritório
  // descobriria que a senha estava errada no dia em que perdesse um prazo
  // achando que tinha avisado a vara.
  if (body.acao === 'email_salvar' || body.acao === 'email_testar') {
    const key = chaveCifra()
    if (!key) return Response.json({ erro: 'Servidor sem chave de cifragem; não posso guardar a senha com segurança.' }, { status: 500 })

    if (body.acao === 'email_salvar') {
      const host = String(body.host || '').trim()
      const usuario = String(body.usuario || '').trim()
      if (!host || !usuario) return Response.json({ erro: 'Informe o servidor e o usuário.' }, { status: 400 })
      const { error } = await sb.rpc('smtp_set', {
        p_esc: esc, p_host: host, p_porta: parseInt(body.porta, 10) || 465,
        p_usuario: usuario, p_senha: String(body.senha || ''),
        p_nome: String(body.remetente_nome || '').slice(0, 80), p_key: key,
      })
      if (error) return Response.json({ erro: error.message }, { status: 500 })
      // servidor de LEITURA: host e porta não são segredo, então vão direto —
      // a senha continua sendo a mesma da conta, cifrada pela smtp_set acima
      await sb.from('escritorio_smtp').update({
        imap_host: String(body.imap_host || '').trim() || null,
        imap_porta: parseInt(body.imap_porta, 10) || null,
      }).eq('escritorio_id', esc)
      // guardar de novo derruba o canal até passar no teste outra vez: uma
      // troca de servidor com senha errada não pode continuar "liberada"
      const { data: e0 } = await sb.from('escritorios').select('modulos,raiz').eq('id', esc).maybeSingle()
      if (e0 && e0.raiz !== true) {
        await sb.from('escritorios').update({ modulos: { ...(e0.modulos || {}), email: false } }).eq('id', esc)
      }
      await sb.from('escritorio_smtp').update({ testado_ok: null, testado_em: null, testado_erro: null }).eq('escritorio_id', esc)
      return Response.json({ ok: true, precisa_testar: true })
    }

    // teste de verdade: manda um e-mail para o próprio usuário da conta
    const conta = await contaDeEnvio(esc, false)
    if (conta.erro) return Response.json({ erro: conta.erro }, { status: 400 })
    try {
      const t = nodemailer.createTransport({
        host: conta.host, port: conta.port, secure: conta.port === 465,
        auth: { user: conta.user, pass: conta.pass },
      })
      await t.sendMail({
        from: '"' + (conta.fromNome || 'Sistema') + '" <' + conta.user + '>',
        to: conta.user,
        subject: 'Teste de envio — configuração de e-mail do escritório',
        text: 'Se você recebeu esta mensagem, a conta de envio do escritório está funcionando e o envio pelo sistema foi liberado.',
      })
      await sb.from('escritorio_smtp').update({
        testado_ok: true, testado_em: new Date().toISOString(), testado_erro: null,
      }).eq('escritorio_id', esc)
      const { data: e1 } = await sb.from('escritorios').select('modulos').eq('id', esc).maybeSingle()
      await sb.from('escritorios').update({ modulos: { ...(e1?.modulos || {}), email: true } }).eq('id', esc)
      return Response.json({ ok: true, enviado_para: conta.user })
    } catch (e) {
      const msg = String((e && e.message) || e)
      await sb.from('escritorio_smtp').update({
        testado_ok: false, testado_em: new Date().toISOString(), testado_erro: msg.slice(0, 300),
      }).eq('escritorio_id', esc)
      return Response.json({ erro: 'O teste não passou: ' + msg }, { status: 400 })
    }
  }

  const patch = {}
  if (typeof body.nome === 'string' && body.nome.trim()) patch.nome = body.nome.trim().slice(0, 160)

  if (body.marca && typeof body.marca === 'object') {
    const { data: atual } = await sb.from('escritorios').select('marca').eq('id', esc).maybeSingle()
    const marcaAtual = atual?.marca || {}
    let logo = 'logo' in body.marca ? (String(body.marca.logo || '').slice(0, 500) || null) : (marcaAtual.logo || null)

    // Logo enviado como arquivo. Vai para o armazenamento e o cadastro guarda
    // só o endereço — imagem inteira dentro da linha do escritório deixaria
    // pesada toda consulta que lê o cadastro (e ele é lido a cada tela).
    if (body.logo_arquivo && typeof body.logo_arquivo === 'string') {
      const m = body.logo_arquivo.match(/^data:(image\/(png|jpe?g|webp|svg\+xml));base64,(.+)$/)
      if (!m) return Response.json({ erro: 'Envie o logo em PNG, JPG, WEBP ou SVG.' }, { status: 400 })
      const buf = Buffer.from(m[3], 'base64')
      if (buf.length > 1024 * 1024) return Response.json({ erro: 'O logo precisa ter no máximo 1 MB.' }, { status: 400 })
      const ext = m[2] === 'svg+xml' ? 'svg' : (m[2] === 'jpeg' ? 'jpg' : m[2])
      // nome novo a cada troca: com nome fixo, o navegador continuaria
      // mostrando o logo antigo por causa do cache
      const caminho = 'marcas/' + esc + '/logo-' + Date.now() + '.' + ext
      const up = await sb.storage.from('publico').upload(caminho, buf, { contentType: m[1], upsert: true })
      if (up.error) return Response.json({ erro: 'Não consegui guardar o logo: ' + up.error.message }, { status: 502 })
      const { data: pub } = sb.storage.from('publico').getPublicUrl(caminho)
      logo = (pub && pub.publicUrl) || null
    }

    patch.marca = {
      ...marcaAtual,
      sistema: String(body.marca.sistema || '').slice(0, 60) || null,
      cor: String(body.marca.cor || '').slice(0, 20) || null,
      logo,
    }
  }

  if (body.dados && typeof body.dados === 'object') {
    const { data: atual } = await sb.from('escritorios').select('dados').eq('id', esc).maybeSingle()
    const dados = { ...(atual?.dados || {}) }
    for (const c of CAMPOS) {
      if (c in body.dados) dados[c] = String(body.dados[c] == null ? '' : body.dados[c]).slice(0, 300)
    }
    patch.dados = dados
  }

  // OAB do escritório: é o que faz o robô do diário varrer as publicações
  // DELE. Sem isto, o escritório novo não recebe publicação nenhuma — e essa
  // era a única parte do sistema que ainda dependia de alguém do fornecedor
  // editar o banco à mão.
  if (Array.isArray(body.oabs)) {
    const limpas = []
    for (const o of body.oabs.slice(0, 20)) {
      const numero = String((o && o.numero) || '').replace(/\D/g, '').slice(0, 10)
      const uf = String((o && o.uf) || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2)
      if (numero && uf.length === 2) limpas.push({ numero, uf })
    }
    patch.oabs = limpas
  }

  if (!Object.keys(patch).length) return Response.json({ erro: 'nada a salvar' }, { status: 400 })

  const { error } = await sb.from('escritorios').update(patch).eq('id', esc)
  if (error) return Response.json({ erro: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
