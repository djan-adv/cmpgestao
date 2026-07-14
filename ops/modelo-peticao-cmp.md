# Manual de Padrão CMP para Petições

> **Escritório:** Crispim, Mendonça e Pinheiro Advogados (CMP) — João Pessoa/PB
> **Objeto:** método de escrita, estrutura, formatação, fecho, dados fixos e regras de
> conteúdo das peças do escritório. Documento autossuficiente para uso em outro sistema.
> **Origem:** consolidação literal da skill interna `peticoes-cmp` (SKILL.md + 5 arquivos
> de referência + script `build_peticao.py`). Nada foi resumido: o texto abaixo reorganiza
> e transcreve integralmente as regras da skill, e o **Anexo A** traz os arquivos literais.

---

## 0. Princípios inegociáveis (leia sempre)

1. **Nunca fabricar dados.** CPF, CNPJ, endereços, números de processo, valores e
   detalhes de citação **só** podem vir de documentos enviados ou de fonte oficial.
   Na ausência do dado, deixe um campo entre colchetes `[A PREENCHER]` — nunca invente.
2. **Jurisprudência só entra verificada.** Não reproduza ementa, número de acórdão,
   relator ou data de julgamento de memória — nunca. Antes de inserir qualquer
   jurisprudência: (a) faça a busca na fonte oficial/tribunal; (b) se confirmar,
   transcreva com grifo; (c) se **não** confirmar, ou se **não houver acesso à web**,
   não insira — deixe `[JURISPRUDÊNCIA A CONFIRMAR: tese X]` e avise ao final da entrega.
   Jamais preencha a lacuna com ementa reconstruída de memória.
3. **IRAC em prosa fluida, sem rótulos visíveis.** Cada tópico do Direito desenvolve, em
   texto corrido: a questão, a regra (lei + jurisprudência), a aplicação aos fatos e a
   conclusão — **sem** escrever "Issue/Rule/Application/Conclusion" no corpo.
4. **A decisão estratégica é do advogado.** Silêncios deliberados (p.ex., não reintroduzir
   o valor da causa numa réplica) são estratégia — não os "corrija" sem instrução. Quando
   enxergar risco, prazo, prescrição ou alternativa, **sinalize**; não imponha.
5. **Tom:** objetivo, técnico e persuasivo; robustez concentrada no ponto mais forte da
   tese; sem floreios. Concisão com densidade.
6. **Rascunho primeiro, validação da tese no fim — nunca antes.** Para qualquer peça que
   dependa de tese (sobretudo a inicial), não pare para perguntar qual tese usar. Leia os
   fatos, escolha a tese que a análise indicar como a mais vencedora para *aquele* caso,
   redija o rascunho completo com ela e, ao final, entregue o **Relatório de teses** (§9).

---

## a. Estrutura da peça (ordem das seções)

Arquitetura padrão da **petição inicial** consumerista/cível (a ordem adapta-se ao tipo —
ver adaptações no fim desta seção):

1. **Endereçamento** — "AO JUÍZO DE DIREITO DA/DO [vara/núcleo/comarca]…". Inserir um
   parágrafo em branco médio (~3 linhas) logo após o endereçamento, antes do nº do
   processo/qualificação. Confirmar a competência antes de fixar o foro.
2. **Qualificação do autor** — nome em negrito, nacionalidade, estado civil, RG, CPF,
   endereço, e-mail; "por intermédio de seu advogado (procuração anexa), com escritório à
   [endereço CMP], onde recebe intimações, vem propor a presente".
3. **Nome da ação** — centralizado, em negrito e caixa alta.
4. **"em face de"** — cada réu qualificado em negrito; identificar a **filial**
   vendedora/financeira quando houver (razão social + CNPJ próprio).
5. **SÍNTESE DA DEMANDA** — resumo executivo no topo, **sem numeração romana** (banner de
   seção). Um período de abertura ("Para imediata compreensão de Vossa Excelência…")
   seguido de uma **lista numerada em caixa** (1, 2, 3…), cada item com **lead-in em
   negrito** resumindo um pilar da causa (fato → tese → dispositivo). Fecho: "Cada um
   desses pontos será detidamente discorrido e comprovado pelos fatos e fundamentos a
   seguir." Objetivo: o juiz lê só isso e entende a causa inteira e seus porquês.
6. **I – DA GRATUIDADE DA JUSTIÇA** — a numeração romana começa aqui. Art. 98 do CPC;
   presunção do art. 99, §3º; declaração anexa.
7. **II – DA COMPETÊNCIA** — em consumo, foro do domicílio do consumidor (art. 101, I, do
   CDC), norma de ordem pública. Fundamentar a escolha do foro.
8. **III – DOS FATOS** — em **ordem cronológica**, do primeiro ao último acontecimento.
   Amarrar cada fato ao documento que o prova (anexo X). Destacar em negrito os
   fatos-âncora (a omissão, o defeito, a cláusula que obriga o réu) e as **datas**.
   Terminar com o "cerne da causa" em uma frase ("Eis o cerne: …"). Quando útil, inserir a
   **imagem-prova destacada**.
9. **IV – DO DIREITO** — subtópicos `IV.1`, `IV.2`… em IRAC-prosa. Para cada subtópico:
   abrir com a questão; expor a regra (lei + jurisprudência verificada e grifada); aplicar
   aos fatos; concluir — sem rótulos visíveis. Ordem típica numa ação de consumo de
   veículo (adaptar ao caso):
   - Relação de consumo e responsabilidade objetiva (arts. 2º, 3º, 12, 14, 6º VIII).
   - Núcleo da tese (o ponto mais forte — robustez máxima aqui).
   - Impedimentos legais correlatos (p.ex., CTB para transferência).
   - **Prova documental e desnecessidade de perícia**, quando a controvérsia for documental.
   - Falha do serviço e omissão informacional (arts. 14, 6º III, 30, 31).
   - Nulidade de cláusulas abusivas / "no estado" (art. 51).
   - Venda casada (art. 39, I).
   - Tempestividade / afastamento da decadência (art. 26, §3º).
   - Coligação contratual de crédito (art. 54-F do CDC; litisconsórcio da financeira,
     art. 114 do CPC; baixa do gravame).
   - **Danos materiais item a item**, explicando o *porquê* de cada verba.
   - **Danos morais** detalhados: por que feriu direitos da personalidade; o risco
     concreto; dano *in re ipsa*; ancorar o *quantum* em precedente análogo verificado.
10. **V – DA TUTELA DE URGÊNCIA** (art. 300 do CPC — quando houver). Tópico decisivo.
    Demonstrar, ligando aos fatos: probabilidade do direito (*fumus* — prova documental do
    núcleo); perigo de dano (*periculum* — prejuízo concreto e atual); pedido específico
    (suspensão/depósito; vedações), inaudita altera parte, sob multa.
11. **VI – DOS PEDIDOS** — em caixa, alíneas a), b)… Blocos processuais primeiro
    (gratuidade, tutela, citação, inversão do ônus/julgamento antecipado); depois **mérito
    separado por réu**. Cada pedido pecuniário casa com uma verba do tópico de danos.
    Pedidos subsidiários explícitos. Custas e honorários; provas ao final.
12. **Valor da causa** — parágrafo final, sem banner próprio. Soma dos proveitos econômicos
    (restituições + indenizações + dobro etc.), com **valor por extenso** e ressalva das
    parcelas vincendas (art. 323 do CPC). Confirmar o número com o advogado.
13. **Fecho** — "Nestes termos, / Pede deferimento." + local e data.
14. **Dupla subscrição** — Djan e Jader, cada um com linha de assinatura (ver item f).

**Adaptações por tipo de peça** (os parâmetros de forma e método se mantêm; muda o
esqueleto):

- **Contestação:** endereçamento › tempestividade › preliminares (uma por vez) › mérito
  por impugnação especificada (art. 341 do CPC) › pedidos › provas. Cabe a "Síntese da
  Defesa" em caixa, no lugar da Síntese da Demanda.
- **Réplica:** rebate a contestação ponto a ponto; **com timbre** (como todas as peças);
  não reintroduzir silêncios estratégicos (p.ex., valor da causa).
