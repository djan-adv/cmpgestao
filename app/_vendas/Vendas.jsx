'use client'
// A página que apresenta o sistema a quem ainda não é cliente.
//
// Ela só aparece na PORTA COMUM (djan.app.br). No endereço de um escritório que
// já contratou, a porta continua sendo o login dele — quem já paga não precisa
// atravessar propaganda para entrar, e o cliente DELE nunca deve topar com a
// oferta de um sistema que não é assunto dele.
//
// Duas regras de conteúdo, e as duas existem por causa do público:
//   - nada de número inventado. Sem "mais de X escritórios", sem depoimento que
//     ninguém deu, sem preço que ainda não foi decidido. Advogado desconfia de
//     página que promete, e desconfia com razão.
//   - o que o sistema NÃO faz sozinho tem seção própria. Certificado digital,
//     conta de e-mail e a decisão sobre a peça continuam sendo do escritório —
//     dizer isso antes de vender é o que impede a frustração depois.

import { useState } from 'react'
// O catálogo é o mesmo que o painel usa para contratar. Repetir os números aqui
// faria a página anunciar um plano e o sistema entregar outro no dia em que um
// dos dois mudasse.
import { PLANOS as CATALOGO } from '../api/_lib/planos.js'

const NAVY = '#2E3A4B'
const NAVY2 = '#1E2A3B'
const GOLD = '#C9A227'
const VERDE = '#0F6E56'
const LINHA = '#e4e8ef'
const CINZA = '#697180'

const ROBOS = [
  {
    t: 'Diário de Justiça',
    d: 'De duas em duas horas, procura nas inscrições da OAB do escritório o que saiu no Diário de todos os tribunais — e leva a publicação para o histórico do processo certo, com o inteiro teor.',
  },
  {
    t: 'Estagiário Virtual',
    d: 'Lê cada intimação que chegou, decide se ela exige peça, abre o prazo no Kanban e monta um dossiê com as instruções e os documentos dos autos. Todo ato decisório ainda ganha, por segurança, o prazo de embargos.',
  },
  {
    t: 'Secretária Virtual',
    d: 'Reconhece a publicação que designa, redesigna ou adia audiência e põe o compromisso na agenda, com dia, hora, modalidade e local — marcado como recado, para você conferir. A partir daí o aviso ao cliente sai sozinho.',
  },
  {
    t: 'Caixa de e-mail do escritório',
    d: 'Lê a caixa de dez em dez minutos e leva cada resposta de vara ou de cliente para o histórico do processo certo. O que não casa com processo nenhum fica na caixa, para classificar à mão.',
  },
]

const DIA_A_DIA = [
  ['Prazos e tarefas', 'Kanban por etapa, agenda e revisão semanal. O prazo nasce da intimação, não da memória de alguém.'],
  ['Ficha do processo', 'Histórico oficial, partes, documentos, fases, honorários e observações — tudo numa tela só.'],
  ['Assinatura eletrônica', 'Procuração e contrato assinados à distância, com trilha de auditoria (Lei 14.063/2020). O cliente completa o que falta e assina pelo celular.'],
  ['Aplicativo do cliente', 'Ele acompanha o processo, recebe aviso de audiência na véspera e minutos antes, e conversa com o escritório por chat.'],
  ['Financeiro', 'Faturas para o cliente, controle do que entrou, e conferência de alvarás por mês.'],
  ['Documentos', 'Pasta por processo, com envio de arquivo ou de pasta inteira. Separado entre as suas peças e as da outra parte.'],
  ['Contatos de varas', 'E-mail, telefone e balcão virtual da vara, valendo para todos os processos dela — com o ofício ao cartório pronto para revisar e enviar.'],
  ['Produtividade da equipe', 'Ranking por pontos, meta por pessoa, tempo em cada processo e o dia hora a hora — a partir do registro do trabalho, sem vigiar tela.'],
  ['Migração do acervo', 'Traga os processos do sistema que você usa hoje por planilha. O sistema mostra o que entendeu, você corrige, confere quantos entram — e só então grava. Dá para desfazer.'],
]

