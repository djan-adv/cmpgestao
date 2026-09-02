---
name: civel-consumidor-cmp
description: >
  Teses, enquadramento jurídico e checklists de Direito Civil e do Consumidor
  brasileiro, no padrão de análise do escritório CMP (Crispim Mendonça e Pinheiro
  Advogados). Use SEMPRE que o usuário pedir para analisar, fundamentar ou redigir um
  caso de Direito do Consumidor (cobrança indevida, vício do produto ou serviço, falha
  de plataforma/intermediário, dano moral por consumo) ou de Direito Civil geral
  (contratos, posse, sucessão/legado, responsabilidade civil), ou quando mencionar
  termos como "CDC", "vício do produto", "cobrança indevida", "repetição em dobro",
  "reintegração de posse", "legado", "herdeiro por representação", "vício do serviço",
  "rescisão contratual", "tutela de urgência" em contexto consumerista/civil. Esta
  skill cobre o ENQUADRAMENTO JURÍDICO da área — qual tese, quais artigos, como
  calcular, quem é parte legítima e os checklists de revisão. Combine sempre com a
  skill `peticoes-cmp` para o método de escrita (IRAC) e a formatação da peça.
---

# Teses e enquadramento jurídico — Cível e Consumidor (CMP)

Esta skill guarda o **conhecimento jurídico substantivo** da área Cível/Consumidor do
escritório: qual tese se aplica a cada padrão de caso, a base legal, como calcular e
os checklists de revisão. Ela complementa a skill `peticoes-cmp` (método de escrita e
formatação) — as duas trabalham juntas: esta decide **o quê** argumentar, a outra
decide **como** escrever e formatar.

Esta skill **não decide a estratégia** do caso concreto (qual tese usar, manter ou
derrubar um réu, valor a pedir) — isso é decisão do advogado responsável pela
estratégia de litígio no escritório. O papel desta skill é **redigir e sinalizar**:
propor o enquadramento mais provável e os pontos de decisão, com um default concreto,
para o advogado confirmar ou ajustar.

> **Sem dados de casos reais.** Esta skill não guarda nomes de partes, CNPJ/CPF,
> valores ou número de processo de casos já trabalhados — isso vem sempre dos
> documentos do processo enviado ou da base de conhecimento do Project daquela área.
> Aqui só fica o enquadramento jurídico reutilizável.

## 1. Teses reutilizáveis

### A. Cobrança consumerista indevida (cartão, anuidade, seguro, tarifa)
Base legal — CDC: dever de informação (art. 6º, III); prática abusiva (art. 39);
repetição em dobro do indevido (art. 42, parágrafo único); inversão do ônus da prova
(art. 6º, VIII); solidariedade da cadeia de fornecimento (ex.: lojista + financeira),
quando ambos participaram da relação de consumo.
**Como calcular:** apure o indevido **somente sobre as faturas efetivamente pagas**,
em ordem cronológica; dobre o valor apurado; **estenda o pedido de dobro às parcelas
pagas até a data da sentença**, a liquidar em cumprimento de sentença (já que parcelas
futuras ainda não são certas no momento da petição). Valor da causa = proveito
econômico total pretendido (dobro das pagas + o que se estender).

### B. Falha de serviço via plataforma ou intermediário
Base legal — CDC: vinculação da oferta (arts. 30 e 35); vício do serviço (art. 20);
restituição do valor pago; dano moral por frustração da expectativa legítima do
consumidor (ex.: viagem, evento, serviço contratado e não prestado).
**Legitimidade passiva:** via de regra recai sobre a **plataforma/intermediário** que
vendeu o serviço (não sobre o estabelecimento final que apenas executaria o serviço),
salvo se houver participação direta do estabelecimento na falha. Avalie sempre se há
base para derrubar um dos réus por ilegitimidade passiva.
**Pedidos típicos:** restituição a quem efetivamente pagou; cobertura de despesa
emergencial gerada pela falha (ex.: serviço substituto); dano moral, calculado por
autor (não por grupo), quando há mais de um autor na mesma ação.

### C. Reintegração de posse + sucessão/legado
Base legal — CC: legado e sucessão por **representação** (arts. 1.851 e 1.852);
defesa da posse contra esbulho. **Monte a cadeia sucessória de forma inequívoca**
(testador/doador → legatário/herdeiro direto → herdeiro por representação) e amarre
cada elo com documento dos autos (testamento, certidão de óbito, termo de
inventariante) — cadeia confusa é o primeiro ponto que a defesa explora.
**Notas de método/estilo:** réplicas neste tipo de caso tendem a ser enxutas
(o foco é reafirmar a cadeia e rebater a defesa, não reabrir todo o mérito); podem
ser enviadas sem timbre quando o padrão do caso pedir; **omitir o valor da causa**
pode ser uma estratégia deliberada do advogado responsável — não reintroduza sem
instrução.

## 2. Checklists de revisão

**Petição inicial (cível/consumidor):**
- Partes e qualificação corretas (nome/razão social, CPF/CNPJ, endereço — só de
  documento).
- Causa de pedir e pedidos coerentes entre si.
- Tutela de urgência fundamentada se cabível (probabilidade do direito + perigo de
  dano, ligados aos fatos concretos).
- Valor da causa coerente com o somatório dos pedidos econômicos.
- Procuração e contrato de honorários anexados.
- Custas definidas ou pedido de gratuidade da justiça fundamentado.

**Contratos:**
- Objeto claro e obrigações de cada parte.
- Preço, forma de pagamento e reajuste.
- Prazo, vigência e renovação.
- Multa, rescisão e hipóteses de extinção.
- Garantias e confidencialidade/LGPD quando aplicável.
- Foro e forma de resolução de conflitos.
- Poderes de quem assina e necessidade de registro.

## 3. Ao redigir

1. Identifique qual das teses (A, B, C — ou combinação) se aplica ao caso, a partir
   dos documentos enviados.
2. Monte o enquadramento (base legal + cálculo + legitimidade) usando este arquivo.
3. Sinalize ao advogado responsável os pontos de decisão estratégica (qual tese, qual
   réu manter, quanto pedir) com um default proposto — não decida por conta própria.
4. Passe para a skill `peticoes-cmp` para o método de escrita (IRAC em prosa) e a
   formatação/geração do .docx no padrão do escritório.

## 4. Como esta skill cresce

Quando um caso novo desta área for concluído e revelar um padrão útil (uma tese nova,
um cálculo diferente, um jeito de driblar uma defesa comum), atualize este arquivo com
o padrão **generalizado** (sem nome de parte, CNPJ/CPF ou nº de processo). O caso real
em si — com os dados — fica registrado no Astrea e, se for útil como exemplo de
redação, na base de conhecimento do Project "CMP — Cível/Consumidor".