- **Apelação / recurso:** tempestividade e preparo › síntese do inconformismo em caixa ›
  razões recursais (IRAC-prosa) › prequestionamento › pedido de reforma.
- **Embargos de declaração:** apontar objetivamente omissão/contradição/obscuridade/erro
  material (art. 1.022 do CPC); estrutura curta, um vício por tópico; efeitos infringentes
  só se cabíveis.
- **Contrarrazões:** admissibilidade › refutação das razões do recorrente › manutenção do
  julgado.
- **Cumprimento de sentença / execução:** título e exigibilidade › planilha de débito
  atualizado › requerimentos de constrição (SISBAJUD/RENAJUD/INFOJUD/CNIB/SREI) › pedidos.

---

## b. Endereçamento / cabeçalho

- **Fórmula do escritório:** `AO JUÍZO DE DIREITO DA/DO [vara/núcleo/comarca]…` — **NÃO**
  usar "EXCELENTÍSSIMO SENHOR DOUTOR JUIZ", salvo ordem em contrário.
- Após o endereçamento, inserir **um parágrafo em branco médio (~3 linhas)** antes do
  número do processo / qualificação.
- **Nome da ação:** centralizado, em **negrito** e **caixa alta**.
- **Banners de seção** (versão legal design): parágrafo com fundo navy e texto branco em
  negrito. A Síntese da Demanda é banner **sem numeração romana**; a numeração romana só
  começa em "I – DA GRATUIDADE DA JUSTIÇA".
- **Ressalva conhecida:** o `.docx` exemplar do escritório abre com "EXCELENTÍSSIMO(A)
  SENHOR(A) DOUTOR(A) JUIZ(A) DE DIREITO DE…", o que **conflita** com a instrução
  permanente (endereçamento por Juízo). **Default adotado:** seguir a instrução permanente
  (por Juízo), por ser a regra mais recente e explícita, salvo ordem em contrário. Se a
  intenção for oficializar a fórmula "EXCELENTÍSSIMO", atualizar a instrução permanente.

---

## c. Linguagem e estilo

**Método — IRAC em prosa (sem rótulos).** O texto é corrido; não se escreve "Issue",
"Rule" etc. Cada parágrafo naturalmente: (1) abre com a questão ("Discute-se aqui se…",
"A questão é definir se…"); (2) traz a regra — dispositivo legal + jurisprudência
verificada; (3) aplica ao caso — liga a regra aos fatos concretos e às provas dos autos;
(4) conclui — a consequência jurídica pretendida.

> **Exemplo (resumido):** "Discute-se se a venda de veículo com recall de segurança
> pendente, sem informação, autoriza a rescisão. A resposta é afirmativa. O CDC proíbe
> colocar no mercado produto que acarrete risco à segurança (arts. 8º e 10) e
> responsabiliza objetivamente pelo defeito (art. 12)… No caso, o defeito está provado por
> documento oficial: o CRLV/2024 já registrava 'RECALL NÃO ATENDIDO'… Logo, configurado o
> defeito de segurança, impõe-se a resolução do contrato com restituição das quantias
> pagas (art. 18, §1º, II)."

**Tom e densidade.**
- Objetivo e técnico; persuasivo sem retórica vazia.
- Concentrar **robustez no ponto mais forte** da tese (mais argumento, melhor
  jurisprudência, eventual imagem-prova destacada). Os demais tópicos podem ser enxutos.
- Frases-âncora em negrito, com parcimônia, para guiar a leitura.
- Concisão: cada parágrafo carrega um argumento completo.
- Fatos em ordem cronológica, com **datas em negrito** e fatos-âncora destacados; cada
  fato amarrado ao documento que o prova; fecho dos fatos com o cerne da causa em uma frase.
- Danos item a item, explicando o *porquê* de cada verba.
- Tratamento (fórmula de deferência ao juízo): "Vossa Excelência".

**O que NUNCA fazer.**
- Inventar dados de qualquer natureza (use `[A PREENCHER]`).
- Reproduzir jurisprudência de memória sem verificar.
- Inserir rótulos IRAC no corpo.
- "Corrigir" silêncios estratégicos do advogado sem instrução.
- Decidir a estratégia: a redação **redige e sinaliza**; a decisão é do advogado.

---

## d. Formatação (.docx)

**Versão tradicional (padrão do escritório):**
- Fonte **Barlow** em todo o corpo.
- Texto **justificado**.
- Entrelinha **360** (line, lineRule auto).
- Recuo de **primeira linha 709 twips**.
- Corpo geral em tamanho **24** (12 pt).
- Blocos de **citação**: recuo esquerdo **2268 twips**, **itálico**, tamanho **22**.
- Página **A4**; timbre com logo + marca d'água + rodapé de contato.
- **Todas as peças levam timbre**, inclusive a réplica.
- Títulos de seção em **negrito**; **grifo** na versão tradicional = **negrito + sublinhado**.

**Versão legal design (tipografia jurídica — mesmo conteúdo):**
- **Banners de seção:** fundo navy `2E3A4B` + texto branco em negrito.
- **Subtítulos:** cor navy + borda inferior fina (`pBdr/bottom`).
- **Caixa de síntese / callout:** fundo claro + **borda esquerda** de acento (navy ou
  dourado).
- **Ementas em caixa:** fundo `EEF1F5` + borda esquerda navy; o trecho on-point recebe
  **grifo em destaque** (realce amarelo `FFF1A8` + negrito).
- **Citações de lei** em caixa clara com borda esquerda.
- **Imagem-prova** centralizada, com legenda em itálico menor.
- Mais respiro (espaçamentos maiores).
- **Grifo** na versão legal design = **negrito + realce amarelo** (`FFF1A8`).

**Tokens de cor (legal design):**
- NAVY (banners/bordas/acento): `2E3A4B`
- Fundo claro de caixa: `EEF1F5` / `F6F8FB`
- Grifo (destaque on-point): `FFF1A8`
- Borda dourada de callout: `C9A227`
- Filete de subtítulo: `C7D0DA`

**Citações de lei e ementa:** bloco recuado e em itálico; **uma citação por fonte**, o
restante parafraseado; identificar o precedente ao final entre parênteses — (Tribunal,
classe nº, órgão, relator, data de publicação).

---

## e. Fecho padrão

```
Nestes termos,
Pede deferimento.

[Local], [data].
```

Seguido do bloco de subscrição (ver item f), mantido íntegro (não quebrar entre páginas —
`keepNext/keepLines`).

---

## f. Dados fixos do escritório (dupla subscrição)

Toda peça é subscrita pelos dois procuradores, cada um com sua linha de assinatura:

```
_________________________________________
Djan Henrique Mendonça do Nascimento
OAB/PB 5.219-A

_________________________________________
Jader Gabriel Pinheiro
OAB/PB 33.567
```

- Endereço do escritório na qualificação: `[endereço CMP — a preencher]` (onde a parte
  recebe intimações). **Não consta literalmente na skill** — inserir o endereço oficial do
  escritório ao migrar para o outro sistema.

---

## g. Regras de conteúdo (fatos, lei, jurisprudência)

**Fatos e números.**
- Todo dado (CPF, CNPJ, endereço, nº de processo, valores) vem de documento ou fonte
  oficial. Faltou? `[A PREENCHER]`.
- Número calculado/inferido (valor da causa, débito atualizado): destaque e marque
  `[CONFIRMAR]` — mas **siga redigindo a peça inteira**. Só pare se a falta impedir a
  estrutura (p.ex., não dá para saber quantos réus há).
- As fontes dos fatos: mensagens de WhatsApp, relato da conversa, ou a ficha de cadastro
  do cliente. Consolidar tudo numa linha do tempo antes de redigir.

**Jurisprudência — regras rígidas.**
1. **Verifique antes de citar.** Toda ementa/numeração é "não verificada" até confirmação
   por busca em fonte oficial (tribunal/repositório). Não confirmou → **não use** e avise.
2. **Nunca invente** número de processo, relator, data ou trecho de ementa.
3. **Transcreva com grifo** o trecho da ementa que espelha o caso concreto — é o que dá
   força ("casos praticamente idênticos"). Transcrição focada no relevante.