// O que a tela de Produtividade mede de verdade — cada linha tem contrapartida
// no sistema (log de eventos, pesos por tipo de tarefa, metas em pontos, tempo
// por processo, auditoria de login). Nada aqui é promessa: se sair da tela,
// sai daqui junto.
const EQUIPE = [
  {
    t: 'Ranking por pontos, não por impressão',
    d: 'Cada tipo de entrega vale um número de pontos que você define — petição inicial, contestação, cálculo, atendimento. Quem entregou mais aparece em primeiro. Tarefa que passou por várias mãos divide o ponto entre elas, para não premiar quem só encostou no fim.',
  },
  {
    t: 'Meta por pessoa, com barra de progresso',
    d: 'Uma meta mensal em pontos para o escritório e ajuste individual — estagiário e sócio não carregam a mesma pauta. A ficha de cada um mostra quanto falta, proporcional ao período que você está olhando.',
  },
  {
    t: 'Tempo em cada processo',
    d: 'Quanto tempo cada pessoa passou em cada processo, somando os intervalos entre os registros com aquela ficha aberta e descontando as pausas. É a conta que vira rateio de honorário, preço de causa e resposta quando o cliente pergunta por que custou o que custou. Sai em CSV, pessoa por processo.',
  },
  {
    t: 'O dia inteiro, hora a hora',
    d: 'O que cada pessoa fez no dia, com a hora de cada registro: tarefa concluída, publicação tratada, e-mail enviado, documento subido, processo cadastrado, alvará conferido. Serve para prestar contas do dia e para reconstituir o que foi feito num processo.',
  },
  {
    t: 'Quem entrou e quem sumiu',
    d: 'Auditoria de acessos com o último login de cada um. Passou dos dias que você definiu sem entrar, aparece como faltoso — inclusive quem nunca entrou.',
  },
  {
    t: 'Volume e esforço, sem vigiar tela',
    d: 'As métricas saem do registro do trabalho no sistema — não há captura de tela, de teclado ou de mouse. Medem volume e esforço, não qualidade: servem para conversar com a equipe, não para decidir demissão sozinhas. Está escrito assim dentro do sistema também.',
  },
]

// As telas da galeria. As imagens saem de scripts/capturar-telas-vendas.mjs, que
// renderiza o HTML REAL do sistema com dados de exemplo — nenhum nome de cliente
// ou número de processo verdadeiro numa página pública, e nenhuma imagem
// prometendo tela que o sistema não tem.
const TELAS = [
  {
    img: '/vendas/cadastro-oab.png',
    t: 'O acervo inteiro entra pela OAB',
    d: 'O sistema procura no Diário de Justiça o que saiu na sua inscrição, monta a lista dos processos com as partes já sugeridas, e você marca os que quer. Nada entra sozinho.',
  },
  {
    img: '/vendas/robos.png',
    t: 'Os robôs, com a última rodada à vista',
    d: 'Diário, caixa de e-mail, Estagiário e Secretária: cada um mostra quando rodou e o que trouxe. Rodam no servidor, com o seu computador desligado.',
  },
  {
    img: '/vendas/marca-dagua.png',
    t: 'Documento aberto por estagiário sai marcado',
    d: 'Opcional, ligada pela coordenação: o nome de quem abriu fica ao fundo da página. O texto continua nítido e o carimbo não entra no copiar e colar.',
  },
]

