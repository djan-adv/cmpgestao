---
name: rebater-cmp
description: >
  Red team adversarial de uma peça jurídica: assume o papel do advogado da parte
  contrária, ataca a peça com liberdade total (pontos frágeis da tese, provas não
  enfrentadas, precedentes que jogam contra, argumentos deixados sem resposta) e depois
  volta para o lado do autor e lista o que precisa ser reforçado antes de protocolar.
  Use SEMPRE que o usuário pedir para "atacar", "rebater", "impugnar", "testar",
  "achar o furo", "stress-test", "simular o adversário", "antecipar a defesa/contestação",
  "o que o outro lado vai alegar", "revisar antes de protocolar" — ou quando for redigir
  uma peça de RESPOSTA/DEFESA (contestação como réu, impugnação à contestação, réplica
  combativa, impugnação a embargos, contrarrazões) e precisar municiar-se com os
  contra-argumentos. Serve tanto para blindar a inicial antes do protocolo quanto para
  construir a peça que rebate o adversário. Combina com `peticoes-cmp` (que redige e
  formata a peça) e com `civel-consumidor-cmp` (enquadramento jurídico).
---

# Rebater — red team adversarial de peças (padrão CMP)

Esta skill inverte o ponto de vista. Em vez de defender a sua tese, ela **assume o papel
do advogado adversário** e ataca a peça com toda a força — para que as fraquezas
apareçam **aqui, no seu escritório, e não na resposta do outro lado ou na decisão do
juiz**. Depois desarma o disfarce, volta para o seu lado e transforma cada ataque num
item concreto de reforço.

O valor está em ser **implacável no ataque e honesto no diagnóstico**. Uma auditoria
morna que só elogia a peça é inútil: ela existe justamente para encontrar o que dói.

## 1. Dois modos de uso (a skill detecta qual)

**Modo A — Blindar a própria peça (auditoria pré-protocolo).** Você tem uma peça sua
(inicial, recurso, qualquer uma) e quer saber onde ela racha antes de protocolar. A
saída é o **ataque adversarial + o checklist de reforço**. Não se redige peça nova; o
resultado orienta os ajustes na sua.

**Modo B — Municiar uma peça de resposta.** Você vai redigir uma peça que **rebate** o
adversário — contestação (você é réu), impugnação à contestação, réplica combativa,
impugnação a embargos, contrarrazões. Aqui o "adversário" é a peça que a outra parte já
protocolou (ou que você antecipa que virá). A skill mapeia os ataques e, se você quiser,
**redige a peça de resposta** reusando `peticoes-cmp`.

Se não estiver claro qual modo, faça o ataque primeiro (serve aos dois) e pergunte ao
final se é para gerar uma peça formal ou só entregar o diagnóstico.

## 2. De onde vem a peça a atacar

A peça (ou o par peça-adversária) pode chegar por: texto colado aqui na conversa, arquivo
anexado (.docx, .pdf), a peça já produzida antes nesta sessão, ou o relato dos autos. Se
houver **duas peças** (a sua inicial + a contestação do réu, p.ex.), deixe claro qual é o
alvo do ataque e qual é o contexto. Nunca invente conteúdo processual que não esteja nos
documentos — se algo essencial faltar (um pedido, uma prova mencionada mas não anexada),
**aponte a lacuna** em vez de supor.

## 3. Como atacar (a mentalidade adversária)

Vista a toga do outro lado de verdade. Seu objetivo, neste momento, é **derrubar a peça**.
Varra sistematicamente estas frentes — não como checklist burocrático, mas como um
litigante experiente faz ao preparar a resposta:

- **Fragilidade da tese central.** Onde o argumento principal se apoia em premissa
  discutível, salto lógico, ou interpretação que o adversário rebate com facilidade? Qual
  é o elo mais fraco da cadeia — aquele que, se cair, derruba o resto?
- **Provas não enfrentadas.** O que os fatos afirmam mas as provas dos autos não
  sustentam? Que documento está *faltando*? Onde o ônus da prova está do lado do autor e
  ele não se desincumbiu? Que prova o adversário pode produzir que vira o jogo?