4. **Distribua** os precedentes pelos tópicos certos (um por ponto), sem amontoar.
5. Prefira **precedentes do tribunal competente** (regional), apoiados por STJ/Súmulas.
6. Sinalize honestamente as **linhas contrárias** relevantes e como a tese as enfrenta.
7. Ancore o *quantum* de danos morais em precedente análogo verificado.

**Biblioteca de teses recorrentes (consumo) — PISTAS, não fontes verificadas.**
> ⚠️ Os números de acórdão/temas/súmulas abaixo servem só para lembrar QUAIS teses existem
> e por onde buscar. **Nunca copie um destes números direto para uma peça.** Antes de
> citar qualquer um, reconfirme por busca em fonte oficial no momento do uso.
- Garantia legal incide sobre produto usado (STJ, REsp 1.661.913/MG).
- Dobro independe de má-fé para cobranças após 30/03/2021 (STJ, EAREsp 676.608/RS).
- Venda casada de seguro prestamista: art. 39, I; Tema 972/STJ.
- Coligação de crédito ao consumo: art. 54-F do CDC (Lei 14.181/2021), §§ 2º e 4º.
- Decadência de vício oculto conta da ciência (art. 26, §3º, do CDC).
- Dano moral *in re ipsa* quando há risco à segurança/incolumidade.

**Relatório de teses (fecho de toda peça com tese).** Fora do corpo da peça, entregar um
bloco curto: tese principal adotada e por quê (fundamentos legais); teses
subsidiárias/cumulativas; alternativas descartadas e o motivo; status da jurisprudência
(confirmada / `[A CONFIRMAR]`); pendências (`[A PREENCHER]` / `[CONFIRMAR]` que restaram).
É o ponto por onde o advogado corrige — apontada outra tese, reajusta-se a peça.

---

## h. Exemplo curto no padrão CMP (dados anonimizados / a preencher)

> Referência de estilo. Dados fictícios/omitidos como `[A PREENCHER]`; jurisprudência
> deixada como `[JURISPRUDÊNCIA A CONFIRMAR]` conforme a regra.

```
AO JUÍZO DE DIREITO DA [VARA] CÍVEL DA COMARCA DE [COMARCA]/PB



[nome do autor], [nacionalidade], [estado civil], portador do RG nº [A PREENCHER]
e inscrito no CPF sob o nº [A PREENCHER], residente e domiciliado à [A PREENCHER],
e-mail [A PREENCHER], por intermédio de seus advogados que esta subscrevem
(procuração anexa), com escritório à [endereço CMP], onde recebe intimações, vem,
respeitosamente, à presença de Vossa Excelência, propor a presente

                    AÇÃO DE RESCISÃO CONTRATUAL C/C RESTITUIÇÃO DE
                     VALORES E INDENIZAÇÃO POR DANOS MORAIS, COM
                              PEDIDO DE TUTELA DE URGÊNCIA

em face de [RÉ 1 — razão social], inscrita no CNPJ sob o nº [A PREENCHER], com sede
à [A PREENCHER], e de [RÉ 2 — instituição financeira/filial], CNPJ nº [A PREENCHER],
pelos fatos e fundamentos a seguir.

SÍNTESE DA DEMANDA

Para imediata compreensão de Vossa Excelência, resume-se o litígio:

  1. [Fato-âncora em negrito] — [tese] — [dispositivo].
  2. [Fato-âncora em negrito] — [tese] — [dispositivo].
  3. [Fato-âncora em negrito] — [tese] — [dispositivo].

Cada um desses pontos será detidamente discorrido e comprovado pelos fatos e
fundamentos a seguir.

I – DA GRATUIDADE DA JUSTIÇA

O autor não dispõe de condições de arcar com as custas sem prejuízo do próprio
sustento, fazendo jus à gratuidade (art. 98 do CPC), presumida a hipossuficiência
da pessoa natural (art. 99, §3º), conforme declaração anexa.

II – DA COMPETÊNCIA

Tratando-se de relação de consumo, é competente o foro do domicílio do consumidor
(art. 101, I, do CDC), norma de ordem pública, fixando-se a competência desta
comarca.

III – DOS FATOS

Em [data], o autor [primeiro fato, amarrado ao anexo X]. Em [data], [segundo fato,
anexo Y]. (...) Eis o cerne: [uma frase que sintetiza a causa].

IV – DO DIREITO

IV.1 – Da relação de consumo e da responsabilidade objetiva

Discute-se, inicialmente, o regime aplicável. A regra é a do CDC: autor e rés se
enquadram nos arts. 2º e 3º, respondendo o fornecedor objetivamente pelo defeito
(arts. 12 e 14). No caso, [aplicação aos fatos e às provas dos autos]. Logo,
[conclusão].

IV.2 – [Núcleo da tese — robustez máxima aqui]

[Questão]. [Regra: dispositivos + jurisprudência verificada e grifada]. [Aplicação].
[Conclusão].

  [JURISPRUDÊNCIA A CONFIRMAR: transcrever ementa on-point, com o trecho que
  espelha o caso em grifo, e referência (Tribunal, classe nº, órgão, relator,
  publicado em DD/MM/AAAA) — somente após verificação em fonte oficial.]

V – DA TUTELA DE URGÊNCIA

Presentes os requisitos do art. 300 do CPC. A probabilidade do direito decorre de
[prova documental do núcleo]. O perigo de dano está em [prejuízo concreto e atual].
Requer-se, inaudita altera parte, [pedido específico], sob multa diária.

VI – DOS PEDIDOS

Ante o exposto, requer:

  a) a concessão da gratuidade da justiça;
  b) o deferimento da tutela de urgência, nos termos acima;
  c) a citação das rés;
  d) a inversão do ônus da prova (art. 6º, VIII, do CDC);

  Quanto à primeira ré ([RÉ 1]):
  e) [pedido de mérito casado com verba do tópico de danos];
  f) a condenação em danos morais no valor de [A PREENCHER];

  Quanto à segunda ré ([RÉ 2]), litisconsorte necessária:
  g) [pedido — p.ex., baixa do gravame / desconstituição do contrato coligado];

  h) a condenação das rés em custas e honorários;
  i) a produção de todas as provas em direito admitidas.

Dá-se à causa o valor de R$ [A PREENCHER] ([por extenso]), ressalvadas as parcelas
vincendas (art. 323 do CPC). [CONFIRMAR]

Nestes termos,
Pede deferimento.

[Local], [data].


_________________________________________
Djan Henrique Mendonça do Nascimento
OAB/PB 5.219-A

_________________________________________
Jader Gabriel Pinheiro
OAB/PB 33.567
```

---

# Anexo A — Conteúdo literal da skill `peticoes-cmp`

> Transcrição integral e literal dos arquivos-fonte, para fidelidade total ao padrão real.

## A.1 — `SKILL.md`

````markdown
---
name: peticoes-cmp
description: >
  Redação de peças jurídicas (petições iniciais, réplicas, contestações, manifestações)
  em Direito do Consumidor e Civil brasileiro, no padrão do escritório CMP (Crispim
  Mendonça e Pinheiro Advogados). Use SEMPRE que o usuário pedir para redigir, revisar,
  enriquecer ou estruturar qualquer peça processual, petição, contrato, parecer ou
  documento jurídico já com a tese definida — mesmo que não cite "CMP" explicitamente —,
  ou quando pedir para GERAR o .docx no padrão do escritório, aplicar legal design, ou
  mencionar ações como "redigir a inicial", "montar a peça", "passar a limpo", "gerar o
  Word", "grifar a ementa", "estruturar a réplica", "formatar no padrão", "IRAC". Para
  decidir QUAL tese cabe, quais artigos aplicar ou quem é parte legítima, use antes a
  skill de enquadramento (civel-consumidor-cmp) e combine as duas: aquela analisa, esta
  redige e formata. Cobre o método de escrita (IRAC em prosa), a estrutura da peça, o
  padrão de formatação (.docx), citação e jurisprudência, e a geração do Word com timbre.
---

# Redação de peças jurídicas — padrão CMP

Esta skill encapsula o **método de escrita** e a **forma** das peças do escritório.
Ela **analisa, propõe a tese, redige e sinaliza** — mas não *decide*: a palavra final
sobre a estratégia é do(a) advogado(a), que corrige o rascunho. Para peças com tese, a
skill escolhe a tese mais vencedora para o caso, redige com ela e justifica no Relatório
de teses (§6); não pergunta antes. Carregue as referências indicadas conforme a tarefa.

