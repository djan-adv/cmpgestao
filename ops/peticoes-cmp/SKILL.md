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
