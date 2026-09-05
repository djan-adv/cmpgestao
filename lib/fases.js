// A FASE do processo — uma fonte só, servidor e tela.
//
// A regra nasceu na tela do escritório (guessFase, em sistema.html) e ficava só
// lá; o aplicativo do cliente mostrava "fase" apenas quando alguém tinha
// travado a fase à mão, o que acontece em menos de 10% dos processos. Agora a
// regra mora aqui e o app calcula igual.
//
// Duas coisas importam para não estragar o que já funciona:
//   • a fase TRAVADA pelo escritório (processos.fase) sempre vence o palpite;
//   • o palpite lê só o COMEÇO de cada andamento recente — a fase real aparece
//     no título do movimento, não enterrada na página 4 de uma fundamentação.
//
// O teste do projeto roda esta função e a de sistema.html lado a lado sobre os
// mesmos textos: se alguém mexer numa e esquecer da outra, o teste acusa.

/* id, nome no escritório, cor, e o nome que o CLIENTE lê no aplicativo.
   O cliente não fala "fase saneadora" nem "fase decisória" — ele quer saber se
   já foi julgado, se está em recurso, se tem dinheiro a levantar. */
export const FASES_META = [
  ['prot', 'Correção e Protocolo', '#C9A227', 'Protocolo'],
  ['post', 'Fase de Conhecimento', '#185FA5', 'Em análise pelo juiz'],
  ['sane', 'Fase Saneadora', '#0F6E56', 'Regularizando documentos'],
  ['instr', 'Fase Instrutória', '#8a5a00', 'Provas e audiência'],
  ['decis', 'Fase Decisória', '#6d28a8', 'Julgado'],
  ['recur', 'Fase Recursal', '#b5342b', 'Em recurso'],
  ['exec', 'Fase de Cumprimento', '#0e7490', 'Cobrando o que foi ganho'],
  ['alvara', 'Expedir Alvará', '#127a53', 'Alvará — valores a levantar'],
]

export function nomeFase(id) { const m = FASES_META.find(x => x[0] === id); return m ? m[1] : id }
export function corFase(id) { const m = FASES_META.find(x => x[0] === id); return m ? m[2] : '#697180' }
export function faseParaCliente(id) { const m = FASES_META.find(x => x[0] === id); return m ? m[3] : '' }

/* fase efetiva: a travada pelo escritório vence o palpite */
export function faseDoProcesso(p) {
  const manual = p && (p.fase_manual || p.fase)
  return manual ? String(manual) : guessFase(p)
}