## 1. Princípios inegociáveis (leia sempre)

1. **Nunca fabricar dados.** CPF, CNPJ, endereços, números de processo, valores e
   detalhes de citação **só** podem vir de documentos enviados ou de fonte oficial.
   Na ausência do dado, deixe um campo entre colchetes `[A PREENCHER]` — nunca invente.
2. **Jurisprudência só entra verificada.** Não reproduza ementa, número de acórdão,
   relator ou data de julgamento de memória — nunca. Antes de inserir qualquer
   jurisprudência: (a) faça a busca na fonte oficial/tribunal; (b) se confirmar,
   transcreva com grifo; (c) se **não** confirmar, ou se **não houver acesso à web**
   nesta sessão, não insira — deixe `[JURISPRUDÊNCIA A CONFIRMAR: tese X]` e avise o
   usuário ao final da entrega. Jamais preencha a lacuna com ementa reconstruída de
   memória. **Ementas e números de acórdão que aparecem nos arquivos de referência desta
   skill são exemplos de formatação e teses recorrentes, não fontes verificadas — nunca
   os reaproveite num caso real sem reconfirmar por busca no momento do uso.**
3. **IRAC em prosa fluida, sem rótulos visíveis.** Cada tópico do Direito desenvolve,
   em texto corrido: a questão, a regra (lei + jurisprudência), a aplicação aos fatos e
   a conclusão — **sem** escrever "Issue/Rule/Application/Conclusion" no corpo.
4. **A decisão estratégica é do advogado.** Silêncios deliberados (p.ex., não
   reintroduzir o valor da causa numa réplica) são estratégia — não os "corrija" sem
   instrução. Quando enxergar risco, prazo, prescrição ou alternativa, **sinalize**;
   não imponha.
5. **Tom:** objetivo, técnico e persuasivo; robustez concentrada no ponto mais forte da
   tese; sem floreios. Concisão com densidade.
6. **Rascunho primeiro, validação da tese no fim — nunca antes.** Para qualquer peça que
   dependa de uma tese (sobretudo petição inicial), **não pare para perguntar qual tese
   usar**. Leia os fatos, escolha a tese que a análise indicar como a mais vencedora
   para *aquele* caso concreto, redija o rascunho completo com ela e, ao final, entregue
   o **Relatório de teses** (§6): quais teses usou, por quê, e as alternativas
   descartadas. A correção é do advogado — ele aponta outra tese e a skill reajusta a
   peça. O objetivo é sempre destravar o trabalho com um rascunho, não segurar a entrega
   à espera de validação prévia.

## 2. Fluxo de trabalho

1. **Leia os documentos do caso** (contratos, comprovantes, CRLV, prints etc.) e extraia
   os dados reais. Nunca pule esta etapa quando houver anexos. As fontes dos fatos podem
   ser: mensagens de WhatsApp, o relato enviado aqui na conversa, ou a **ficha de
   cadastro do cliente**. Consolide tudo numa linha do tempo antes de seguir.
2. **Defina a tese (para peças que dependem de tese, sobretudo inicial).** A partir dos
   fatos: (a) identifique os enquadramentos jurídicos possíveis — combine com a skill
   `civel-consumidor-cmp` quando for consumo/civil; (b) **pesquise casos recentes e como
   os juízes vêm decidindo aquele tipo de caso** (jurisprudência do tribunal competente,
   tendência atual), respeitando a §1.2 — sem web ou sem confirmação, siga com a tese
   que a análise indicar e marque `[JURISPRUDÊNCIA A CONFIRMAR]`; (c) escolha a **tese
   mais vencedora para *este* caso concreto** e as teses subsidiárias. **Não pare para
   validar** — essa escolha vira o rascunho e é justificada no Relatório de teses (§6),
   onde o advogado corrige depois.
3. **Não trave o fluxo para confirmar números.** Use os valores extraídos dos
   documentos. Onde faltar dado, use `[A PREENCHER]`. Onde um número for calculado ou
   inferido (valor da causa, débito atualizado), destaque-o e marque `[CONFIRMAR]` para
   o advogado validar na revisão — mas **siga redigindo a peça inteira**. Só pare e
   pergunte se um dado faltante impedir a estrutura (p.ex., não dá para saber quantos
   réus há).
4. **Verifique a jurisprudência** por busca antes de inserir (regra completa na §1.2:
   sem confirmação ou sem web, use `[JURISPRUDÊNCIA A CONFIRMAR]`); ao confirmar,
   transcreva ementas com **grifo** exatamente no trecho que espelha o caso (ver
   `references/estilo_e_jurisprudencia.md`).
5. **Monte a peça** seguindo a estrutura de `references/estrutura_peticao.md`.
6. **Gere o .docx** no padrão visual de `references/padrao_formatacao.md`, pelo pipeline
   de `references/pipeline_docx.md` (+ `scripts/build_peticao.py`), usando o timbre
   `assets/template_cmp.docx`.
7. **Renderize um PDF e faça QA visual** antes de entregar (timbre, grifos, imagens,
   assinatura intacta).
8. **Entregue o Relatório de teses** (§6) junto com a peça: teses usadas, justificativa,
   alternativas descartadas e pendências `[A CONFIRMAR]`. É por aqui que o advogado
   corrige — ao apontar outra tese, reajuste a peça e regenere o .docx.

## 3. Estrutura padrão da peça

A arquitetura de seções — endereçamento e qualificação › **Síntese da Demanda** no topo
› gratuidade › competência › **fatos em ordem cronológica** › **Do Direito** (subtópicos
em IRAC-prosa) › **tutela de urgência** › **pedidos** › **valor da causa** › fecho — e o
que entra em cada seção estão em `references/estrutura_peticao.md`. **Carregue essa
referência ao montar qualquer peça.** A ordem adapta-se ao tipo (contestação, apelação,
embargos etc.).

## 4. Forma e formatação

Duas saídas possíveis, **mesmo conteúdo**:

- **Tradicional** — texto corrido no padrão do escritório.
- **Legal design** — tipografia jurídica: hierarquia visual, banners de seção,
  caixa de síntese, *callouts*, ementas em caixa com borda e **grifo em destaque**,
  imagens-prova destacadas. Aplica ergonomia visual e ciência cognitiva ao texto legal,
  para retenção e persuasão — sem perder o rigor.

Especificações completas (fonte Barlow, justificado, entrelinha, recuos, cores do
legal design, tokens) estão em `references/padrao_formatacao.md`.

## 5. Referências (carregue conforme a necessidade)

- `references/modelo_base.md` — **gabarito universal de parâmetros** (formatação, tom,
  legal design e método) que vale para TODA peça, qualquer que seja o tipo (inicial,
  contestação, apelação, réplica, embargos etc.); a arquitetura de seções adapta-se ao
  tipo. Exemplar visual em `assets/modelo_base_exemplar.docx`. **Carregue sempre.**
- `references/estrutura_peticao.md` — modelo seção a seção, com o que entra em cada uma.
- `references/estilo_e_jurisprudencia.md` — regras de estilo (IRAC-prosa, exemplos),
  como tratar e grifar jurisprudência, e o que **nunca** fazer.
- `references/padrao_formatacao.md` — padrão visual das duas versões e tokens.
- `references/pipeline_docx.md` — como gerar o .docx preservando timbre/rodapé e como
  embutir imagens-prova; usar com `scripts/build_peticao.py`.
