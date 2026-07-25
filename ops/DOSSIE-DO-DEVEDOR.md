# Dossiê do devedor — achar bens e créditos em outros processos

Faz na máquina o que você já fazia na mão: varre o Diário de Justiça atrás do
devedor em **outros processos** — como réu e como autor — e destaca o que serve
para penhorar. Botão **🕵 Dossiê do devedor** na tela do processo.

## Por que funciona

Um devedor que é réu em dezenas de processos deixa rastro publicado: auto de
penhora, laudo de avaliação, edital de leilão, alvará em favor dele, precatório.
O DJEN/Comunica do CNJ é público, cobre todos os tribunais e aceita busca por
**nome da parte** — é essa a porta de entrada.

## Como funciona, na ordem

1. **Varredura** — DJEN por `nomeParte`, em fatias de 90 dias, até o período pedido
   (1 a 36 meses). Sem login, sem custo.
2. **Agrupamento** — junta as publicações por processo e descobre o **polo**
   (autor × réu) pelos destinatários. Marca quais processos já são do escritório.
3. **Peneira grátis** — regex de patrimônio (penhora, avaliação, arrematação,
   alvará, SisbaJud, precatório, matrícula, veículo…). Só o que passa custa IA.
4. **Análise** — a IA lê os trechos peneirados (no máximo 28 por dossiê, os mais
   recentes) e devolve cada sinal classificado, com **o que fazer com ele**.

## O que sai

Cada sinal traz: tipo (penhora, avaliação, leilão, arrematação, adjudicação,
bloqueio de valores, crédito a receber, precatório/RPV, bem identificado), o bem,
o valor como escrito, o processo e o tribunal, o polo do devedor, a data, o trecho
que sustenta o achado — e a linha mais útil, **o aproveitamento**: "pedir certidão
de inteiro teor da matrícula e requerer penhora no rosto dos autos".

Confiança em três níveis: **alta** (o trecho nomeia o devedor e descreve o bem),
**media** (sinal claro, vínculo indireto), **baixa** (pode ser homônimo).

O botão **💾 guardar na pasta do processo** salva o dossiê como
`001 - DOSSIE DO DEVEDOR (data).txt`, logo abaixo da íntegra dos autos.

## Custo

Uma chamada de IA por dossiê, com o manual em cache: **uns R$ 0,10 a R$ 0,40** por
consulta. Entra no mesmo teto mensal do `ia_config` e aparece no botão 💳 conta da
API, na linha `dossie_devedor`.

A varredura do DJEN não custa nada — só tempo (30 s a 2 min, conforme o período).

## Limites — leia antes de confiar

- **A busca é por NOME.** O CNJ não aceita CPF/CNPJ (ver `CLAUDE.md`, item 1 dos
  testes descartados). Nome comum traz homônimo; nome incompleto acha pouco. Use a
  razão social exata ou o nome completo, e confira antes de agir.
- **Só enxerga o que foi publicado.** Penhora que não gerou publicação, processo em
  segredo de justiça e acordo extrajudicial não aparecem.
- **Não é certidão nem prova.** É pista para pedir a certidão certa e o ofício ao
  juízo.
- **Não substitui** SisbaJud, RenaJud, CNIB, Registro de Imóveis ou Receita Federal.
- **Não lê os autos de terceiros.** O PDPJ só entrega processo em que o escritório
  está habilitado — nos demais, o dossiê vai até onde a publicação conta.
- A varredura tem teto de tempo (150 s). Se estourar, o dossiê avisa que o período
  pode não ter sido coberto inteiro — reduza os meses e repita.

## Quando não achar nada

Não conclua que o devedor não tem bens. Tente, nesta ordem: conferir a grafia e
usar o nome completo/razão social exata; ampliar o período; buscar pelo nome do
sócio, se for empresa. Uma varredura vazia diz que **nada foi publicado**, não que
nada existe.
