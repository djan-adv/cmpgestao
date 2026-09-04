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
    .select('id,nome,marca,ativo,raiz,dados')
    .contains('hosts', [host])
    .maybeSingle()

  // Nada aqui pode ser guardado em cache. O cadastro do escritório muda no meio
  // do dia — foi assim que uma procuração continuou dizendo "cadastro
  // incompleto" horas depois de o escritório tê-lo preenchido: o navegador
  // ainda servia a resposta antiga, que trazia o nome (já existia) e o cadastro
  // vazio (ainda não existia).
  const semCache = { headers: { 'Cache-Control': 'no-store, max-age=0' } }

  // Endereço desconhecido não é erro: é o caso de quem abre por um domínio
  // ainda não cadastrado. A tela cai na marca neutra e o login segue valendo.
  if (!data) return Response.json({ ok: true, conhecido: false, host }, semCache)

  const marca = data.marca || {}
  return Response.json({
    ok: true,
    conhecido: true,
    host,
    escritorio_id: data.id,
    raiz: !!data.raiz,
    ativo: data.ativo !== false,
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
  }, semCache)
}