- `assets/template_cmp.docx` — modelo do escritório (timbre, marca d'água, rodapé).

## 6. Relatório de teses (fecho de toda peça com tese)

Ao final da entrega de qualquer peça que dependa de tese — sobretudo petição inicial —,
acrescente, **fora do corpo da peça** (na mensagem de entrega, não no .docx), um bloco
curto assim. É o registro do raciocínio e o ponto por onde o advogado corrige.

    RELATÓRIO DE TESES
    • Tese principal adotada: [qual] — porque [ligação com os fatos e com a
      tendência de decisão pesquisada]. Fundamento: [dispositivos legais].
    • Teses subsidiárias/cumulativas: [quais] e por quê.
    • Alternativas descartadas: [tese] — descartada porque [motivo neste caso].
    • Jurisprudência: [confirmada por busca] / [marcada [A CONFIRMAR] — falta validar].
    • Pendências: campos [A PREENCHER] e números [CONFIRMAR] que restaram.

Regras deste bloco:

1. **Nunca substitui a validação prévia por pergunta** — o rascunho já vem pronto com a
   tese escolhida; este relatório apenas a justifica *depois*.
2. Se o advogado responder apontando outra tese, **reajuste a peça** a partir dela e
   **regenere o .docx** — não recomece do zero nem descarte o texto aproveitável.
3. A escolha da "tese mais vencedora" deve estar ancorada na análise dos fatos e, quando
   houver web, na **pesquisa de como os juízes vêm decidindo casos semelhantes** no
   tribunal competente. Sem web, decida pela força jurídica da tese e sinalize a pendência.
4. Mantenha o bloco curto e honesto: se a base de uma tese é fraca ou não pôde ser
   confirmada, **diga**.

> Os dados pessoais e específicos de cada caso **não** ficam nesta skill: eles entram
> dos documentos do processo. A skill guarda **método e forma**, não conteúdo de casos.
````

## A.2 — `references/estrutura_peticao.md`

````markdown
# Estrutura da peça — modelo seção a seção

Modelo de **petição inicial** consumerista (adaptável a réplica, contestação e
manifestação). Cada seção indica o que entra e o objetivo.

## 1. Endereçamento
"AO JUÍZO DE DIREITO DA/DO [vara/núcleo/comarca]..." (padrão do escritório — NÃO usar
"EXCELENTÍSSIMO SENHOR DOUTOR JUIZ", salvo ordem em contrário). Inserir um parágrafo em
branco médio (~3 linhas) logo após o endereçamento, antes do nº do processo/qualificação.
Confirme a competência antes de fixar o foro.

## 2. Qualificação das partes
- Autor: nome, nacionalidade, estado civil, RG, CPF, endereço, e-mail (todos de
  documentos). Advogado subscritor e endereço do escritório.
- Réu(s): razão social, CNPJ, sede; se houver filial vendedora/financeira, identifique.
- Dados **só** de documentos. Faltou? `[A PREENCHER]`.

## 3. Síntese da Demanda (resumo executivo — vai no topo)
Um a dois parágrafos + um *callout* "Pede-se, em resumo:". Diga o que se pede, contra
quem, por quê, e a fundamentação central (artigos e teses-chave). Objetivo: o juiz lê
só isso e já entende a causa inteira e seus porquês.

## 4. Gratuidade da justiça
Art. 98 do CPC; presunção do art. 99, §3º; declaração anexa.

## 5. Competência
Em consumo, foro do domicílio do consumidor (art. 101, I, do CDC), norma de ordem
pública. Fundamente a escolha do foro.

## 6. Dos Fatos (ORDEM CRONOLÓGICA)
Narre em ordem de data, do primeiro ao último acontecimento. Amarre cada fato ao
documento que o prova (anexo X). Destaque, em negrito, os fatos-âncora (a omissão, o
defeito, a cláusula que obriga o réu). Termine com o "cerne da causa" em uma frase.
Quando útil, **insira a imagem-prova destacada** (ver `pipeline_docx.md`).

## 7. Do Direito (subtópicos em IRAC-prosa)
Para cada subtópico: abra com a questão; exponha a regra (lei + jurisprudência
verificada e grifada); aplique aos fatos do caso; conclua. Sem rótulos visíveis.
Ordem típica numa ação de consumo de veículo (adaptar ao caso):
- Relação de consumo e responsabilidade objetiva (arts. 2º, 3º, 12, 14, 6º VIII).
- Núcleo da tese (o ponto mais forte — robustez máxima aqui).
- Impedimentos legais correlatos (p.ex., CTB para transferência).
- **Prova documental e desnecessidade de perícia**, quando a controvérsia for
  documental.
- Falha do serviço e omissão informacional (arts. 14, 6º III, 30, 31).
- Nulidade de cláusulas abusivas / "no estado" (art. 51).
- Venda casada (art. 39, I; dobro pós-30/03/2021, EAREsp 676.608/RS).
- Tempestividade / afastamento da decadência (art. 26, §3º).
- Coligação contratual de crédito (art. 54-F do CDC; litisconsórcio da financeira,
  art. 114 do CPC; baixa do gravame).
- **Danos materiais item a item**, explicando o *porquê* de cada verba (a parcela
  devolvida para retornar ao status quo ante; o reparo porque estava na garantia; etc.).
- **Danos morais** detalhados: por que feriu direitos da personalidade; o risco
  concreto (p.ex., trafegar com a família em veículo inseguro); dano in re ipsa;
  ancore o quantum em precedente análogo.

## 8. Tutela de urgência (art. 300 do CPC)
O tópico mais decisivo. Demonstre, ligando aos fatos:
- Probabilidade do direito (fumus): prova documental do núcleo da tese.
- Perigo de dano (periculum): o prejuízo concreto e atual; e o dano grave se nada for
  feito (p.ex., busca e apreensão, custos, negativação).
- Pedido específico (suspensão/depósito; vedações), inaudita altera parte, sob multa.

## 9. Pedidos
Liste com alíneas. Se houver mais de um réu, **separe os pedidos por réu**. Inclua:
gratuidade; tutela; citação; inversão do ônus; mérito (por réu); custas e honorários;
provas. Cada pedido pecuniário deve casar com um valor do tópico de danos.

## 10. Valor da causa
Some os proveitos econômicos pedidos (restituições + indenizações + dobro etc.).
Ressalve parcelas vincendas (art. 323 do CPC). Confirme o número com o usuário.

## 11. Fecho
"Nestes termos, pede deferimento." Local, data, e subscrição do advogado (OAB).
````

## A.3 — `references/estilo_e_jurisprudencia.md`

````markdown
# Estilo de escrita e tratamento de jurisprudência

## A. IRAC em prosa (sem rótulos)

O método é IRAC, mas o texto é **corrido**. Não escreva "Issue", "Rule" etc. O parágrafo
deve, naturalmente:
1. **Abrir com a questão** ("Discute-se aqui se...", "A questão é definir se...").
2. **Trazer a regra** — dispositivo legal + jurisprudência verificada.
3. **Aplicar ao caso** — ligar a regra aos fatos concretos e às provas dos autos.
4. **Concluir** — a consequência jurídica pretendida.

Exemplo (resumido):
> "Discute-se se a venda de veículo com recall de segurança pendente, sem informação,
> autoriza a rescisão. A resposta é afirmativa. O CDC proíbe colocar no mercado produto
> que acarrete risco à segurança (arts. 8º e 10) e responsabiliza objetivamente pelo
> defeito (art. 12)... No caso, o defeito está provado por documento oficial: o CRLV/2024
> já registrava 'RECALL NÃO ATENDIDO'... Logo, configurado o defeito de segurança,
> impõe-se a resolução do contrato com restituição das quantias pagas (art. 18, §1º, II)."

## B. Tom e densidade
- Objetivo e técnico; persuasivo sem retórica vazia.
- Concentre **robustez no ponto mais forte** da tese (mais argumento, melhor
  jurisprudência, eventual imagem-prova destacada). Os demais tópicos podem ser enxutos.
- Frases-âncora em negrito, com parcimônia, para guiar a leitura.
- Concisão: cada parágrafo carrega um argumento completo.

## C. Jurisprudência — regras rígidas
1. **Verifique antes de citar.** Toda ementa/numeração é "não verificada" até confirmação
   por busca em fonte oficial (tribunal/Jusbrasil/repositório). Se não confirmar, **não
   use** e avise o usuário.
2. **Nunca invente** número de processo, relator, data ou trecho de ementa.
3. **Transcreva com grifo** o trecho da ementa que espelha o caso concreto — é o que dá
   força ("casos praticamente idênticos"). Mantenha a transcrição focada no relevante.
4. **Distribua** os precedentes pelos tópicos certos (um por ponto), sem amontoar.
5. Prefira **precedentes do tribunal competente** (regional), apoiados por STJ/Súmulas.
6. Sinalize honestamente as **linhas contrárias** relevantes e como a tese as enfrenta.

## D. Citações de lei e de ementa (formatação)
- Bloco de citação recuado e em itálico (ver `padrao_formatacao.md`).
- Uma citação por fonte; o restante, parafraseado.
- Identifique o precedente: (Tribunal, classe nº, órgão, relator, data de publicação).

## E. O que NUNCA fazer
- Inventar dados de qualquer natureza (use `[A PREENCHER]`).
- Reproduzir jurisprudência de memória sem verificar.
- Inserir rótulos IRAC no corpo.
- "Corrigir" silêncios estratégicos do advogado sem instrução.
- Decidir estratégia: a skill **redige e sinaliza**; a decisão é do advogado.

## F. Bibliotecas de teses recorrentes (consumo)

> ⚠️ **Estas entradas são pistas de tese, NÃO fontes verificadas.** Os números de
> acórdão, temas e súmulas abaixo servem só para lembrar QUAIS teses existem e por onde
> buscar. **Nunca copie um destes números direto para uma peça.** Antes de citar
> qualquer um, reconfirme por busca em fonte oficial no momento do uso (jurisprudência
> muda, números podem estar desatualizados). Sem confirmação, use `[JURISPRUDÊNCIA A
> CONFIRMAR]` e avise o usuário.

- Garantia legal incide sobre produto usado (STJ, REsp 1.661.913/MG).
- Dobro independe de má-fé para cobranças após 30/03/2021 (STJ, EAREsp 676.608/RS).
- Venda casada de seguro prestamista: art. 39, I; Tema 972/STJ.
- Coligação de crédito ao consumo: art. 54-F do CDC (Lei 14.181/2021), §§ 2º e 4º.
- Decadência de vício oculto conta da ciência (art. 26, §3º, do CDC).
- Dano moral in re ipsa quando há risco à segurança/incolumidade.
> Todas devem ser **reconfirmadas por busca** no momento do uso (jurisprudência muda).
````

## A.4 — `references/padrao_formatacao.md`

````markdown
# Padrão de formatação (.docx)

## Padrão do escritório (versão tradicional)
- Fonte **Barlow** em todo o corpo.
- Texto **justificado**.
- Entrelinha **360** (line, lineRule auto).
- Recuo de **primeira linha 709 twips**.
- Blocos de **citação**: recuo esquerdo **2268 twips**, **itálico**, tamanho **22**
  (`w:sz val="22"`); corpo geral em tamanho **24** (12pt).
- Página A4; timbre com logo + marca d'água + rodapé de contato (do `template_cmp.docx`).
- **Todas as peças levam timbre**, inclusive a réplica (correção da regra antiga "réplicas
  sem timbre").

## Versão legal design (tipografia jurídica)
Mesmo conteúdo, com hierarquia visual e ergonomia cognitiva:
- **Banners de seção**: parágrafo com fundo navy e texto branco em negrito
  (`<w:shd w:fill="2E3A4B"/>` + `<w:color w:val="FFFFFF"/>`).
- **Subtítulos**: cor navy + borda inferior fina (`pBdr/bottom`).
- **Caixa de síntese / callout**: fundo claro + **borda esquerda** de acento
  (`pBdr/left`, navy ou dourado).
- **Ementas em caixa**: fundo `EEF1F5` + borda esquerda navy; o trecho on-point recebe
  **grifo em destaque** (run com `<w:shd w:fill="FFF1A8"/>` + negrito).
- **Citações de lei** em caixa clara com borda esquerda.
- **Imagem-prova** centralizada, com legenda em itálico menor.
- Mais respiro (espaçamentos um pouco maiores).

## Tokens de cor (legal design)
- NAVY (banners/bordas/acento): `2E3A4B`
- Fundo claro de caixa: `EEF1F5` / `F6F8FB`
- Grifo (destaque on-point): `FFF1A8`
- Borda dourada de callout: `C9A227`
- Filete de subtítulo: `C7D0DA`

## Diferença de grifo entre versões
- Tradicional: grifo = **negrito + sublinhado**.
- Legal design: grifo = **negrito + realce amarelo** (`shd FFF1A8`).
````

## A.5 — `references/modelo_base.md`

````markdown
# Modelo-base canônico de petição — padrão CMP

Referência destilada da peça-modelo do escritório (exemplo: *Jodiael x Movida/BBC*,
ação de rescisão contratual c/c restituição, danos morais e tutela de urgência).
Vale como **gabarito de estrutura, tom e convenções**. Os dados são do caso concreto
(vêm dos documentos); aqui interessa a **forma e o método**, não o conteúdo.

> Asset exemplar: `assets/modelo_base_exemplar.docx` (versão legal design enxuta).

---

## 0. Aplicação universal (vale para toda peça)

Este modelo é o **gabarito de parâmetros de TODA peça CMP**, qualquer que seja o tipo:
inicial, contestação, apelação, réplica, embargos de declaração, cumprimento de
sentença, execução, manifestação, contrarrazões etc.

**Sempre transferem, sem exceção:**
- **Formatação** (item 5): Barlow, justificado, entrelinha 360, primeira linha 709,
  timbre/marca d'água/rodapé, ~3 linhas em branco após o endereçamento.
- **Legal design** (item 5): banners navy, caixas claras com borda de acento, grifo
  amarelo on-point.
- **Método** (itens 2–4): IRAC em prosa sem rótulos, robustez concentrada, fatos
  cronológicos com datas em negrito e cerne em uma frase, danos/verbas item a item,
  jurisprudência sempre verificada e grifada.
- **Dupla subscrição** Djan + Jader.

**Adapta-se ao tipo** a *arquitetura de seções*. A ordem fixa do item 1 é a da **inicial**.
Para os demais, mantêm-se os parâmetros acima, mas o esqueleto muda:
- **Contestação:** endereçamento › tempestividade › preliminares (uma por vez) › mérito
  por impugnação especificada (art. 341 do CPC) › pedidos › provas. Cabe a "Síntese da
  Defesa" em caixa, no lugar da Síntese da Demanda.
- **Réplica:** rebate a contestação ponto a ponto; **com timbre** (como todas as peças);
  não reintroduzir silêncios estratégicos (p.ex., valor da causa).
- **Apelação / recurso:** tempestividade e preparo › síntese do inconformismo em caixa ›
  razões recursais (IRAC-prosa) › prequestionamento › pedido de reforma.
- **Embargos de declaração:** apontar objetivamente omissão/contradição/obscuridade/erro
  material (art. 1.022 do CPC); estrutura curta, um vício por tópico; efeitos
  infringentes só se cabíveis.
- **Contrarrazões:** admissibilidade › refutação das razões do recorrente › manutenção do
  julgado.
- **Cumprimento de sentença / execução:** título e exigibilidade › planilha de débito
  atualizado › requerimentos de constrição (SISBAJUD/RENAJUD/INFOJUD/CNIB/SREI) ›
  pedidos. (Área com gabarito próprio quando o modelo de execução for enviado.)

---

## 1. Convenções de estrutura (ordem fixa)

1. **Endereçamento** (ver ressalva no item 6 abaixo).
2. **Qualificação do autor** → nome em negrito, nacionalidade, estado civil, RG, CPF,
   endereço, e-mail, "por intermédio de seu advogado (procuração anexa), com escritório
   à [endereço CMP], onde recebe intimações, vem propor a presente".
3. **Nome da ação** centralizado, em negrito e caixa alta.
4. **"em face de"** → cada réu qualificado em negrito; identificar **filial**
   vendedora/financeira quando houver (razão social + CNPJ próprio).
5. **SÍNTESE DA DEMANDA** — banner de seção **sem numeração romana**, no topo. Um período
   de abertura ("Para imediata compreensão de Vossa Excelência…") seguido de uma **lista
   numerada em caixa** (1, 2, 3…), cada item com **lead-in em negrito** resumindo um pilar
   da causa (fato → tese → dispositivo). Fecho: "Cada um desses pontos será detidamente
   discorrido e comprovado pelos fatos e fundamentos a seguir."
6. **I – DA GRATUIDADE DA JUSTIÇA** (a numeração romana começa aqui).
7. **II – DA COMPETÊNCIA**.
8. **III – DOS FATOS** — ver item 3.
9. **IV – DO DIREITO** — subtópicos `IV.1`, `IV.2`… em IRAC-prosa (item 4).
10. **V – DA TUTELA DE URGÊNCIA** (quando houver).
11. **VI – DOS PEDIDOS** — em caixa, alíneas a), b)… **separadas por réu** (item 5).
12. **Valor da causa** — parágrafo final, sem banner próprio.
13. **Fecho**: "Nestes termos, / Pede deferimento." + local, data.
14. **Dupla subscrição**: Djan Henrique Mendonça do Nascimento (OAB/PB 5.219-A) e
    Jader Gabriel Pinheiro (OAB/PB 33.567), cada um com linha de assinatura.

