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
  ['Migração do acervo', 'Traga os processos do sistema que você usa hoje por planilha. O sistema mostra o que entendeu, você corrige, confere quantos entram — e só então grava. Dá para desfazer.'],
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
          <h1 style={{ fontSize: 38, lineHeight: 1.18, margin: '0 0 16px', maxWidth: 780, fontWeight: 800 }}>
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
        <div style={grade(2)}>
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
        <div style={grade(3)}>
          {PLANOS.map(p => (
            <div key={p.nome} style={{
              ...cartao,
              border: p.destaque ? ('2px solid ' + GOLD) : ('1px solid ' + LINHA),
              background: p.destaque ? '#fffdf6' : '#fff',
            }}>
              <div style={{ fontWeight: 800, color: NAVY, fontSize: 19 }}>{p.nome}</div>
              <div style={{ margin: '8px 0 2px', color: NAVY2 }}>
                <span style={{ fontSize: 14, color: CINZA }}>R$ </span>
                <span style={{ fontSize: 34, fontWeight: 800, letterSpacing: -.5 }}>{num(p.preco)}</span>
                <span style={{ fontSize: 14, color: CINZA }}> /mês</span>
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

      <footer style={{ background: '#141d29', color: '#8b9bb0', fontSize: 13.5 }}>
        <div style={{ ...faixa, padding: '22px', display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <span>Sistema de gestão jurídica.</span>
          <button onClick={aoEntrar} style={{ background: 'none', border: 0, color: '#c8d4e4', cursor: 'pointer', fontSize: 13.5, textDecoration: 'underline', padding: 0, marginLeft: 'auto' }}>
            Já é cliente? Entrar
          </button>
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
const h2 = { fontSize: 27, lineHeight: 1.25, margin: '2px 0 14px', color: NAVY, fontWeight: 800 }
const cartao = { background: '#fff', border: '1px solid ' + LINHA, borderRadius: 12, padding: 18 }
const pCartao = { color: '#46505e', fontSize: 14.5, margin: '6px 0 0' }
const nota = { color: CINZA, fontSize: 13.5, maxWidth: 760 }
const liPlano = { padding: '5px 0', borderBottom: '1px solid ' + LINHA }
const botao = { border: 0, borderRadius: 9, fontWeight: 700, cursor: 'pointer', fontSize: 14 }
const rotuloCampo = { display: 'block', fontSize: 12.5, fontWeight: 700, color: NAVY, margin: '10px 0 3px' }
const campo = { width: '100%', padding: 10, border: '1px solid ' + LINHA, borderRadius: 8, boxSizing: 'border-box', fontSize: 14.5, fontFamily: 'inherit' }
const grade = (n) => ({ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(' + (n === 3 ? 250 : 300) + 'px,1fr))', gap: 16, marginTop: 14 })
