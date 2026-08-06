# Projeto — RI Digital (ONR): pesquisa de bens e matrícula de imóveis

> Status: **em pesquisa — bloqueado em confirmação de acesso** (não iniciado).
> Objetivo: consultar, pelo CMPGestão, se uma pessoa física/jurídica tem imóvel
> registrado em algum cartório do Brasil, e pedir certidão/matrícula digital.
> Fecha uma lacuna que o próprio sistema já avisa que tem hoje — o **Dossiê do
> Devedor** diz explicitamente "não substitui... Registro de Imóveis"
> (`app/api/devedor/dossie/route.js:22,293`).

---

## 1. O que é o RI Digital

Não é um produto qualquer — é o nome oficial da plataforma nacional do **ONR**
(Operador Nacional do Sistema de Registro Eletrônico de Imóveis), sucessora do
antigo SAEC, em **https://ridigital.org.br**. Conecta os Registros de Imóveis
do Brasil (a ONR fala em milhares de serventias) num único ponto de acesso.
Serviços listados no site: certidão digital, visualização de matrícula,
protocolo eletrônico, acompanhamento do processo registral, e dois que
interessam diretamente:

- **Pesquisa Nacional de Bens (Pesquisa Prévia)** — relatório informativo das
  matrículas associadas a um CPF/CNPJ.
- **Pesquisa Qualificada** — busca de imóvel e outros direitos reais
  registrados num CPF/CNPJ, em base compartilhada pelos Registros de Imóveis
  do Estado.

