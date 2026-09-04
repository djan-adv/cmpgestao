// De quem é este endereço?
//
// Cada escritório entra pelo domínio dele (jose.djan.app.br hoje, o domínio
// próprio depois). Esta rota traduz o endereço em marca — é o que a tela de
// login pergunta ANTES de existir usuário logado, para não mostrar a marca de
// um escritório na porta de outro.
//
//   GET /api/inquilino            -> usa o Host da requisição
//   GET /api/inquilino?host=x.br  -> consulta um endereço específico
//
// Devolve SÓ o que pode ser público: nome, marca, se está ativo. Nada de plano,
// limites, contratante ou qualquer dado do acervo — esta rota responde a
// qualquer um, inclusive a quem nem tem conta.

import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

function hostLimpo(h) {
  return String(h || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '')
}

export async function GET(request) {
  const { searchParams } = new URL(request.url)
  const host = hostLimpo(searchParams.get('host') || request.headers.get('host') || '')
  if (!host) return Response.json({ erro: 'sem host' }, { status: 400 })

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })
  const { data } = await sb
    .from('escritorios')
    .select('id,nome,marca,ativo,raiz,dados,teste_ate,suspenso_motivo')
    .contains('hosts', [host])
    .maybeSingle()

  // Nada aqui pode ser guardado em cache. O cadastro do escritório muda no meio
  // do dia — foi assim que uma procuração continuou dizendo "cadastro
  // incompleto" horas depois de o escritório tê-lo preenchido: o navegador
  // ainda servia a resposta antiga, que trazia o nome (já existia) e o cadastro
  // vazio (ainda não existia).
  const semCache = { headers: { 'Cache-Control': 'no-store, max-age=0' } }

  // Endereço desconhecido não é erro: é o caso de quem abre pela porta comum
  // (djan.app.br) ou por um domínio ainda não cadastrado. A tela cai na marca
  // neutra e o login segue valendo — o escritório de cada um vem do USUÁRIO, e
  // não do endereço, então entrar por aqui dá acesso normal ao próprio acervo.
  //
  // Mas com um usuário logado ainda precisamos saber a SITUAÇÃO do escritório
  // dele. Sem isto, um escritório suspenso que entrasse pela porta comum veria
  // um sistema vazio, sem uma linha explicando por quê — e ligaria achando que
  // perdeu os processos. Por isso, quando vem sessão junto, a resposta é sobre
  // o escritório DO USUÁRIO. Nada aqui expõe dado alheio: é o escritório dele.
  if (!data) {
    const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
    if (jwt) {
      try {
        const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
        const { data: u } = await anon.auth.getUser(jwt)
        const uid = u && u.user && u.user.id
        if (uid) {
          const { data: perfil } = await sb.from('usuarios').select('escritorio_id').eq('id', uid).maybeSingle()
          if (perfil && perfil.escritorio_id) {
            const { data: meu } = await sb.from('escritorios')
              .select('id,nome,marca,ativo,raiz,dados,teste_ate,suspenso_motivo')
              .eq('id', perfil.escritorio_id).maybeSingle()
            if (meu) return Response.json(publico(meu, host, true), semCache)
          }
        }
      } catch (e) {}
    }
    return Response.json({ ok: true, conhecido: false, host }, semCache)
  }

  return Response.json(publico(data, host, false), semCache)
}

// O que pode sair daqui. `porUsuario` diz que a resposta veio da sessão, e não
// do endereço — a tela usa isso para não trocar a marca da porta comum.
function publico(data, host, porUsuario) {

  const marca = data.marca || {}
  return {
    ok: true,
    conhecido: true,
    por_usuario: !!porUsuario,
    host,
    escritorio_id: data.id,
    raiz: !!data.raiz,
    ativo: data.ativo !== false,
    // Por que a porta está fechada. Sem isto, o escritório bloqueado veria um
    // sistema vazio e ligaria perguntando se perdeu os processos — que é
    // exatamente o susto que o fim do teste não pode causar.
    suspenso_motivo: data.ativo === false ? (data.suspenso_motivo || null) : null,
    // Período de teste: a tela mostra quantos dias faltam. É informação do
    // endereço, não do acervo — pode sair antes do login.
    teste_ate: data.teste_ate || null,
    nome: data.nome,
    marca: {
      sistema: marca.sistema || null,   // nome que aparece no lugar de "Gestão"
      cor: marca.cor || null,
      logo: marca.logo || null,
    },
    // Cadastro do escritório. É o que preenche a procuração e o contrato que o
    // cliente dele assina — e é dado profissional público (o que já vai escrito
    // na própria procuração), não dado sigiloso.
    dados: data.dados || null,
  }
}