---

## 2. Tom e método de redação

- **IRAC em prosa fluida, sem rótulos.** Cada subtópico do Direito abre com a questão,
  expõe a regra (dispositivos + jurisprudência verificada e grifada), aplica aos fatos e
  conclui — tudo em texto corrido, denso e sem "Issue/Rule/…".
- **Concisão com robustez concentrada** no ponto mais forte da tese (no exemplo: recall
  não atendido → bem impróprio + documento bloqueado). Os demais subtópicos são mais
  curtos e servem de reforço.
- **Fatos em ordem cronológica**, com **datas em negrito** e fatos-âncora destacados;
  cada fato amarrado ao documento que o prova. Fecho dos fatos com o **cerne da causa em
  uma frase** ("Eis o cerne: …").
- **Danos item a item**, explicando o *porquê* de cada verba (a entrada para retornar ao
  status quo; o conserto porque estava na garantia; a multa etc.).
- **Silêncios são deliberados** — não reintroduzir elementos omitidos de propósito.

---

## 3. Tratamento da jurisprudência (crítico)

- **Nunca de memória.** Toda ementa/acórdão é **não verificada** até confirmação em fonte
  oficial (tribunal). As citações do exemplo servem de **forma**, não para reuso cego.
- Transcrição em **caixa/citação** (`EEF1F5`, borda esquerda navy), com o **trecho
  on-point em grifo amarelo** (`FFF1A8` + negrito) — exatamente a passagem que espelha o
  caso. Referência ao final entre parênteses: tribunal, tipo e número do processo, órgão,
  relator, data de publicação.
