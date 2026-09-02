---
name: analise-autos-cmp
description: >
  Análise forense dos autos: lê TODOS os documentos do processo (inicial, contestação,
  réplica, sentença, provas, laudos, depoimentos) e os cruza para achar três coisas que
  decidem recurso — (1) contradições entre o que a decisão afirma e o que os documentos
  provam; (2) fatos alegados que ficaram SEM prova; (3) provas nos autos que NENHUMA
  parte explorou. Organiza por ordem de impacto, apontando documento e página. Use SEMPRE
  que o usuário pedir para "analisar os autos", "ler o processo inteiro", "cruzar os
  documentos", "achar contradição na sentença", "o que ficou sem prova", "prova que
  ninguém usou", "auditar o processo", "revisar os autos antes do recurso", "mapa de
  prova", "diagnóstico do processo", ou anexar vários documentos de um processo pedindo
  leitura de conjunto. Serve em qualquer fase e para assumir caso de outro advogado. NÃO
  redige peça (é `peticoes-cmp`) nem ataca uma peça isolada (é `rebater-cmp`): diagnostica
  o processo inteiro, que depois alimenta aquelas.
---

# Análise forense dos autos (padrão CMP)

Enquanto as outras skills olham **uma peça**, esta olha o **processo inteiro** e cruza os
documentos entre si. O objetivo é achar o que só aparece quando se lê tudo junto: onde a
sentença afirma algo que a prova não sustenta, o que cada parte alegou e nunca provou, e a
prova que já está nos autos e ninguém aproveitou. Esses três achados são o que costuma
virar razão de apelação, embargos de declaração ou virada de estratégia.

Esta skill **diagnostica**; não redige peça nem decide estratégia. Ela mapeia e ordena por
impacto; o advogado decide o que fazer com cada achado.

## 1. O que entra e como ler

Entram todos os documentos de **um mesmo processo**: inicial, contestação, réplica,
sentença/decisões interlocutórias, documentos e provas juntados, laudos periciais, termos
de audiência e depoimentos. Podem chegar como texto colado, .docx ou **PDF (muitas vezes
escaneado)**.

- Para PDF escaneado (sentença, depoimento, prova antiga), use a skill `pdf` para extrair
  o texto (com OCR quando necessário). Se o OCR vier ruim ou ilegível num ponto relevante,
  **sinalize** — não adivinhe o conteúdo.
- Antes de cruzar, monte um **índice rápido**: que documento é cada arquivo, de que parte
  vem, e a que fato/pedido se refere. Sem esse mapa você não consegue cruzar com segurança.
- **Nunca invente conteúdo dos autos.** Se um documento é citado mas não foi juntado (a
  inicial menciona um contrato que não está anexado, p.ex.), isso **é um achado** (fato
  sem prova), não uma lacuna para preencher de cabeça.

## 2. Os três eixos de análise

Leia tudo com estas três perguntas rodando em paralelo. Cada uma gera um tipo de achado.

**Eixo 1 — Contradição entre a decisão e a prova.** Compare cada afirmação de fato da
sentença (ou de uma decisão) com o que os documentos realmente mostram. Procure: a
sentença deu por provado um fato que nenhum documento sustenta; ignorou uma prova que
apontava o contrário; afirmou que "não há prova de X" quando X está no doc tal; baseou-se
em depoimento que contradiz documento; errou uma data, valor ou premissa fática que os
autos desmentem. **Aqui mora a matéria de apelação e de embargos de declaração** (omissão,
contradição, erro material).

**Eixo 2 — Fato alegado sem qualquer prova.** Varra o que cada parte *afirmou* e cheque se
há lastro probatório. Um fato central da causa de pedir (ou da defesa) que ficou só na
alegação é um flanco — do seu lado, é o que você precisa provar; do lado adversário, é o
que você ataca. Diga de quem é o ônus (art. 373 do CPC) e se a parte se desincumbiu.

**Eixo 3 — Prova nos autos que ninguém explorou.** Este é o achado mais valioso e o mais
fácil de passar batido: um documento juntado (às vezes pela própria parte contrária) que
contém algo que ninguém usou no argumento — uma cláusula, uma data, uma confissão embutida
num e-mail, um número num extrato, um trecho de depoimento. Prova subutilizada muda o jogo
porque já está nos autos, sem precisar de nova produção.

