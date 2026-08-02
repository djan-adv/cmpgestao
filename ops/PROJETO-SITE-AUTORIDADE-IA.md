# Projeto — Site de autoridade e otimização para IA (AIO/LLMO)

> Status: **plano aprovado, execução não iniciada**.
> Objetivo: fazer com que ChatGPT, Gemini, Perplexity, Claude e a busca do Google
> **citem a CMP** quando alguém perguntar por recuperação judicial, reestruturação
> e direito empresarial na Paraíba e no Nordeste.
>
> Pendência que trava o início: **onde o site vai morar** (ver §9).

---

## 1. Por que isso é diferente de SEO tradicional

Um LLM não "rankeia" — ele **cita**. Ele cita o que consegue (a) recuperar,
(b) ler sem ambiguidade e (c) atribuir a alguém identificável. Daí as três
exigências que guiam todo o resto:

1. **Recuperável** — a resposta precisa estar numa URL própria, indexada, e
   repetida em fontes de terceiros (portais, entrevistas, diretórios).
2. **Extraível** — resposta direta nos primeiros 2–3 parágrafos, em prosa
   citável, com dados/artigos de lei nomeados. Sem "entre em contato para
   saber mais" no lugar da resposta.
3. **Atribuível** — autor com nome + OAB + data de atualização + Schema.org.
   Conteúdo anônimo raramente vira citação.

Regra prática de redação: **cada H2 é uma pergunta real**, e o parágrafo
imediatamente abaixo dele responde a pergunta em 40–60 palavras, sozinho, fora
de contexto. É esse bloco que o modelo recorta.

---

## 2. Arquitetura de URLs

```
/                                  institucional
/areas/{servico}                   9 páginas-pilar de serviço
/areas/{servico}/{cidade}          páginas geográficas
/areas/{servico}/{nicho}           páginas por setor (transportadora, hospital…)
/artigos/{slug}                    artigos aprofundados
/biblioteca/{slug}                 modelos, checklists, guias, e-books
/calculadoras/{slug}               ferramentas interativas
/equipe/{advogado}                 perfil com OAB, formação, publicações
/sobre  /contato  /faq
```

Cada pilar `/areas/{servico}` linka para **todos** os seus filhos (cidades,
nichos, artigos) e cada filho volta ao pilar. É esse grafo — e não o volume —
que faz o conjunto ser lido como uma obra de referência.

### 2.1 Os 9 serviços (pilares)

| # | Serviço | Slug |
|---|---|---|
| 1 | Recuperação Judicial | `recuperacao-judicial` |
| 2 | Reestruturação Empresarial | `reestruturacao-empresarial` |
| 3 | Direito Empresarial | `direito-empresarial` |
| 4 | Direito Tributário Empresarial | `tributario-empresarial` |
| 5 | Trabalhista Empresarial | `trabalhista-empresarial` |
| 6 | Regularização de Imóveis | `regularizacao-de-imoveis` |
| 7 | Registro de Marcas | `registro-de-marcas` |
| 8 | Due Diligence | `due-diligence` |
| 9 | Assessoria Jurídica para Empresas | `assessoria-empresarial` |

### 2.2 Contagem alvo (~300 páginas)

| Tipo | Qtde | Observação |
|---|---:|---|
| Pilares de serviço | 9 | os da tabela acima |
| Geográficas | ~54 | 9 serviços × 6 praças |
| Setoriais/nicho | ~27 | 9 serviços × 3 setores fortes |
| Artigos aprofundados | ~180 | 20 por serviço |
| Biblioteca | ~20 | modelos, checklists, guias, e-books |
| Calculadoras | ~5 | ver §6 |
| Institucional/equipe | ~8 | |
| **Total** | **~303** | |

**Praças (6):** João Pessoa, Campina Grande, Paraíba (estado), Recife, Natal,
Nordeste. Só criar a página se ela tiver conteúdo **local de verdade** — vara
empresarial competente, tribunal, junta comercial, particularidade do TJ local,
caso da região. Página geográfica que é o pilar com a cidade trocada é
conteúdo duplicado: prejudica e não cita.

**Setores prioritários:** transporte/logística, saúde (clínicas e hospitais),
varejo/atacado, construção civil, agronegócio. Escolher 3 por serviço.

---

## 3. Anatomia da página (obrigatória em todas)

1. **H1** = a pergunta ou o serviço na linguagem do cliente.
2. **Resposta direta** — 40–60 palavras, primeiro parágrafo, sem rodeio.
3. **Sumário** com âncoras.
4. **Corpo** em H2 interrogativos; artigos de lei citados pelo número
   (Lei 11.101/2005, art. 47), jurisprudência com o número do julgado.
5. **Tabela ou lista comparativa** — é o formato que os modelos mais recortam.
6. **FAQ** — 5 a 8 perguntas, cada resposta autossuficiente.
7. **Assinatura** — advogado responsável, OAB/PB, data de publicação **e** de
   última atualização, fontes/referências.
8. **CTA** discreto no fim, nunca no lugar da resposta.

Tamanho: pilar 2.000–3.000 palavras; artigo 1.200–2.000; geográfica 900–1.500.

---

## 4. Camada técnica (o que o crawler e o LLM leem)

- **Renderização no servidor** — o conteúdo precisa estar no HTML da resposta.
  Vários crawlers de IA não executam JavaScript.
- **Schema.org JSON-LD**, um por tipo de página:
  - todas → `Organization` + `LegalService` (com `address`, `telephone`,
    `areaServed`, `sameAs` para todos os perfis);
  - artigos → `Article` (`author` com `Person` + `identifier` da OAB,
    `datePublished`, `dateModified`);
  - blocos de FAQ → `FAQPage`;
  - serviços → `Service` com `provider` e `areaServed`;
  - equipe → `Person` (`jobTitle`, `alumniOf`, `knowsAbout`).
