// Robô do período de teste: avisa, e no fim bloqueia — sem apagar nada.
//
//   GET /api/cron/testes          → roda a rodada do dia
//   GET /api/cron/testes?seco=1   → mostra o que faria, sem enviar nem bloquear
//
// A regra do produto é simples de dizer e fácil de errar na prática: o
// escritório usa o sistema INTEIRO por 30 dias; no fim, o acesso para e o
// acervo fica intacto; quando ele paga, tudo reaparece como estava.
//
// O que este robô existe para impedir:
//
// 1. O cliente ser bloqueado sem ter sido avisado. Saem três e-mails — a 10
//    dias, a 3 dias e no dia — e cada um é registrado, para não sair duas vezes
//    e para haver prova de que saiu.
// 2. O fim do teste virar prazo perdido. Bloquear o acesso NÃO desliga a
//    captura: a carência (escritorios.coleta_ate) mantém o robô do diário
//    varrendo por mais alguns dias, guardando o que sair. Quem contrata depois
//    encontra o período inteiro no lugar.
// 3. O bloqueio acontecer em silêncio. O motivo fica escrito em
//    suspenso_motivo, e é o que a tela mostra a quem tentar entrar.
//
// Nada aqui apaga processo, documento ou usuário. O fim do teste é uma porta
// fechada, não uma faxina.

import { createClient } from '@supabase/supabase-js'
import { enviarEmailConta } from '../../_lib/email-conta.js'
import { DIAS_CARENCIA_COLETA, diasAte } from '../../_lib/planos.js'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0
export const maxDuration = 120

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })
}

// Os degraus de aviso, do mais distante ao mais próximo.
const AVISOS = [10, 3, 0]

