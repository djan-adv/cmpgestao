// API do CMPGestão — gestão real de acessos (logins) do escritório.
//
// O motivo desta rota: a tela "Acessos" antes só editava uma lista visual na
// memória do navegador (via prompt) e NUNCA criava a conta de verdade no
// Supabase. Por isso pessoas como a Rita e o Jader "cadastravam" e depois não
// conseguiam entrar — a conta não existia. Aqui o coordenador realmente cria/
// altera a senha das contas, usando a chave secreta (service role) no servidor.
//
//   POST /api/acessos   (header Authorization: Bearer <jwt do Supabase>)
//   body: { acao, email, senha, nome, papel }
//     acao = 'salvar'    -> cria a conta (ou atualiza a senha se já existir)
//     acao = 'listar'    -> devolve os usuários do escritório (para refletir o real)
//     acao = 'desativar' -> bloqueia o login da pessoa
//     acao = 'ativar'    -> reativa o login
//     acao = 'renomear'  -> troca o nome exibido da conta
//
// Segurança:
//  - exige usuário autenticado (JWT do Supabase);
//  - exige que o solicitante seja CONTRATANTE (ou sócio) do próprio escritório;
//  - a chave secreta (SUPABASE_SERVICE_ROLE_KEY) fica só no servidor, no .env.local.
//
// Mudou em 03/09/2026 (versão de venda): quem manda nos acessos era uma lista de
// e-mails escrita no código (o do dono do sistema). Isso servia para um
// escritório só; com escritórios que compram o sistema, cada um precisa
// cadastrar a própria equipe sem depender do fornecedor. Agora vale o PAPEL:
// contratante manda no escritório dele, e em nenhum outro.
//
// Níveis: contratante (assinou o contrato) > socio > adv (advogado) >
// colaborador > est (estagiário). A senha sai provisória: quem cria não fica
// sabendo dela depois que a pessoa entra e troca.

import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'
import { enviarEmailConta } from '../_lib/email-conta.js'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Papéis que podem gerir acessos DO PRÓPRIO escritório.
const PAPEIS_QUE_MANDAM = ['contratante', 'socio']
// Papéis que um contratante pode criar. 'contratante' fica de fora de propósito:
// é um por escritório, criado junto com o escritório no painel-mãe.
const PAPEIS_QUE_PODE_CRIAR = ['socio', 'adv', 'colaborador', 'est', 'membro']

const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY

function admin() {
  // cliente com poderes de administrador (não guarda sessão)
  return createClient(SB_URL, SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })
}

async function coordenador(request) {
  const auth = request.headers.get('authorization') || ''
  const jwt = auth.replace(/^Bearer\s+/i, '')
  if (!jwt) return null
  const sb = createClient(SB_URL, ANON)
  const u = await sb.auth.getUser(jwt)
  const user = (u && u.data && u.data.user) || null
  if (!user) return null
  if (!(await ehCoordenador(user))) return null
  return user
}

// senha provisória legível ao telefone (sem 0/O e 1/l, que confundem ao ditar)
function senhaProvisoria() {
  const alfabeto = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const bytes = crypto.randomBytes(10)
  let s = ''
  for (let i = 0; i < 10; i++) s += alfabeto[bytes[i] % alfabeto.length]
  return s
}

// Manda nos acessos quem é contratante ou sócio — do próprio escritório.
// Antes isto era uma lista de nomes por expressão regular (/djan/, /jader/,
// /eduarda/): funcionava numa casa só e reprovava qualquer cliente novo.
async function ehCoordenador(user) {
  try {
    const sbA = createClient(SB_URL, SERVICE, { auth: { persistSession: false } })
    const { data } = await sbA.from('usuarios').select('papel').eq('id', user.id).maybeSingle()
    return !!(data && PAPEIS_QUE_MANDAM.includes(String(data.papel || '')))
  } catch (e) { return false }
}

// procura a conta pelo e-mail (varre as páginas de usuários — escritório pequeno)
async function acharPorEmail(sb, email) {
  const alvo = String(email || '').toLowerCase()
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await sb.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw new Error(error.message)
    const users = (data && data.users) || []
    const hit = users.find(x => String(x.email || '').toLowerCase() === alvo)
    if (hit) return hit
    if (users.length < 200) break
  }
  return null
}