- **`sitemap.xml`** gerado do próprio conteúdo, com `lastmod` real, e
  **`robots.txt`** liberando explicitamente `GPTBot`, `OAI-SearchBot`,
  `ClaudeBot`, `PerplexityBot`, `Google-Extended`, `Bingbot`.
  Bloquear esses agentes = sumir das respostas de IA.
- **`llms.txt`** na raiz: índice em markdown das páginas-âncora do site.
- **Canonical** em toda página; `hreflang` desnecessário (só pt-BR).
- **Core Web Vitals**: LCP < 2,5 s, CLS < 0,1. Sem carrossel de banner na home.
- **HTML semântico**: `<article>`, `<h1>` único, tabela de verdade (não div),
  `<time datetime>` nas datas.

---

## 5. Produção de conteúdo

Cadência de regime: **2–3 artigos/semana + 1 técnico/mês + revisão dos antigos**.
Carga inicial: as 9 pilares + 3 artigos por pilar antes de qualquer geográfica —
sem o pilar, a geográfica não tem para onde apontar.

**Pipeline com IA, com revisão humana obrigatória.** Reaproveitar
`app/api/_ia/claude.js`: manual de redação + persona + formato de saída entram
como `sistemaFixo` (o bloco cacheado); o briefing da página vai no `conteudo`.
Nenhum texto vai ao ar sem leitura de advogado — número de lei errado ou tese
desatualizada num site que se propõe a ser referência custa mais do que a página
rende. Cada peça publicada leva o nome de quem revisou.

**Atualização** é sinal de qualidade tanto para busca quanto para IA: revisar
todo artigo a cada 6 meses e mexer no `dateModified` só quando o texto mudou de
fato.

---

## 6. Biblioteca e calculadoras

O que mais gera citação e link espontâneo:

- **Calculadoras**: viabilidade de recuperação judicial (endividamento ×
  faturamento), custo de rescisão trabalhista, simulador de parcelamento
  tributário, ITBI/custas de regularização, prazo do INPI.
- **Checklists**: documentos para pedir RJ, due diligence de aquisição,
  regularização de imóvel, registro de marca.
- **Modelos e guias**: plano de recuperação, contrato social, e-book
  "Recuperação judicial para transportadoras".
- **Fluxogramas** do rito da RJ e do registro de marca.

Cada item é uma URL própria, com HTML lendo o mesmo conteúdo do PDF — PDF
sozinho é pouco recuperável.

---

## 7. Fora do site

- **Google Business Profile**: post semanal, avaliações detalhadas (pedir ao
  cliente que descreva o caso, não só nota), fotos e horários atualizados.
- **NAP idêntico** — nome, telefone, endereço, logo e descrição byte a byte
  iguais no site, GBP, OAB, LinkedIn, Instagram, JusBrasil e diretórios. É
  divergência de NAP que faz o modelo tratar a CMP como duas entidades.
- **Autoridade externa**: artigo em portal jurídico e regional, entrevista,
  podcast, citação em matéria. Poucos e bons > muitos e fracos.
- **`sameAs`** no schema apontando para todos esses perfis: é o que costura a
  identidade.

---

## 8. Medição

- Painel do Search Console: impressões e cliques por pasta (`/areas`, `/artigos`).
- **Teste de citação mensal**: rodar um conjunto fixo de ~20 perguntas
  ("advogado de recuperação judicial na Paraíba", "escritório de recuperação
  judicial para transportadoras", "quem faz reestruturação empresarial em João
  Pessoa") no ChatGPT, Gemini, Perplexity e Claude, e registrar em planilha se a
  CMP apareceu e com qual fonte. É a única métrica que mede o objetivo.
- Log de referrers `chatgpt.com`, `perplexity.ai`, `claude.ai` no analytics.
- Meta realista: primeiras citações em 3–6 meses; volume estável em 9–12.

---

## 9. Decisão pendente — onde construir

O site institucional (`cmpadvogados.com.br`) **não está neste repositório** —
aqui só existe o sistema interno (CMPGestão) e páginas soltas em `public/`
(`areas-atuacao.html`, `portal.html`). Antes de escrever a primeira página é
preciso decidir:

- **(a) Site novo em Next.js neste repositório**, servido no mesmo Vercel, com
  conteúdo em markdown versionado. Controle total do HTML, do schema e da
  velocidade — que é exatamente o que essa estratégia exige. Custo: o site atual
  é substituído.
- **(b) Repositório separado em Next.js**, mesma stack, deploy próprio. Mantém o
  sistema interno e o site institucional independentes.
- **(c) Continuar na plataforma atual** (WordPress ou outra) e trabalhar por
  plugin/tema. Mais rápido de começar, mas o controle de schema, de renderização
  e das ~300 rotas fica limitado.

Recomendação: **(b)** — mesma stack já dominada, sem misturar o site público com
o sistema que guarda dados de cliente.

---

## 10. Ordem de execução

| Fase | Prazo | Entrega |
|---|---|---|
| 0 | semana 1 | decidir plataforma (§9), definir NAP oficial, criar o repositório/projeto |
| 1 | semanas 2–4 | base técnica: layout, schema, sitemap, robots, `llms.txt`, Search Console |
| 2 | semanas 3–8 | as 9 páginas-pilar + 27 artigos (3 por pilar) |
| 3 | semanas 6–12 | geográficas com conteúdo local real + páginas setoriais |
| 4 | contínuo | 2–3 artigos/semana, biblioteca, calculadoras |
| 5 | mês 2 em diante | GBP semanal, autoridade externa, teste de citação mensal |