- Ancorar o *quantum* de danos morais em precedente análogo verificado.

---

## 4. Pedidos — convenções

- Introdução "Ante o exposto, requer:", depois **caixa com alíneas**.
- Blocos processuais primeiro (gratuidade, tutela, citação, inversão do ônus/julgamento
  antecipado); depois **mérito separado por réu** ("em face da primeira ré (X):" …
  "Quanto à segunda ré (Y), litisconsorte necessário, sem pedido condenatório:").
- Cada pedido pecuniário **casa com uma verba** do tópico de danos.
- Pedidos subsidiários explícitos ("subsidiariamente, caso não reconhecida a coligação…").
- Custas e honorários; provas ao final.
- **Valor da causa** = soma dos proveitos econômicos, com **valor por extenso** e ressalva
  das parcelas vincendas (art. 323 do CPC). Confirmar o número com o usuário.

---

## 5. Formatação (legal design enxuto — o do exemplo)

Herda tudo de `padrao_formatacao.md`. Elementos efetivamente usados neste modelo:

- Fonte **Barlow**, justificado, entrelinha **360**, primeira linha **709 twips**.
- **Banners de seção**: fundo navy `2E3A4B` + texto branco em negrito.
- **Caixas** (síntese, jurisprudência, pedidos): fundo claro `EEF1F5` + borda esquerda
  navy (`pBdr/left`).
- **Grifo on-point** na jurisprudência: realce amarelo `FFF1A8` + negrito.
- **Imagem-prova** inline, centralizada, com legenda em itálico menor.
- Timbre, marca d'água e rodapé do `template_cmp.docx`.

---

## 6. ⚠️ Ressalva de endereçamento (resolver com o advogado)

O `.docx` exemplar abre com **"EXCELENTÍSSIMO(A) SENHOR(A) DOUTOR(A) JUIZ(A) DE
DIREITO DE…"**. Isso **conflita** com a instrução permanente do escritório, que manda usar
**"AO JUÍZO DE DIREITO DA/DO [vara/núcleo/comarca]…"** seguido de um parágrafo em branco
médio antes do número do processo/qualificação.

**Default adotado:** seguir a instrução permanente (endereçamento por Juízo), por ser a
regra mais recente e explícita — salvo ordem em contrário. Se a intenção for oficializar a
fórmula "EXCELENTÍSSIMO" como padrão, avisar para atualizar a instrução permanente e esta
referência de uma vez.
````

## A.6 — `references/pipeline_docx.md`

````markdown
# Pipeline de geração do .docx (preservando timbre)

Objetivo: gerar a peça em Word mantendo timbre, marca d'água e rodapé do escritório,
e permitindo embutir imagens-prova destacadas.

## Visão geral
1. **Unpack** do `assets/template_cmp.docx` (descompacta o .docx em XML/partes).
2. **Reconstruir só o corpo** (`<w:body>`): preserve o *prefixo* (cabeçalho do
   `<w:document>` com os namespaces e o `<w:body>`) e o `<w:sectPr>` (que carrega as
   referências de header/footer e o tamanho de página). Injete apenas os parágrafos
   novos entre o prefixo e o `<w:sectPr>`.
3. **Limpar imagens herdadas** do template que não interessam (remova relationships e
   arquivos de mídia órfãos), mantendo as do timbre (logo/marca/rodapé, referenciadas
   pelos headers/footers).
4. **Repack** preservando as partes originais (no ambiente Claude, use o
   `pack.py` do skill de docx).
5. **Renderizar PDF** (LibreOffice headless) e **rasterizar** para QA visual.

## Helper de construção
`scripts/build_peticao.py` traz funções utilitárias (run/para/H/SUB/P/CITE/QUOTE/
CALLOUT/LI) que ramificam por modo (tradicional × legal design) e montam o
`document.xml`. Ajuste os blocos de conteúdo ao caso. É um ponto de partida — adapte
caminhos do template e do empacotador ao ambiente em que rodar.

## Embutir imagem-prova (inline)
- Copie a imagem para `word/media/imageN.png`.
- Adicione um relationship em `word/_rels/document.xml.rels`
  (`Type=.../image`, `Target="media/imageN.png"`).
- Insira um `<w:drawing>` *inline* no parágrafo, referenciando `r:embed="rIdN"`.
- **Atenção aos namespaces**: o template pode não declarar `xmlns:a` (drawingml main)
  e `xmlns:pic` (picture) na raiz. Declare-os **inline** nos elementos `<a:graphic>` e
  `<pic:pic>` do drawing.
- Para destacar a prova (ex.: anotação relevante), pré-processe a imagem (recorte +
  retângulo/realce com PIL) antes de embutir, e acrescente uma legenda em itálico menor.

## QA antes de entregar
- Timbre/logo/rodapé presentes; marca d'água ok.
- Grifos e caixas (legal design) renderizando.
- Imagem-prova nítida e destacada.
- Bloco de assinatura íntegro (não quebrado entre páginas — use `keepNext/keepLines`).
- Conferir valor da causa, datas e dados (todos de documentos).
````

## A.7 — `scripts/build_peticao.py` (helper de montagem do .docx)