export async function POST(request) {
  if (!SERVICE) {
    return Response.json({
      erro: 'A chave de administrador (SUPABASE_SERVICE_ROLE_KEY) não está configurada no servidor. ' +
            'Adicione-a no arquivo .env.local do sistema e publique novamente.'
    }, { status: 500 })
  }

  const coord = await coordenador(request)
  if (!coord) return Response.json({ erro: 'Sem permissão para gerenciar acessos.' }, { status: 403 })

  let body = {}
  try { body = await request.json() } catch (e) {}
  const acao = String(body.acao || 'salvar')
  const sb = admin()

  // escritório do coordenador (todo mundo que ele cria entra no mesmo escritório)
  const { data: pf } = await sb.from('usuarios').select('escritorio_id').eq('id', coord.id).single()
  const esc = pf && pf.escritorio_id
  if (!esc && acao === 'salvar') {
    return Response.json({ erro: 'Escritório do coordenador não encontrado.' }, { status: 500 })
  }

  try {
    if (acao === 'listar') {
      const { data, error } = await sb.from('usuarios').select('id,nome,email,papel,escritorio_id,so_privado').eq('escritorio_id', esc)
      if (error) throw new Error(error.message)
      // marca quem está bloqueado (desativado)
      const lista = data || []
      let banned = {}
      try {
        for (let page = 1; page <= 20; page++) {
          const r = await sb.auth.admin.listUsers({ page, perPage: 200 })
          const users = (r.data && r.data.users) || []
          users.forEach(u => { banned[String(u.email || '').toLowerCase()] = !!(u.banned_until && new Date(u.banned_until) > new Date(0)) })
          if (users.length < 200) break
        }
      } catch (e) {}
      const usuarios = lista.map(u => ({ ...u, ativo: !banned[String(u.email || '').toLowerCase()] }))
      return Response.json({ ok: true, usuarios })
    }

    const email = String(body.email || '').trim().toLowerCase()
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return Response.json({ erro: 'E-mail inválido.' }, { status: 400 })
    }

    if (acao === 'salvar') {
      const nome = String(body.nome || '').trim() || null
      const papel = String(body.papel || 'colaborador').trim() || 'colaborador'
      if (!PAPEIS_QUE_PODE_CRIAR.includes(papel)) {
        return Response.json({ erro: 'Nível de acesso inválido: ' + papel }, { status: 400 })
      }

      const existente = await acharPorEmail(sb, email)

      // Uma pessoa pertence a UM escritório. Sem esta conferência, cadastrar um
      // e-mail que já existe em outro escritório mudaria o vínculo dele — e a
      // pessoa passaria a enxergar o acervo de quem a cadastrou por último.
      if (existente) {
        const { data: vinc } = await sb.from('usuarios').select('escritorio_id').eq('id', existente.id).maybeSingle()
        if (vinc && vinc.escritorio_id && vinc.escritorio_id !== esc) {
          return Response.json({ erro: 'Este e-mail já tem acesso em outro escritório.' }, { status: 409 })
        }
      }

      // Limite de assentos do plano. Conta só quem ainda não existe: renovar a
      // senha de quem já está dentro não consome assento novo.
      if (!existente) {
        const { data: plano } = await sb.from('escritorios').select('limite_acessos,nome').eq('id', esc).maybeSingle()
        const limite = plano && plano.limite_acessos
        if (limite != null) {
          const { count } = await sb.from('usuarios').select('id', { count: 'exact', head: true }).eq('escritorio_id', esc)
          if ((count || 0) >= limite) {
            return Response.json({
              erro: 'Seu plano tem ' + limite + ' acessos e todos estão em uso. Para incluir mais alguém, libere um acesso ou contrate acessos adicionais.',
              limite_atingido: true, limite, em_uso: count || 0,
            }, { status: 409 })
          }
        }
      }

      // Senha SEMPRE provisória e gerada aqui. Quem cadastra não escolhe (e não
      // fica sabendo) a senha definitiva de ninguém: no primeiro acesso o
      // sistema obriga a trocar. Era o contrário antes — o coordenador digitava
      // a senha da pessoa e ficava com ela.
      const senha = senhaProvisoria()
      let uid, criado
      if (existente) {
        const { error } = await sb.auth.admin.updateUserById(existente.id, { password: senha, email_confirm: true })
        if (error) throw new Error(error.message)
        uid = existente.id; criado = false
      } else {
        const { data, error } = await sb.auth.admin.createUser({ email, password: senha, email_confirm: true })
        if (error) throw new Error(error.message)
        uid = data.user.id; criado = true
      }
      const { error: eU } = await sb.from('usuarios').upsert(
        { id: uid, escritorio_id: esc, nome, email, papel, trocar_senha: true, ativo: true, criado_por: coord.id },
        { onConflict: 'id' })
      if (eU) throw new Error(eU.message)

      const envio = await enviarEmailConta({
        para: email,
        assunto: criado ? 'Seu acesso ao sistema' : 'Sua nova senha de acesso',
        titulo: criado ? 'Seu acesso está pronto' : 'Sua senha foi redefinida',
        linhas: [
          'Entre com o e-mail <b>' + email + '</b> e a senha provisória abaixo:',
          '<b style="font-size:22px;letter-spacing:2px">' + senha + '</b>',
          'No primeiro acesso o sistema pede uma senha nova, só sua.',
        ],
      })

      return Response.json({
        ok: true, criado, id: uid,
        // volta na tela porque o e-mail pode não sair e a pessoa estar do lado
        senha_provisoria: senha,
        email_enviado: !!envio.ok, email_erro: envio.erro || null,
      })
    }

    if (acao === 'desativar' || acao === 'ativar') {
      const u = await acharPorEmail(sb, email)
      if (!u) return Response.json({ erro: 'Conta não encontrada.' }, { status: 404 })
      // Ninguém desativa o contratante (o escritório ficaria sem quem manda) nem
      // a si mesmo (o clássico trancar a chave dentro de casa).
      const { data: alvo } = await sb.from('usuarios').select('papel,escritorio_id').eq('id', u.id).maybeSingle()
      if (!alvo || alvo.escritorio_id !== esc) return Response.json({ erro: 'Conta não encontrada.' }, { status: 404 })
      if (acao === 'desativar' && alvo.papel === 'contratante') {
        return Response.json({ erro: 'O acesso do contratante não pode ser desativado.' }, { status: 400 })
      }
      if (acao === 'desativar' && u.id === coord.id) {
        return Response.json({ erro: 'Você não pode desativar o seu próprio acesso.' }, { status: 400 })
      }
      const ban_duration = acao === 'desativar' ? '876000h' : 'none' // ~100 anos ou libera
      const { error } = await sb.auth.admin.updateUserById(u.id, { ban_duration })
      if (error) throw new Error(error.message)
      await sb.from('usuarios').update({ ativo: acao === 'ativar' }).eq('id', u.id)
      return Response.json({ ok: true })
    }

    // Fora do grupo do chat: além de não receber alarme, a pessoa deixa de LER
    // as mensagens sem destinatário — quem decide isso é a política de RLS de
    // chat_mensagens, que lê esta coluna. Por isso a marca vive em `usuarios`,
    // e não num JSON de configuração no navegador.
    // Apagar de vez. Desativar bloqueia o login mas mantém o vínculo — e é isso
    // que impede o mesmo e-mail de virar contratante de outro escritório
    // (uma pessoa pertence a UM escritório). Quem sai de verdade precisa sair
    // do cadastro, não só ficar cinza na lista.
    if (acao === 'apagar') {
      const u = await acharPorEmail(sb, email)
      const { data: alvo } = await sb.from('usuarios').select('id,papel,escritorio_id,nome').eq('email', email).maybeSingle()
      // fora do escritório de quem pede: não existe para ele
      if (!alvo || alvo.escritorio_id !== esc) {
        if (!u) return Response.json({ erro: 'Conta não encontrada.' }, { status: 404 })
        return Response.json({ erro: 'Esta conta não é do seu escritório.' }, { status: 403 })
      }
      if (alvo.papel === 'contratante') {
        return Response.json({ erro: 'O contratante não pode ser apagado — o escritório ficaria sem responsável.' }, { status: 400 })
      }
      if (alvo.id === coord.id) {
        return Response.json({ erro: 'Você não pode apagar o seu próprio acesso.' }, { status: 400 })
      }
      // A conta de autenticação leva junto a linha em usuarios e os lembretes
      // pessoais (as duas têm exclusão em cascata). O que a pessoa escreveu —
      // mensagens do chat, tarefas, visitas — FICA: o histórico do escritório
      // não some porque alguém saiu; só deixa de exibir o nome dela.
      if (u) {
        const { error } = await sb.auth.admin.deleteUser(u.id)
        if (error) throw new Error(error.message)
      } else {
        await sb.from('usuarios').delete().eq('id', alvo.id)
      }
      return Response.json({ ok: true, apagado: alvo.nome || email })
    }

    if (acao === 'so_privado') {
      const valor = body.valor !== false
      const { error } = await sb.from('usuarios').update({ so_privado: valor }).eq('email', email).eq('escritorio_id', esc)
      if (error) throw new Error(error.message)
      return Response.json({ ok: true, so_privado: valor })
    }

    if (acao === 'renomear') {
      const nome = String(body.nome || '').trim()
      if (!nome) return Response.json({ erro: 'Informe o nome.' }, { status: 400 })
      const { error } = await sb.from('usuarios').update({ nome }).eq('email', email).eq('escritorio_id', esc)
      if (error) throw new Error(error.message)
      return Response.json({ ok: true })
    }

    return Response.json({ erro: 'Ação desconhecida.' }, { status: 400 })
  } catch (e) {
    return Response.json({ erro: (e && e.message) || String(e) }, { status: 500 })
  }
}

export async function GET() {
  return Response.json({ info: 'Use POST autenticado para gerenciar acessos do CMPGestão.' })
}