function dataBR(iso) { return String(iso || '').split('-').reverse().join('/') }
function escapar(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// O aviso já saiu? Fica gravado em produtividade_config, com a data do teste no
// valor: se o teste for prorrogado, a data muda e o aviso do novo prazo sai de
// novo — que é o certo, porque é outro vencimento.
async function jaAvisou(sb, esc, degrau, teste_ate) {
  const { data } = await sb.from('produtividade_config')
    .select('valor').eq('escritorio_id', esc).eq('chave', 'teste_aviso_d' + degrau).maybeSingle()
  return !!(data && data.valor === teste_ate)
}
async function marcarAviso(sb, esc, degrau, teste_ate) {
  await sb.from('produtividade_config').upsert(
    { escritorio_id: esc, chave: 'teste_aviso_d' + degrau, valor: teste_ate },
    { onConflict: 'escritorio_id,chave' },
  )
}

// Para quem escrever: o contratante. É quem assina e quem decide pagar.
async function contratanteDe(sb, esc) {
  const { data } = await sb.from('usuarios')
    .select('nome,email').eq('escritorio_id', esc).eq('papel', 'contratante').eq('ativo', true)
    .order('criado_em', { ascending: true }).limit(1)
  return (data && data[0]) || null
}

function corpoDoAviso({ nome, escritorio, dias, teste_ate, host }) {
  const url = host ? 'https://' + host : null
  const abre = 'Olá, ' + escapar(nome || '') + '.'
  if (dias > 0) {
    return {
      assunto: 'Seu teste do sistema termina em ' + dias + (dias === 1 ? ' dia' : ' dias'),
      titulo: 'Faltam ' + dias + (dias === 1 ? ' dia' : ' dias') + ' de teste',
      linhas: [
        abre,
        'O período de teste do escritório <b>' + escapar(escritorio) + '</b> vai até <b>' + dataBR(teste_ate) + '</b>.',
        'Depois dessa data o acesso é interrompido — mas <b>nada é apagado</b>. Processos, documentos, prazos e histórico continuam no lugar, e voltam exatamente como estavam quando você contratar.',
        'Nos primeiros dias após o fim do teste o sistema <b>continua capturando as publicações do Diário</b> do seu escritório, para que nenhuma intimação se perca nesse intervalo.',
        'Para contratar, é só responder a este e-mail.',
      ],
      url,
    }
  }
  return {
    assunto: 'Seu teste do sistema termina hoje',
    titulo: 'Último dia de teste',
    linhas: [
      abre,
      'O teste do escritório <b>' + escapar(escritorio) + '</b> termina <b>hoje</b>.',
      'A partir de amanhã o acesso fica bloqueado. <b>Nada será apagado</b>: o acervo inteiro continua guardado e reaparece assim que você contratar.',
      'Por segurança, o sistema segue capturando as publicações do Diário do seu escritório por mais ' +
        DIAS_CARENCIA_COLETA + ' dias — para que nenhuma intimação se perca enquanto você decide.',
      'Para contratar e escolher o plano, é só responder a este e-mail.',
    ],
    url,
  }
}

export async function GET(request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ erro: 'servidor sem SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })
  }
  const { searchParams } = new URL(request.url)
  const seco = searchParams.get('seco') != null
  const sb = admin()

  const { data: escs, error } = await sb.from('escritorios')
    .select('id,nome,hosts,ativo,raiz,teste_ate,coleta_ate')
    .not('teste_ate', 'is', null)
  if (error) return Response.json({ erro: error.message }, { status: 500 })

  const rel = { ok: true, seco, quando: new Date().toISOString(), avisados: 0, bloqueados: 0, detalhe: [] }

  for (const e of escs || []) {
    if (e.raiz) continue
    const dias = diasAte(e.teste_ate)
    const host = (e.hosts || [])[0] || null
    const linha = { escritorio: e.nome, teste_ate: e.teste_ate, dias }

    // ---- fim do teste: bloqueia o acesso, mantém a coleta ------------------
    if (dias < 0) {
      if (e.ativo === false) { linha.acao = 'já bloqueado'; rel.detalhe.push(linha); continue }
      const carencia = new Date()
      carencia.setDate(carencia.getDate() + DIAS_CARENCIA_COLETA)
      if (!seco) {
        await sb.from('escritorios').update({
          ativo: false,
          suspenso_em: new Date().toISOString(),
          suspenso_motivo: 'Período de teste encerrado em ' + dataBR(e.teste_ate) +
            '. Nenhum dado foi apagado: o acervo volta inteiro ao contratar.',
          coleta_ate: carencia.toISOString().slice(0, 10),
        }).eq('id', e.id)
      }
      linha.acao = 'bloqueado'
      linha.coleta_ate = carencia.toISOString().slice(0, 10)
      rel.bloqueados++
      rel.detalhe.push(linha)
      continue
    }

    // ---- avisos ------------------------------------------------------------
    const degrau = AVISOS.find(d => d === dias)
    if (degrau == null) { linha.acao = 'nada a fazer'; rel.detalhe.push(linha); continue }
    if (await jaAvisou(sb, e.id, degrau, e.teste_ate)) { linha.acao = 'aviso já enviado'; rel.detalhe.push(linha); continue }

    const dono = await contratanteDe(sb, e.id)
    if (!dono || !dono.email) { linha.acao = 'sem contratante com e-mail'; rel.detalhe.push(linha); continue }

    const c = corpoDoAviso({ nome: dono.nome, escritorio: e.nome, dias, teste_ate: e.teste_ate, host })
    if (seco) { linha.acao = 'enviaria aviso D-' + degrau + ' para ' + dono.email; rel.detalhe.push(linha); continue }

    const envio = await enviarEmailConta({
      para: dono.email,
      assunto: c.assunto,
      titulo: c.titulo,
      linhas: c.linhas,
      botao: c.url ? { texto: 'Abrir o sistema', url: c.url } : null,
    })
    if (envio.ok) {
      await marcarAviso(sb, e.id, degrau, e.teste_ate)
      rel.avisados++
      linha.acao = 'aviso D-' + degrau + ' enviado a ' + dono.email
    } else {
      // Não marca como avisado: e-mail que não saiu tem de ser tentado de novo
      // na próxima rodada. Bloquear alguém que nunca foi avisado é o pior
      // desfecho possível deste robô.
      linha.acao = 'falha ao enviar: ' + (envio.erro || 'desconhecida')
    }
    rel.detalhe.push(linha)
  }

  return Response.json(rel)
}