export function guessFase(p){
  /* Só o COMEÇO de cada andamento entra no palpite. Desde que o sistema passa a
     guardar o inteiro teor das decisões, um andamento pode ter milhares de
     palavras — e a fase real aparece no título do movimento ("Cumprimento de
     sentença iniciado", "Penhora realizada"), nunca enterrada na página 4 de
     uma fundamentação. Sem este corte, qualquer palavra citada de passagem
     dentro de uma decisão jogava o processo para outra fase. */
  var mv=(p.hist_full&&p.hist_full.length)?p.hist_full.slice(0,6).map(function(m){return String(m.texto||"").slice(0,600);}).join("  "):"";
  var t=(mv+"  "+(p.hist||"")+"  "+(p.tipo||"")+"  "+(p.status||"")).toLowerCase();
  /* 0) PRIORIDADE PELA CLASSE/ASSUNTO do processo — é o sinal mais confiável e vence
     palavras soltas que aparecem no meio do texto (ex.: "execução" citada de passagem). */
  var cls=((p.tipo||"")+" "+(p.classe||"")).toLowerCase();
  if(/agravo de instrumento/.test(cls))return "decis";                              /* AI é fase decisória (interlocutória) */
  if(/apela[çc][ãa]o|recurso inominado|recurso especial|recurso extraordin[áa]rio|embargos infringentes/.test(cls))return "recur";
  if(/cumprimento de senten|cumprimento provis[óo]rio|cumprimento definitivo|execu[çc][ãa]o de t[íi]tulo|execu[çc][ãa]o fiscal/.test(cls))return "exec";
  /* 0.5) EXPEDIR ALVARÁ — fase final: dinheiro disponível para levantamento */
  if(/expedi[çc][ãa]o de alvar|expedir (o )?alvar|alvar[áa] (de levantamento|eletr[ôo]nico|judicial|expedido)|levantamento de valores|levantamento de dep[óo]sito|libera[çc][ãa]o de valores|transfer[êe]ncia dos valores|conta judicial.*levant/.test(t))return "alvara";
  /* 1) CUMPRIMENTO — cumprimento de sentença / execução / constrição patrimonial.
     Só termos que indicam a FASE do nosso processo. Ficaram de fora, por darem
     falso positivo em ação de conhecimento (24/08/2026):
       • "execução" solto — casa com "execução extrajudicial" da Lei 9.514 (o
         risco que a inicial quer EVITAR), "execução do contrato", "inexecução";
       • "leilão"/"adjudicação"/"arrematação" soltos — são o ASSUNTO de boa
         parte das ações imobiliárias, não a fase delas.
     Exemplo real que motivou o ajuste: 0744809-54.2026.8.07.0001, ação recém
     ajuizada, virou "Fase de Cumprimento" porque a decisão da tutela citava
     "procedimento de execução extrajudicial (…) culminando em leilão". */
  if(/cumprimento de senten|cumprimento provis[óo]rio|cumprimento definitivo|execu[çc][ãa]o de t[íi]tulo|execu[çc][ãa]o fiscal|processo de execu[çc][ãa]o|fase de execu[çc][ãa]o|inicia(da|do|r) a execu[çc][ãa]o|\bpenhora|sisbajud|bacenjud|renajud|infojud|precat[óo]|requisi[çc][ãa]o de pequeno valor|\brpv\b|liquida[çc][ãa]o de senten|hasta p[úu]blica|bloqueio de valores|impugna[çc][ãa]o ao cumprimento|carta de adjudica|auto de arremata|edital de leil|leil[ãa]o judicial|designa(do|[çc][ãa]o de) leil/.test(t))return "exec";
  /* 2) RECURSAL — só APÓS sentença, subida ao 2º grau (não classificar por embargos de declaração isolado) */
  if(/apela[çc][ãa]o|\bapelo\b|2º grau|segundo grau|inst[âa]ncia superior|superior tribunal|\bstj\b|\bstf\b|turma recursal|recurso inominado|recurso especial|recurso extraordin[áa]rio|contrarraz[õo]es (de|à) apela|subida dos autos|remessa (ao|dos autos ao) tribunal|remetid(o|os|a|as) (os )?autos[^|]{0,60}(recurso|tribunal|inst[âa]ncia superior|turma recursal)|distribu[íi]do.*(desembargador|relator)|conclus[ão].*relator|ac[óo]rd[ãa]o/.test(t))return "recur";
  /* 3) DECISÓRIA — SÓ com SENTENÇA ou ACÓRDÃO (ou os autos conclusos para
     sentença/julgamento). Decisão LIMINAR não muda de fase.
     Pedido do dono (26/08/2026): "houve uma decisão liminar, mas isso não
     significa mudança de fase — só deveria mudar com sentença/acórdão".
     Por isso saíram daqui: "tutela antecipada", "tutela de urgência",
     "tutela provisória", "liminar", "decisão interlocutória", "agravo de
     instrumento" e "homolog" solto — todos aparecem no COMEÇO do processo
     (a liminar costuma ser a 1ª decisão, antes até da contestação) e
     empurravam para a Fase Decisória um processo recém-ajuizado.
     "Agravo de instrumento" continua valendo pela CLASSE do processo (item 0
     acima): ali o processo É o agravo, não uma menção de passagem.
     Exemplo real: 0744809-54.2026.8.07.0001 — liminar deferida em processo em
     fase instrutória virava "Fase Decisória". */
  if(/conclus[ãao].*(senten|julgamento)|para senten[çc]a|aguardando senten|senten[çc]a (prolatada|proferida|publicada|de m[ée]rito|homologat)|prolatada a senten|profer(ida|ido) (a )?senten|julgo (procedente|improcedente|parcialmente|extinto)|julgad[oa] (procedente|improcedente|parcialmente)|(pela )?proced[êe]ncia (do|da) (pedido|a[çc][ãa]o)|improced[êe]ncia (do|da) (pedido|a[çc][ãa]o)|resolvo o m[ée]rito|resolu[çc][ãa]o do m[ée]rito|extin[çc][ãa]o (do processo|do feito)|homologa[çc][ãa]o (do|de) acordo|homolog(o|ou|ada|ado)\s+(o\s+|a\s+)?acordo|acordo homologad|exting(o|ue|uiu|to|uindo)\s+(o\s+)?(processo|feito)|ac[óo]rd[ãa]o/.test(t))return "decis";
  /* 4) INSTRUTÓRIA — audiência (instrução), perícia, provas */
  if(/audi[êe]ncia|\baij\b|instru[çc][ãa]o e julgamento|per[íi]cia|per[íi]cial|laudo|oitiva|depoimento|testemunh|especificar provas|especifica[çc][ãa]o de provas|produ[çc][ãa]o de provas|rol de testemunh|design(ada|ado|ação) de audi/.test(t))return "instr";
  /* 5) SANEADORA (aqui = pendências de documento/emenda) — emenda à inicial, juntar documentos, gratuidade */
  if(/emenda (à|a) inicial|emende a inicial|emendar a inicial|juntar (novos )?documento|junte (os )?documento|comprovar (a )?(hipossufici[êe]ncia|gratuidade|renda)|comprove (a )?(hipossufici[êe]ncia|gratuidade)|declara[çc][ãa]o de hipossufici|documento(s)? faltante|regularizar (a )?representa|procura[çc][ãa]o|custas iniciais|recolher (as )?custas|indefer.*gratuidade|sanea|pontos controvertid|despacho saneador/.test(t))return "sane";
  /* 6) CONHECIMENTO — início do processo (padrão). Audiência já jogou para instrução acima. */
  return "post";}