## 3. Ordem de impacto (o organizador)

O valor da análise está na **ordem**. Ordene todos os achados pelo quanto cada um muda o
resultado do processo, não pela ordem em que aparecem nos autos. Um critério prático:

- **ALTO** — achado que, sozinho, pode reverter/definir o mérito ou fundamentar recurso
  com boa chance (contradição frontal da sentença com a prova; fato central sem prova;
  prova decisiva ignorada).
- **MÉDIO** — reforça a tese ou abre flanco relevante, mas não decide sozinho.
- **BAIXO** — inconsistência menor, útil de registrar mas de pouco peso.

Para cada achado indique **onde está** o mais preciso que os documentos permitirem
(documento + página/tópico + de que parte veio). O método é **localizar e parafrasear**:
aponte a localização e resuma o conteúdo com fidelidade — sem transcrição literal. Quando
o advogado for citar o trecho numa peça e precisar da transcrição exata, ofereça extrair o
literal via `pdf` naquele ponto.

## 4. Formato da saída

Relatório em prosa objetiva, organizado por impacto, nesta ordem:

    ═══ MAPA DOS AUTOS ═══
    Uma linha por documento analisado: o que é, de que parte, a que se refere.
    (Serve para o advogado conferir que nada ficou de fora.)

    ═══ ACHADOS POR ORDEM DE IMPACTO ═══
    Do ALTO ao BAIXO, um parágrafo por achado. Cada um traz:
    • [ALTO/MÉDIO/BAIXO] + o tipo (contradição decisão×prova / fato sem prova /
      prova não explorada);
    • o que é, em prosa direta;
    • onde está: [Documento, p. X] (de quem);
    • por que importa para o resultado (e, quando couber, que uso processual tem —
      apelação, embargos, impugnação, alegações finais).

    ═══ PENDÊNCIAS E LACUNAS ═══
    Documentos citados mas não juntados; pontos de OCR ilegível; provas que
    conviria produzir. Marque [A CONFIRMAR] o que depender de verificação.

Regras: seja específico na localização; ligue cada achado ao resultado do processo; não
force achado onde não há (se os autos estão coerentes num ponto, o silêncio já diz isso);
e separe o que é **fato provado** do que é **interpretação sua** — o advogado precisa saber
o que é leitura dos autos e o que é sua inferência.

## 5. Depois do diagnóstico

O relatório é insumo, não peça. Ofereça os próximos passos conforme o que o advogado
quiser fazer:

- **Gerar relatório .docx** (mapa de prova formal, para juntar ao caso ou arquivar): via
  `peticoes-cmp` / skill `docx`.
- **Gerar planilha-mapa de prova .xlsx** (achado | tipo | documento/página | de quem |
  impacto | uso processual): via skill `xlsx`. Útil em processo grande, como índice.
- **Transformar achados em peça**: se o objetivo é recorrer/impugnar, os achados do Eixo 1
  viram razões de apelação/embargos e os do Eixo 3 viram argumento novo — encaminhe para
  `peticoes-cmp` (redação) e, se for para antecipar o adversário, para `rebater-cmp`.

A escolha é do advogado; a skill entrega o mapa e sinaliza o uso possível de cada achado.

## 6. Princípios inegociáveis

1. **Nunca inventar conteúdo dos autos.** Data, valor, trecho, nome, número de documento —
   só do que está efetivamente juntado. Documento citado e não juntado é achado, não
   lacuna a preencher. OCR duvidoso se sinaliza, não se adivinha.
2. **Separar prova de inferência.** Diga o que os documentos provam e, à parte, o que você
   deduz do conjunto. Não vista sua interpretação de fato provado.
3. **Ordenar por impacto, sempre.** Uma lista de 30 achados sem hierarquia é inútil para
   quem tem prazo. O trabalho é dizer o que importa primeiro.
4. **Jurisprudência (se surgir) é linha de risco, não acórdão inventado.** Esta skill lida
   com prova, não com precedente; se precisar apontar tendência, aponte a tese e mande
   verificar — sem número de acórdão de memória.
5. **A decisão é do advogado.** A skill diagnostica e ordena; usar, descartar ou aprofundar
   cada achado é do humano.