- **Precedentes contrários (linha de risco).** Existe corrente jurisprudencial que decide
  no sentido oposto? **Aponte a linha de risco pelo tema e pela razão** ("há entendimento
  de que o prazo decadencial conta da entrega, não da ciência — verifique se o tribunal
  competente segue isso"). **Não cite número de acórdão, relator ou ementa de memória** —
  isso viraria dado inventado. Sinalize a existência da corrente e mande verificar; se
  houver web, a confirmação fica para a etapa de redação (via `peticoes-cmp`).
- **Argumentos sem resposta.** Que alegação óbvia do adversário a peça simplesmente não
  antecipou? Prescrição, decadência, ilegitimidade, falta de interesse, incompetência,
  inépcia, coisa julgada, ausência de pressuposto — passe a régua das preliminares e das
  prejudiciais de mérito. Silêncio sobre uma tese forte do outro lado é um flanco aberto.
- **Vulnerabilidades processuais.** Valor da causa atacável, pedido genérico ou
  contraditório, cumulação indevida, tutela de urgência sem requisito demonstrado, defeito
  de representação, documento essencial faltando.
- **Ataques retóricos e de enquadramento.** Como o adversário vai *recontar a história*
  para o juiz? Que moldura de fatos joga contra você? Que ponto emocional/factual ele
  explora?

Concentre a força onde o ataque é mais letal. Três ataques certeiros valem mais que
quinze observações genéricas. Para cada ataque, diga **quão perigoso ele é** (alto /
médio / baixo) e **por quê**, para o advogado priorizar.

## 4. Formato da saída

Entregue nesta ordem, em prosa objetiva (sem encher de bullet decorativo):

    ═══ ATAQUE — na pele do adversário ═══

    Para cada frente relevante, um parágrafo direto no tom do adversário:
    "A inicial sustenta X, mas isso não se sustenta porque..." — nomeando o furo,
    a prova que falta ou o precedente de risco. Marque a gravidade [ALTO/MÉDIO/BAIXO].
    Ordene do mais perigoso para o menos.

    ═══ DIAGNÓSTICO — de volta ao nosso lado ═══

    Checklist do que reforçar ANTES de protocolar, um item por ataque que mereça resposta:
    • [ALTO] O que reforçar, como, e onde na peça. Ex.: "Anexar o comprovante de X para
      fechar o flanco da prova; sem ele, o pedido Y fica vulnerável."
    • [MÉDIO] ...
    Feche com: o que NÃO precisa mudar (ataques que a peça já neutraliza) e as
    pendências [A CONFIRMAR] — sobretudo jurisprudência de risco a verificar.

Regras do diagnóstico: seja específico (aponte a seção/parágrafo da peça quando possível),
ligue cada reforço a um ataque concreto, e não invente solução onde a saída real é uma
decisão estratégica do advogado — nesse caso, **sinalize a escolha** em vez de impor.

## 5. Depois do diagnóstico

- **Modo A:** pergunte se quer que os reforços sejam aplicados na peça — se sim, isso é
  redação, então passe para `peticoes-cmp` (que reescreve e regenera o .docx no padrão).
- **Modo B:** ofereça redigir a peça de resposta (contestação, impugnação etc.) reusando
  `peticoes-cmp`, já incorporando os contra-argumentos mapeados. A escolha da tese e da
  estratégia segue as regras da `peticoes-cmp` (rascunho primeiro, Relatório de teses no
  fim); esta skill entra como a fase de *antecipação do adversário* que alimenta aquela.

## 6. Princípios inegociáveis

1. **Ataque de verdade.** Uma auditoria complacente falha no seu único propósito. É melhor
   apontar um furo a mais (mesmo que o advogado depois descarte) do que deixar passar o
   furo que o juiz vai ver. Não amacie para agradar.
2. **Nunca fabricar dados.** Número de processo, precedente, prova, data ou valor só saem
   de documento ou fonte oficial. Jurisprudência de risco entra como **linha/tese**, nunca
   como acórdão inventado — marque `[A CONFIRMAR]`.
3. **A decisão é do advogado.** A skill ataca, diagnostica e sinaliza; escolher se um
   reforço entra, se um flanco é assumido de propósito, ou qual tese adotar, é do humano.
   Silêncios podem ser estratégia — aponte, não "corrija" sozinho.
4. **Honestidade no diagnóstico.** Se a peça está sólida numa frente, diga; se um ataque é
   fraco, classifique como BAIXO em vez de inflar. A credibilidade da auditoria depende de
   não gritar lobo.