```python
# -*- coding: utf-8 -*-
"""
build_peticao.py — utilitários de montagem de peças .docx no padrão CMP.

Dois modos: tradicional (padrão) e "design" (legal design).
Uso típico:
  1) Descompacte o template (assets/template_cmp.docx) numa pasta `unpacked/`.
  2) Monte a lista `body` com os helpers (H/SUB/P/CITE/QUOTE/CALLOUT/LI).
  3) Injete no document.xml preservando prefixo + sectPr (ver assemble()).
  4) Empacote de volta e renderize um PDF para QA.

Este arquivo é um PONTO DE PARTIDA: adapte os caminhos do template/empacotador ao
ambiente em que rodar (Claude.ai com execução de código, Claude Code, etc.).
"""
import re

# ---- estilo ----
DESIGN = False  # vire para True para gerar a versão legal design
NAVY, LIGHT, HLY, RULE = "2E3A4B", "EEF1F5", "FFF1A8", "C7D0DA"
FONT = '<w:rFonts w:ascii="Barlow" w:eastAsia="Barlow" w:hAnsi="Barlow" w:cs="Barlow"/>'

def esc(t):
    return t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")

def run(text, b=False, i=False, u=False, size=24, color=None, hl=False):
    rpr = FONT + f'<w:sz w:val="{size}"/><w:szCs w:val="{size}"/>'
    if b: rpr += "<w:b/>"
    if i: rpr += "<w:i/>"
    if u: rpr += '<w:u w:val="single"/>'
    if color: rpr += f'<w:color w:val="{color}"/>'
    if hl: rpr += f'<w:shd w:val="clear" w:color="auto" w:fill="{HLY}"/>'
    return f'<w:r><w:rPr>{rpr}</w:rPr><w:t xml:space="preserve">{esc(text)}</w:t></w:r>'

def grif(text):
    """Grifo: negrito+sublinhado (tradicional) | negrito+realce (design)."""
    return run(text, b=True, u=not DESIGN, hl=DESIGN)

def _pPr(first=709, jc="both", before=0, after=240, line=360, left=None, right=None,
         shd=None, border=None, keep=False):
    p = "<w:pPr>"
    if border:  # ('full'|'left'|'bottom', cor, sz)
        kind, col, sz = border
        b = ""
        if kind in ("full", "left"):
            b += f'<w:left w:val="single" w:sz="{sz}" w:space="10" w:color="{col}"/>'
        if kind == "full":
            b += (f'<w:top w:val="single" w:sz="6" w:space="6" w:color="{col}"/>'
                  f'<w:bottom w:val="single" w:sz="6" w:space="6" w:color="{col}"/>'
                  f'<w:right w:val="single" w:sz="6" w:space="6" w:color="{col}"/>')
        if kind == "bottom":
            b = f'<w:bottom w:val="single" w:sz="{sz}" w:space="4" w:color="{col}"/>'
        p += f"<w:pBdr>{b}</w:pBdr>"
    if shd:
        p += f'<w:shd w:val="clear" w:color="auto" w:fill="{shd}"/>'
    p += f'<w:spacing w:before="{before}" w:after="{after}" w:line="{line}" w:lineRule="auto"/>'
    ind = ""
    if left is not None: ind += f'w:left="{left}" '
    if right is not None: ind += f'w:right="{right}" '
    if first: ind += f'w:firstLine="{first}" '
    if ind: p += f'<w:ind {ind.strip()}/>'
    p += f'<w:jc w:val="{jc}"/>'
    if keep: p += "<w:keepNext/><w:keepLines/>"
    return p + "</w:pPr>"

def para(runs, **kw):
    if isinstance(runs, str): runs = [run(runs)]
    return f"<w:p>{_pPr(**kw)}{''.join(runs)}</w:p>"

# ---- blocos semânticos ----
def P(x, **kw):
    return para([run(x)] if isinstance(x, str) else x, **kw)

def TITLE(t):
    return para([run(t, b=True)], first=0, jc="center", before=180, after=180)

def H(t):
    if DESIGN:
        return para([run(t, b=True, color="FFFFFF")], first=0, jc="left",
                    before=260, after=140, line=276, shd=NAVY, keep=True)
    return para([run(t, b=True)], first=0, before=240, after=120, keep=True)

def SUB(t):
    if DESIGN:
        return para([run(t, b=True, size=23, color=NAVY)], first=0, before=180,
                    after=90, border=("bottom", RULE, 6), keep=True)
    return para([run(t, b=True)], first=0, before=160, after=90, keep=True)

def CITE(t):
    if DESIGN:
        return para([run(t, i=True, size=22)], first=0, left=482, after=140, line=260,
                    shd="F6F8FB", border=("left", NAVY, 18))
    return para([run(t, i=True, size=22)], first=0, left=2268, after=120, line=240)

def QUOTE(runs):
    """Bloco de ementa; use grif() nos trechos on-point."""
    if DESIGN:
        return para(runs, first=0, left=300, right=200, after=140, line=252,
                    shd=LIGHT, border=("left", NAVY, 24))
    return para(runs, first=0, left=2268, after=140, line=240)

def CALLOUT(x):
    runs = [run(x, b=True)] if isinstance(x, str) else x
    if DESIGN:
        return para(runs, first=0, after=160, line=288, shd="FBF7E6",
                    border=("left", "C9A227", 24))
    return para(runs, first=0, after=160)

def LI(label, x):
    runs = [run(label + " ", b=True)] + ([run(x)] if isinstance(x, str) else x)
    return para(runs, first=0, left=709, after=120)

# ---- imagem-prova inline (rId livre -> media/imageN.png) ----
def drawing(rid="rId8", cx=4937760, cy=2401440, did=77, name="PROVA"):
    A_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'
    P_NS = 'http://schemas.openxmlformats.org/drawingml/2006/picture'
    return (
      '<w:p><w:pPr><w:spacing w:before="80" w:after="60" w:line="240" w:lineRule="auto"/>'
      '<w:jc w:val="center"/></w:pPr><w:r><w:rPr>' + FONT + '</w:rPr><w:drawing>'
      '<wp:inline distT="0" distB="0" distL="0" distR="0">'
      f'<wp:extent cx="{cx}" cy="{cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>'
      f'<wp:docPr id="{did}" name="{name}"/>'
      f'<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="{A_NS}" noChangeAspect="1"/></wp:cNvGraphicFramePr>'
      f'<a:graphic xmlns:a="{A_NS}"><a:graphicData uri="{P_NS}">'
      f'<pic:pic xmlns:pic="{P_NS}"><pic:nvPicPr><pic:cNvPr id="{did}" name="{name}"/><pic:cNvPicPr/></pic:nvPicPr>'
      f'<pic:blipFill><a:blip r:embed="{rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
      f'<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>'
      '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'
    )

def assemble(template_document_xml, body_blocks):
    """Recebe o document.xml do template e a lista de blocos; devolve o XML final,
    preservando o prefixo (até <w:body>) e o <w:sectPr> do template."""
    xml = template_document_xml
    prefix = xml[: xml.find("<w:body>") + len("<w:body>")]
    sectpr = re.search(r"<w:sectPr.*?</w:sectPr>", xml, re.S).group(0)
    return prefix + "".join(body_blocks) + sectpr + "</w:body></w:document>"

# ---- exemplo mínimo ----
if __name__ == "__main__":
    body = [
        H("SÍNTESE DA DEMANDA"),
        P("Resumo executivo do que se pede, contra quem e por quê..."),
        CALLOUT("Pede-se, em resumo: (i) ...; (ii) ...; (iii) ..."),
        H("I – DOS FATOS"),
        P("Em [data], ... (narrativa cronológica)."),
        H("II – DO DIREITO"),
        SUB("II.1 – Da relação de consumo"),
        P("Discute-se ... A regra é ... No caso ... Logo, ..."),
        QUOTE([run("EMENTA: ... ", size=22), grif("trecho on-point grifado"),
               run(" ... (Tribunal, classe nº, relator, publicado em DD/MM/AAAA).", size=22)]),
    ]
    print("\n".join(body))
```

---

## Anexo B — Assets binários não transcritos

Dois arquivos `.docx` fazem parte da skill e **não cabem neste `.md`** (são binários com
timbre e layout). Ao migrar para o outro sistema, leve-os junto:

- `assets/template_cmp.docx` — modelo do escritório com **timbre, logo, marca d'água e
  rodapé de contato**. É a base sobre a qual o `.docx` da peça é montado.
- `assets/modelo_base_exemplar.docx` — exemplar visual da versão legal design enxuta
  (referência de layout).

> **Nota sobre dados fixos:** a skill traz literalmente os dois procuradores subscritores
> (Djan Henrique Mendonça do Nascimento — OAB/PB 5.219-A; Jader Gabriel Pinheiro — OAB/PB
> 33.567). O **endereço do escritório** aparece como placeholder `[endereço CMP]` nos
> arquivos-fonte — preencha com o endereço oficial ao configurar o novo sistema.