Existe também um **manual de integração** publicado no próprio site
(`ridigital.org.br/Downloads/Manualintegracaocartorios.pdf`, "Instruções para
integração no Sistema ONR") que menciona Web Services/API — ou seja, ao
contrário do que a pesquisa inicial sobre "RI Digital" sugeria, **não é só um
portal manual**: existe integração programática documentada. O título do
manual ("integração de cartórios") sugere que o público primário são as
próprias serventias, mas não dá pra saber, sem abrir o PDF, se advocacia/
sistemas terceiros têm uma porta de entrada equivalente para consulta.

## 1.1 Confirmado: eles têm API

Achei dois tutoriais em vídeo — **"Como ativar o credenciamento e gerar sua
chave de API no RI Digital"** (um publicado em junho/2026):
- https://www.youtube.com/watch?v=2NpsswX-v34
- https://www.youtube.com/watch?v=jwB4THQ4W9o

Existência de um fluxo de **credenciamento self-service que gera chave de
API** está confirmada — não é só o manual PDF genérico. Também achei
descrição de uma **API de integração "XML v5" já habilitada**, pela qual o
**cartório** disponibiliza o Indicador Pessoal/Livro 2 para a central
ONR/RI Digital (preferencialmente via Web Service; se a serventia não tiver
infraestrutura, cai para um Next Cloud SAS). Essa parte é claramente
**cartório → central** (enviar dado), não o que o escritório precisa.

O que falta descobrir é se o **mesmo fluxo de credenciamento dos vídeos**
serve para **consulente externo** (escritório de advocacia pesquisando) ou é
só para a serventia. Os títulos não especificam — só assistindo dá pra saber.

## 2. O que não consegui confirmar (bloqueio real)

O proxy de saída deste ambiente **recusa conexão com `ridigital.org.br`**
(bloqueio de política, confirmado em `$HTTPS_PROXY/__agentproxy/status`:
`connect_rejected` para `ridigital.org.br:443`) — não é bloqueio do site, é
deste sandbox. Tentei também `web.archive.org` e o YouTube direto (pra ler os
vídeos do item 1.1); os dois também foram recusados. Não consegui abrir nem a
página inicial nem o manual de integração nem assistir aos vídeos. Ficou
pendente, e só dá pra confirmar de um navegador normal:

1. Assistir aos dois vídeos do item 1.1 — é o atalho mais rápido para saber
   se dá pra credenciar o escritório como consulente.
2. Se pessoa jurídica (escritório de advocacia) pode se cadastrar como
   **usuário/consulente** direto no RI Digital, ou se o acesso é só para
   cartórios/correspondentes.
3. O conteúdo do manual de integração — se a API é só para cartório *enviar*
   dado (como a CENSEC, que descartamos por isso) ou também para *consultar*.
4. Preço por consulta (Pesquisa Nacional de Bens x Pesquisa Qualificada x
   certidão de matrícula) — isso é regulado por tabela de emolumentos de cada
   Corregedoria estadual, então varia, mas o site deveria informar a faixa.
5. Se a antiga rota via **ARISP/Central Registradores (SP)** foi mesmo
   absorvida pelo RI Digital nacional — um indício forte: a API equivalente
   que a Infosimples (um dos brokers que pesquisei) oferecia para
   "Pesquisa Prévia de Bens" via ARISP aparece hoje como **descontinuada**.

## 3. Arquitetura no CMPGestão (proposta, a confirmar depois do item 2)

Seguindo o padrão já usado em `app/api/cora/`, `app/api/jusbr/` e
`app/api/inpi/robo/` (pasta por serviço, `lib.js` com URL base + auth,
sem framework genérico):

- `app/api/ri/lib.js` — client HTTP + autenticação (mecanismo ainda
  desconhecido — pode ser certificado como o Cora, pode ser usuário/senha +
  token como o PDPJ, pode ser API key como a CENSEC).
- `app/api/ri/pesquisa/route.js` — Pesquisa Nacional de Bens por CPF/CNPJ,
  sob demanda (botão, não robô — não existe "novidade periódica" aqui como no
  INPI; é consulta pontual).
- `app/api/ri/matricula/route.js` — pedido/visualização de matrícula e
  certidão digital de um imóvel específico.
- Ponto de entrada natural: um botão **"🏠 Pesquisar bens (RI Digital)"**
  dentro do próprio **Dossiê do Devedor** (`app/api/devedor/dossie/`), já que
  é lá que o sistema hoje admite a lacuna — e o dossiê já sabe achar CPF/CNPJ
  do devedor nas publicações do DJEN.
- Tabela nova (rascunho): `ri_consultas` (id, tipo `pesquisa_bens|matricula|
  certidao`, cpf_cnpj_pesquisado, processo_id/pasta vinculada, resultado_json,
  custo_centavos, solicitado_por, criado_em) — mesmo espírito de log de custo
  que `ia_uso` já usa para a Anthropic.
- Como cada consulta tem custo real (emolumento), replicar o padrão de
  confirmação explícita já usado na Gestão Financeira: **"Pesquisar bens no RI
  Digital? Isso custa ~R$ X. Sim/Não"** — nunca disparar automático.

## 4. Segurança / LGPD

- CPF/CNPJ pesquisado e o resultado (existência de patrimônio) são dado
  sensível — registrar **quem pediu, quando e em qual processo/finalidade**
  (auditoria), igual já se discute para a Gestão Financeira.
- Acesso à consulta restrito a quem já tem acesso ao Dossiê do Devedor —
  sem tela nova de permissão.
- Credenciais do RI Digital (o que quer que sejam) só no servidor (VPS),
  nunca no navegador — mesmo princípio do Cora e do PDPJ.

## 5. Custos aproximados

**Não confirmado** (ver item 2.3) — depende de:
- Cadastro/mensalidade no RI Digital em si (se houver).
- Emolumento por consulta, tabelado por estado (na faixa de outras consultas
  cartorárias hoje, tipicamente dezenas de reais por certidão).
- Alternativa paga via broker (ex.: Infosimples) tem preço por chamada +
  franquia mínima mensal de R$ 100 segundo o site deles — mas essa rota
  específica de pesquisa de bens parece ter sido descontinuada por eles
  (ver item 2.4), então não é hoje um plano B confiável sem reconfirmar.

## 6. Fases sugeridas

1. **Confirmação de acesso** — você abre `ridigital.org.br`, vê se dá pra
   cadastrar o escritório como usuário/consulente e baixa o manual de
   integração. Sem isso, as fases abaixo são só esqueleto.
2. **POC manual** — uma consulta de teste (pelo portal mesmo, sem API) para
   ver o formato do resultado antes de programar contra ele.
3. **Rota de consulta on-demand** — `app/api/ri/pesquisa/route.js` +
   botão no Dossiê do Devedor, em homologação se existir ambiente de teste.
4. **Produção** — com confirmação "Sim/Não" de custo, registro em
   `ri_consultas`, e atualização do texto de limites do Dossiê do Devedor
   (tirar o "não substitui Registro de Imóveis" da lista de limitações).

## 7. Preciso de você para iniciar

1. Acessar `ridigital.org.br` e verificar: cadastro para escritório de
   advocacia é possível? Onde fica ("área do usuário", "desenvolvedor",
   "credenciamento")?
2. Baixar e me passar (ou colar o conteúdo relevante d)o manual
   `Manualintegracaocartorios.pdf` — em especial a parte de autenticação e os
   endpoints de consulta (se houver, além do envio de dados por cartório).
3. Se o cadastro pedir alguma aprovação/contrato formal com a ONR, iniciar
   esse processo — normalmente é o item que mais demora, não o código.

## 8. Decisões em aberto

- Pesquisa Nacional de Bens x Pesquisa Qualificada — são produtos diferentes
  (preço/cobertura/força probatória); qual cobre a necessidade real (due
  diligence rápida vs. algo que sustente petição)?
- Cadastro é por CNPJ do escritório (uso coletivo) ou por advogado
  individual?
- Se o RI Digital não abrir API de consulta pra terceiros (só para
  cartórios, como a CENSEC), o caminho vira 100% broker pago — vale então
  reavaliar Infosimples ou similar com cotação atual, item por item.
- Cobrança da consulta repassa ao cliente/processo ou é custo do escritório
  (mesma pergunta já em aberto na Gestão Financeira para a NFS-e)?