const QUEM = {
  starter: 'Escritório pequeno, começando a organizar o acervo.',
  intermediario: 'Escritório em crescimento, com equipe e volume de prazos.',
  full: 'Escritório com acervo grande e equipe distribuída.',
}
const num = (n) => Number(n).toLocaleString('pt-BR')
// do menor para o maior — é a ordem em que se lê preço
const PLANOS = CATALOGO.slice().sort((a, b) => a.limite_processos - b.limite_processos).map(p => ({
  nome: p.nome,
  preco: p.preco_mensal,
  cheio: p.preco_cheio || null,
  desconto: p.preco_cheio ? Math.round((1 - p.preco_mensal / p.preco_cheio) * 100) : 0,
  proc: num(p.limite_processos),
  acessos: num(p.limite_acessos),
  gb: String(p.limite_gb).replace('.', ','),
  quem: QUEM[p.codigo] || p.resumo,
  destaque: p.codigo === 'intermediario',
}))

export default function Vendas({ aoEntrar }) {
  const [f, setF] = useState({ nome: '', email: '', telefone: '', oab: '', processos: '', sistema_atual: '', mensagem: '' })
  const [enviando, setEnviando] = useState(false)
  const [pronto, setPronto] = useState(false)
  const [erro, setErro] = useState('')
  const [ampliada, setAmpliada] = useState(null)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  async function enviar(e) {
    e.preventDefault()
    setErro(''); setEnviando(true)
    try {
      const r = await fetch('/api/interesse', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || d.erro) { setErro(d.erro || 'Não consegui enviar agora.'); setEnviando(false); return }
      setPronto(true)
    } catch (err) { setErro('Não consegui enviar agora. Tente de novo em instantes.') }
    setEnviando(false)
  }

  return (
    <div style={{ background: '#fff', color: '#1b2430', fontSize: 16, lineHeight: 1.6 }}>
      {/* ---------- topo ---------- */}
      <header style={{ background: NAVY2, color: '#fff' }}>
        <div style={{ ...faixa, display: 'flex', alignItems: 'center', gap: 16, padding: '16px 22px' }}>
          <div style={{ fontWeight: 800, fontSize: 17, letterSpacing: .2 }}>
            Gestão<span style={{ color: GOLD }}>Jurídica</span>
          </div>
          <button onClick={aoEntrar} style={{ ...botao, marginLeft: 'auto', background: 'transparent', border: '1px solid rgba(255,255,255,.35)', color: '#fff', padding: '8px 16px' }}>
            Entrar
          </button>
        </div>
      </header>

      {/* ---------- primeira dobra ---------- */}
      <section style={{ background: NAVY2, color: '#fff', paddingBottom: 56 }}>
        <div style={{ ...faixa, padding: '28px 22px 0' }}>
          <h1 style={{ fontSize: 'clamp(27px, 5vw, 38px)', lineHeight: 1.18, margin: '0 0 16px', maxWidth: 780, fontWeight: 800 }}>
            O sistema que já toca um escritório inteiro, agora com a marca do seu.
          </h1>
          <p style={{ fontSize: 18.5, color: '#c8d4e4', maxWidth: 680, margin: '0 0 10px' }}>
            Processos, prazos, clientes e financeiro num lugar só — com robôs que leem o Diário de Justiça,
            abrem o prazo no Kanban, marcam a audiência na agenda e avisam o seu cliente.
          </p>
          <p style={{ fontSize: 15, color: '#93a5bd', maxWidth: 680, margin: '0 0 26px' }}>
            Não é um sistema feito para vender: é o que roda a rotina de um escritório de advocacia todos os dias,
            aberto para outros escritórios usarem.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <a href="#demonstracao" style={{ ...botao, background: GOLD, color: NAVY2, fontSize: 15.5, padding: '13px 24px', textDecoration: 'none', display: 'inline-block' }}>
              Pedir uma demonstração
            </a>
            <a href="#robos" style={{ ...botao, background: 'transparent', border: '1px solid rgba(255,255,255,.3)', color: '#fff', fontSize: 15.5, padding: '13px 24px', textDecoration: 'none', display: 'inline-block' }}>
              Ver o que ele faz sozinho
            </a>
          </div>
        </div>
      </section>

      {/* ---------- robôs ---------- */}
      <section id="robos" style={{ ...faixa, padding: '56px 22px 8px' }}>
        <Rotulo>O que trabalha enquanto ninguém está olhando</Rotulo>
        <h2 style={h2}>Quatro robôs, rodando no servidor com o seu computador desligado</h2>
        <p style={{ color: CINZA, maxWidth: 720, marginTop: 0 }}>
          É aqui que o sistema se paga. O resto — cadastro, pasta, agenda — todo sistema tem.
        </p>
        <div style={gradeRobos}>
          {ROBOS.map(r => (
            <div key={r.t} style={{ ...cartao, borderLeft: '3px solid ' + VERDE }}>
              <div style={{ fontWeight: 700, color: NAVY, marginBottom: 6, fontSize: 17 }}>{r.t}</div>
              <div style={{ color: '#46505e', fontSize: 15 }}>{r.d}</div>
            </div>
          ))}
        </div>
        <p style={{ ...nota, marginTop: 18 }}>
          Cada escritório varre as próprias inscrições da OAB, lê a própria caixa de e-mail e tem o próprio painel
          de robôs, com a última rodada dele e um botão para rodar na hora.
        </p>
      </section>

      {/* ---------- dia a dia ---------- */}
      <section style={{ background: '#f6f8fb', borderTop: '1px solid ' + LINHA, borderBottom: '1px solid ' + LINHA, marginTop: 48 }}>
        <div style={{ ...faixa, padding: '52px 22px' }}>
          <Rotulo>O dia a dia</Rotulo>
          <h2 style={h2}>O escritório inteiro numa tela só</h2>
          <div style={grade(2)}>
            {DIA_A_DIA.map(([t, d]) => (
              <div key={t} style={{ padding: '4px 0' }}>
                <div style={{ fontWeight: 700, color: NAVY, fontSize: 15.5 }}>{t}</div>
                <div style={{ color: '#46505e', fontSize: 14.5 }}>{d}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- galeria ---------- */}
      {/* Página que vende software jurídico sem mostrar a tela é folheto. Estas
          imagens saem do HTML real do sistema (ver scripts/capturar-telas-vendas.mjs),
          com dados de exemplo — é a diferença entre provar e prometer. */}
      <section style={{ background: '#f6f8fb', borderTop: '1px solid ' + LINHA, borderBottom: '1px solid ' + LINHA }}>
        <div style={{ ...faixa, padding: '52px 22px' }}>
          <Rotulo>Por dentro</Rotulo>
          <h2 style={h2}>As telas, como elas são</h2>
          <p style={{ color: '#46505e', fontSize: 15.5, maxWidth: 780, margin: '0 0 22px' }}>
            Capturas do sistema em funcionamento, com dados de exemplo — nenhum processo ou cliente real
            aparece aqui. Clique para ampliar.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 18 }}>
            {TELAS.map(t => (
              <figure key={t.img} style={{ margin: 0 }}>
                <button
                  onClick={() => setAmpliada(t)}
                  style={{
                    display: 'block', width: '100%', padding: 0, border: '1px solid ' + LINHA,
                    borderRadius: 12, overflow: 'hidden', background: '#fff', cursor: 'zoom-in',
                    boxShadow: '0 1px 3px rgba(20,30,50,.06)',
                  }}
                  title="ampliar"
                >
                  <img src={t.img} alt={t.t} loading="lazy" style={{ display: 'block', width: '100%', height: 210, objectFit: 'cover', objectPosition: 'top' }} />
                </button>
                <figcaption style={{ marginTop: 10 }}>
                  <b style={{ color: NAVY, fontSize: 15.5 }}>{t.t}</b>
                  <p style={{ color: '#46505e', fontSize: 14, margin: '3px 0 0' }}>{t.d}</p>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* a imagem ampliada: só uma camada por cima, fechada no clique ou no Esc */}
      {ampliada ? (
        <div
          onClick={() => setAmpliada(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(18,26,38,.82)', zIndex: 999,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, cursor: 'zoom-out',
          }}
        >
          <div style={{ maxWidth: 1100, width: '100%' }} onClick={e => e.stopPropagation()}>
            <img src={ampliada.img} alt={ampliada.t} style={{ display: 'block', width: '100%', borderRadius: 12, background: '#fff' }} />
            <div style={{ color: '#fff', marginTop: 10, display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <b>{ampliada.t}</b>
              <button onClick={() => setAmpliada(null)} style={{ background: 'transparent', color: '#cfd6e0', border: '1px solid #55606f', borderRadius: 8, padding: '4px 12px', cursor: 'pointer' }}>fechar</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ---------- equipe ---------- */}
      {/* Pedido do dono (04/09/2026): o controle de estagiário e associado é
          argumento de venda forte e estava só implícito numa linha do dia a dia.
          Escritório com equipe compra por causa disto. */}
      <section style={{ ...faixa, padding: '52px 22px' }}>
        <Rotulo>Estagiários e associados</Rotulo>
        <h2 style={h2}>Quem entregou o quê, quanto tempo levou e em qual processo</h2>
        <p style={{ color: '#46505e', fontSize: 15.5, maxWidth: 780, margin: '0 0 22px' }}>
          A pergunta que não tem resposta em escritório nenhum é <b>quanto do mês foi para cada processo e para cada pessoa</b>.
          O sistema responde com o registro do próprio trabalho: cada entrega vale pontos que você define, cada
          pessoa tem meta, e o tempo é somado processo a processo.
        </p>
        <div style={grade(2)}>
          {EQUIPE.map(({ t, d }) => (
            <div key={t} style={cartao}>
              <b style={{ color: NAVY }}>{t}</b>
              <p style={pCartao}>{d}</p>
            </div>
          ))}
        </div>
        <p style={{ color: CINZA, fontSize: 13.5, marginTop: 18, maxWidth: 780 }}>
          Tudo exportável em CSV — o placar do mês, o dia hora a hora e o tempo por processo — para levar à
          reunião de equipe ou fechar a conta de quem é horista.
        </p>
      </section>

      {/* ---------- marca própria ---------- */}
      <section style={{ ...faixa, padding: '52px 22px' }}>
        <Rotulo>Seu escritório, não o meu</Rotulo>
        <h2 style={h2}>O sistema veste a sua marca — inclusive nos documentos</h2>
        <div style={grade(3)}>
          <div style={cartao}>
            <b style={{ color: NAVY }}>Endereço próprio</b>
            <p style={{ ...pCartao }}>Seu escritório entra por um endereço só dele. Quem abre vê o nome, o logo e a cor que você escolheu.</p>
          </div>
          <div style={cartao}>
            <b style={{ color: NAVY }}>Documentos com os seus dados</b>
            <p style={{ ...pCartao }}>Procuração e contrato de honorários saem com o seu nome, a sua OAB, a sua sociedade e o seu endereço — lidos do cadastro do escritório, nunca fixos no sistema.</p>
          </div>
          <div style={cartao}>
            <b style={{ color: NAVY }}>E-mail pela sua conta</b>
            <p style={{ ...pCartao }}>O que sai para a vara e para o cliente sai do endereço do seu escritório, pela conta que você cadastrou. Nada é enviado em nome de terceiro.</p>
          </div>
        </div>
      </section>

      {/* ---------- honestidade ---------- */}
      <section style={{ background: '#fffaf0', borderTop: '1px solid #f0e3c6', borderBottom: '1px solid #f0e3c6' }}>
        <div style={{ ...faixa, padding: '46px 22px' }}>
          <Rotulo cor="#8a6d00">Antes de contratar, o que depende de você</Rotulo>
          <h2 style={{ ...h2, fontSize: 24 }}>Três coisas que nenhum sistema resolve sozinho</h2>
          <ul style={{ margin: 0, paddingLeft: 20, color: '#46505e', maxWidth: 760 }}>
            <li style={{ marginBottom: 10 }}>
              <b>Certificado digital.</b> Baixar as peças dos autos e protocolar no jus.br depende do certificado do
              escritório — é ele que abre o processo. Sem certificado, o sistema ainda acompanha tudo pelo Diário de
              Justiça e pela base pública do CNJ, que são públicos.
            </li>
            <li style={{ marginBottom: 10 }}>
              <b>Conta de e-mail do escritório.</b> O envio só é liberado depois de um teste real passar. É de
              propósito: sem isso você descobriria que a senha estava errada no dia em que perdesse um prazo
              achando que tinha avisado a vara.
            </li>
            <li>
              <b>A decisão continua sendo do advogado.</b> A IA lê a intimação, classifica e prepara o material.
              Ela não protocola, não assina e não fala com o cliente sem você mandar. O prazo que ela abre nasce
              para ser conferido.
            </li>
          </ul>
        </div>
      </section>

      {/* ---------- planos ---------- */}
      <section style={{ ...faixa, padding: '52px 22px' }}>
        <Rotulo>Planos</Rotulo>
        <h2 style={h2}>Três degraus, o sistema inteiro em todos</h2>
        <p style={{ color: CINZA, maxWidth: 720, marginTop: 0 }}>
          O que muda entre os planos é o tamanho: quantos processos, quantos acessos e quanto espaço de documento.
          Nenhuma função é cortada por plano.
        </p>
        {/* Preço de lançamento. O valor riscado é o de TABELA — o que passa a
            valer quando o lançamento terminar —, não um preço que já tenha sido
            praticado: dizer o contrário seria propaganda enganosa, e quem
            compra aqui é advogado. */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          background: '#fff6e0', border: '1px solid #f0dfb4', borderRadius: 12,
          padding: '10px 16px', margin: '4px 0 6px',
        }}>
          <span style={{
            background: VERDE, color: '#fff', borderRadius: 20, padding: '3px 12px',
            fontWeight: 800, fontSize: 14, letterSpacing: .3,
          }}>−70%</span>
          <b style={{ color: NAVY, fontSize: 15.5 }}>Preço de lançamento</b>
          <span style={{ color: '#7a6417', fontSize: 14.5 }}>
            quem entrar agora fica com este valor; o de tabela passa a valer no fim do lançamento.
          </span>
        </div>
        <div style={grade(3)}>
          {PLANOS.map(p => (
            <div key={p.nome} style={{
              ...cartao,
              border: p.destaque ? ('2px solid ' + GOLD) : ('1px solid ' + LINHA),
              background: p.destaque ? '#fffdf6' : '#fff',
            }}>
              <div style={{ fontWeight: 800, color: NAVY, fontSize: 19 }}>{p.nome}</div>
              {p.cheio ? (
                <div style={{ marginTop: 8, color: CINZA, fontSize: 14 }}>
                  tabela <s>R$ {num(p.cheio)}</s>
                  <span style={{
                    marginLeft: 8, background: '#e8f4ee', color: VERDE, borderRadius: 20,
                    padding: '2px 9px', fontSize: 12.5, fontWeight: 800,
                  }}>−{p.desconto}%</span>
                </div>
              ) : null}
              <div style={{ margin: '2px 0 2px', color: NAVY2 }}>
                <span style={{ fontSize: 14, color: CINZA }}>R$ </span>
                <span style={{ fontSize: 34, fontWeight: 800, letterSpacing: -.5 }}>{num(p.preco)}</span>
                <span style={{ fontSize: 14, color: CINZA }}> /mês</span>
                <span style={{ fontSize: 12.5, color: VERDE, fontWeight: 700, marginLeft: 6 }}>lançamento</span>
              </div>
              <div style={{ color: CINZA, fontSize: 13.5, minHeight: 40, marginTop: 4 }}>{p.quem}</div>
              <ul style={{ listStyle: 'none', padding: 0, margin: '14px 0 0', fontSize: 15 }}>
                <li style={liPlano}><b>{p.proc}</b> processos</li>
                <li style={liPlano}><b>{p.acessos}</b> acessos</li>
                <li style={liPlano}><b>{p.gb} GB</b> de documentos</li>
              </ul>
            </div>
          ))}
        </div>
        {/* Comparação de mercado informada pelo vendedor. Sem citar nome: nada
            aqui depende de qual é o concorrente, e comparação nominal exige
            prova pronta se alguém reclamar. */}
        <p style={{ ...nota, marginTop: 16, color: '#46505e' }}>
          Para comparar: sistemas de gestão jurídica com menos funções do que esta lista cobram
          cerca de <b>R$ 700 por 1.000 processos e 10 acessos</b>. O Starter, no preço de lançamento,
          entrega <b>2.500 processos e 25 acessos</b> — com os quatro robôs, o aplicativo do cliente e a
          assinatura eletrônica incluídos.
        </p>
        <p style={{ ...nota, marginTop: 16 }}>
          Mensalidade, sem fidelidade e sem taxa de instalação. A migração do acervo do sistema atual está
          incluída. Precisa de mais processos ou mais acessos do que o degrau comporta? É só subir de plano —
          o acervo continua onde está.
        </p>
      </section>

      {/* ---------- formulário ---------- */}
      <section id="demonstracao" style={{ background: NAVY2, color: '#fff' }}>
        <div style={{ ...faixa, padding: '52px 22px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: 36, alignItems: 'start' }}>
            <div>
              <Rotulo cor={GOLD}>Demonstração</Rotulo>
              <h2 style={{ ...h2, color: '#fff', marginTop: 6 }}>Veja funcionando com o seu acervo</h2>
              <p style={{ color: '#c8d4e4', fontSize: 15.5, maxWidth: 460 }}>
                Deixe seus dados e eu entro em contato para marcar. Na conversa dá para trazer a planilha do
                sistema que você usa hoje e ver os seus próprios processos dentro dele.
              </p>
              <p style={{ color: '#93a5bd', fontSize: 13.5, maxWidth: 460 }}>
                Seus dados servem só para esse contato. Nada é publicado e nada é repassado.
              </p>
            </div>

            <div style={{ background: '#fff', borderRadius: 14, padding: 22, color: '#1b2430' }}>
              {pronto ? (
                <div style={{ padding: '12px 4px' }}>
                  <div style={{ fontWeight: 800, color: VERDE, fontSize: 18, marginBottom: 6 }}>Pedido recebido.</div>
                  <p style={{ color: '#46505e', fontSize: 15, margin: 0 }}>
                    Entro em contato pelo e-mail ou telefone que você deixou. Se for urgente, responda o e-mail
                    de confirmação que a conversa continua por lá.
                  </p>
                </div>
              ) : (
                <form onSubmit={enviar}>
                  <Campo rot="Nome" req v={f.nome} on={set('nome')} />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <Campo rot="E-mail" req tipo="email" v={f.email} on={set('email')} />
                    <Campo rot="Telefone / WhatsApp" v={f.telefone} on={set('telefone')} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <Campo rot="OAB (número/UF)" v={f.oab} on={set('oab')} />
                    <Campo rot="Processos hoje" dica="aproximado" v={f.processos} on={set('processos')} />
                  </div>
                  <Campo rot="Sistema que usa hoje" dica="se usar algum" v={f.sistema_atual} on={set('sistema_atual')} />
                  <label style={rotuloCampo}>O que você mais precisa resolver</label>
                  <textarea value={f.mensagem} onChange={set('mensagem')} rows={3}
                    style={{ ...campo, resize: 'vertical' }} />
                  {erro && <div style={{ color: '#b5342b', fontSize: 13.5, margin: '4px 0 8px' }}>{erro}</div>}
                  <button type="submit" disabled={enviando}
                    style={{ ...botao, background: enviando ? '#9aa6b5' : VERDE, color: '#fff', width: '100%', padding: 13, fontSize: 15.5, marginTop: 6 }}>
                    {enviando ? 'Enviando…' : 'Pedir demonstração'}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Quem vende, com nome e endereço de contato.
          Página que cobra mensalidade e não diz quem está do outro lado levanta
          suspeita — e com razão. O CPF fica de fora: identificar não exige expor
          documento, e enquanto a contratação for por conversa (e não por
          checkout no site) não há por que publicá-lo. */}
      <footer style={{ background: '#141d29', color: '#8b9bb0', fontSize: 13.5 }}>
        <div style={{ ...faixa, padding: '26px 22px', display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <div style={{ minWidth: 260 }}>
            <div style={{ color: '#c8d4e4', fontWeight: 700, marginBottom: 2 }}>
              Gestão<span style={{ color: GOLD }}>Jurídica</span>
            </div>
            <div>Sistema de gestão para escritórios de advocacia.</div>
          </div>
          <div style={{ minWidth: 260 }}>
            <div style={{ color: '#c8d4e4', fontWeight: 700, marginBottom: 2 }}>Desenvolvimento e suporte</div>
            <div>Djan Henrique Mendonça — desenvolvedor</div>
            <div>
              <a href="mailto:contato@djan.app.br" style={{ color: '#c8d4e4' }}>contato@djan.app.br</a>
            </div>
          </div>
          <div style={{ marginLeft: 'auto', paddingTop: 2 }}>
            <button onClick={aoEntrar} style={{ background: 'none', border: 0, color: '#c8d4e4', cursor: 'pointer', fontSize: 13.5, textDecoration: 'underline', padding: 0 }}>
              Já é cliente? Entrar
            </button>
          </div>
        </div>
      </footer>
    </div>
  )
}

// ---------------------------------------------------------------------------
function Rotulo({ children, cor }) {
  return (
    <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 1, textTransform: 'uppercase', color: cor || GOLD, marginBottom: 8 }}>
      {children}
    </div>
  )
}

function Campo({ rot, v, on, req, tipo, dica }) {
  return (
    <div>
      <label style={rotuloCampo}>
        {rot}{req ? ' *' : ''}{dica ? <span style={{ fontWeight: 400, color: CINZA }}> — {dica}</span> : null}
      </label>
      <input value={v} onChange={on} required={!!req} type={tipo || 'text'} style={campo} />
    </div>
  )
}

const faixa = { maxWidth: 1060, margin: '0 auto' }
const h2 = { fontSize: 'clamp(21px, 3.2vw, 27px)', lineHeight: 1.25, margin: '2px 0 14px', color: NAVY, fontWeight: 800 }
const cartao = { background: '#fff', border: '1px solid ' + LINHA, borderRadius: 12, padding: 18 }
const pCartao = { color: '#46505e', fontSize: 14.5, margin: '6px 0 0' }
const nota = { color: CINZA, fontSize: 13.5, maxWidth: 760 }
const liPlano = { padding: '5px 0', borderBottom: '1px solid ' + LINHA }
const botao = { border: 0, borderRadius: 9, fontWeight: 700, cursor: 'pointer', fontSize: 14 }
const rotuloCampo = { display: 'block', fontSize: 12.5, fontWeight: 700, color: NAVY, margin: '10px 0 3px' }
const campo = { width: '100%', padding: 10, border: '1px solid ' + LINHA, borderRadius: 8, boxSizing: 'border-box', fontSize: 14.5, fontFamily: 'inherit' }
// Os robôs são quatro: em três colunas, o quarto fica sozinho embaixo e a seção
// parece incompleta. Duas colunas fecham 2×2 e ainda dão largura para o texto.
const gradeRobos = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(420px,1fr))', gap: 16, marginTop: 14 }
const grade = (n) => ({ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(' + (n === 3 ? 250 : 300) + 'px,1fr))', gap: 16, marginTop: 14 })
