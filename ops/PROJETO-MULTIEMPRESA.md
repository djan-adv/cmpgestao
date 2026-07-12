# Projeto — CMPGestão como produto multi-empresa (SaaS / white-label)

> Status: **visão registrada, a construir por fases** (fundação ainda não iniciada).
> Objetivo: transformar o CMPGestão de um sistema de 1 escritório numa **raiz única**
> que atende **vários escritórios (inquilinos)**, cada um com domínio, marca e e-mail
> próprios, sem cópias independentes e sem nada preso ao nome do dono.
>
> Este documento é o **registro fiel das ideias, perguntas e decisões do Djan** nesta
> conversa, mais a arquitetura recomendada. Vai sendo atualizado conforme evoluímos.

---

## 1. A visão em uma frase
Uma **raiz só** (um código, um servidor, um banco) que serve **N escritórios**, cada um
enxergando **apenas os seus dados**, com **domínio/marca/e-mail próprios** (white-label),
vendido em **planos por número de acessos**.

---

## 2. Log de ideias e decisões do Djan (nesta conversa)

1. **Acesso restrito para a equipe Inove:** liberar acesso a pessoas da Inove que vejam
   **só os processos da pasta Inove**; podem incluir processos e usar todas as
   ferramentas, **exceto envio de e-mail**. → vira o **1º inquilino-protótipo**.
2. **Sem cadastrar senha de ninguém:** o Djan não quer digitar senha de usuário. As
   pessoas devem **entrar com o próprio e-mail e senha** (auto-cadastro por link).
3. **E-mail estilo Astrea:** o sistema envia de **um único remetente**, configurado uma
   vez, **sem senha por usuário**. E-mail institucional (ex.: domínio novo tipo
   *CMPDigital*, sem nome de advogado) fica para depois; por ora envio desligado p/ Inove.
4. **Nada vinculado ao Djan:** para vender a outros escritórios, **nada** pode estar
   preso ao nome/escritório/e-mail dele (marca, coordenador, id chumbado → viram
   configuração por inquilino).
5. **Raiz alimenta os outros:** "o nosso sistema seria a raiz pra alimentar os outros,
   pra não ter vários sistemas independentes." → **multi-tenant, não forks.**
6. **Um e-mail por cliente + assentos por plano:** o Djan cadastra **1 e-mail por
   cliente** e libera **X acessos conforme o pacote**. Exemplos citados:
   100 processos → 3 acessos; 200 → 5; (mais) → 10.
7. **Cliente = pasta no painel-mãe:** cada cliente aparece como **pasta** no menu
   esquerdo do Djan (como Inove/Encerrados/James). Ele controla tudo do painel-mãe;
   os sub-acessos veem só a pasta deles. Quando crescer, o **próprio escritório do
   Djan vira "mais uma pasta/cliente"**.
8. **Infra (GitHub + VPS + Supabase):** "poderia ficar tudo no VPS? compensa?"
   → **Decisão: manter** GitHub (cofre/histórico/rollback, grátis) + Supabase
   (banco/login/arquivos/IA, barato) + VPS (roda o app). Consolidar tudo no VPS
   **não compensa** (risco de disco único, virar administrador de banco). Se a dor for
   o build manual, a solução é **automatizar o deploy**, não trocar a infra.
9. **Storage de 30 GB de documentos (VPS de 100 GB):** cabe agora, mas apertado e é
   **disco único** (precisa de backup próprio dos arquivos). Para escalar, mover
   documentos para **storage de objetos** (recomendado **Cloudflare R2** — barato e
   sem taxa de download), separado por cliente. Custos ~US$0,18–0,63/mês para 30 GB.
10. **Revender hospedagem/domínio/e-mail (Hostinger):** "melhora ou piora?"
    → **Domínio + e-mail + marca por cliente = MELHORA** (upsell, sensação de dono),
    **desde que por cima da raiz única**. **Hospedagem/instalação separada por cliente =
    PIORA** (recria os "vários sistemas independentes"). 
11. **Cliente vai pedir vários ajustes — site por cliente ou site único?**
    → **Site/sistema ÚNICO para vender em escala.** Personalização = **configuração,
    não código**. Pedidos entram em 3 baldes: (a) configuração (self-service),
    (b) vira recurso de todos (constrói uma vez), (c) one-off = add-on pago opcional,
    nunca um fork. Governança: fila de sugestões (já existe), planos em camadas.
12. **Cada cliente com seu domínio, rodando na mesma raiz?** → **Sim.** Modelo Shopify:
    `joseadvocacia.com.br`, `pedroadvocacia.com.br`, cada um com marca/e-mail próprios,
    todos numa raiz só.
13. **"Gravar tudo"** e **"o sistema, como está, já pode ser a raiz de outros?"**
    → este documento; resposta na seção 6.

---

## 3. Arquitetura recomendada (white-label multi-tenant)

**Peças:**
1. **Inquilino (tenant) = escritório/cliente.** Cada um tem: seus processos, seu plano
   (nº de assentos), sua marca, seu domínio, seu link de convite.
2. **Isolamento por RLS.** No banco, cada usuário só lê/escreve dados do seu inquilino
   (por `escritorio_id`). À prova de falhas — segurança real, não só tela.
3. **Auto-cadastro por link de convite.** A pessoa abre o link, cria e-mail+senha
   (Supabase Auth), fica amarrada àquele inquilino, contando 1 assento. Ao lotar o
   plano, novos convites bloqueiam. O dono não gerencia senha.
4. **Domínio próprio → inquilino.** O domínio do cliente aponta para a raiz (DNS);
   a raiz reconhece o domínio e troca **marca + escopo de dados**. SSL automático por
   domínio.
5. **Marca por inquilino** (logo/nome/cores da configuração) — nada chumbado.
6. **Remetente único por domínio do cliente** (SPF/DKIM configurados uma vez); envia
   como `@dominiodocliente`. Sem senha por usuário (modelo Astrea).
7. **Painel-mãe:** o operador (Djan) vê todos os inquilhinos como **pastas** no menu.

**Personalização sem fork:** marca, ligar/desligar módulos por plano, campos/etapas/
etiquetas editáveis (já existe no funil e etiquetas), modelos de e-mail/documento.

---

## 4. Modelo comercial
- **Planos por assentos** conforme volume (ex.: 100 proc → 3 acessos; 200 → 5; mais → 10).
- **Pacote white-label:** sistema + **domínio** + **e-mail** (revenda Hostinger) = ticket
  maior e cliente mais retido.
- **Add-on de customização** para pedidos sob medida (sempre generalizando em recurso).

---

## 5. Infra e storage (decisões)
- **Manter:** GitHub (código/histórico/rollback) + Supabase (banco/login/arquivos/IA) +
  VPS (app). É o arranjo mais barato e seguro; certo para escalar.
- **Documentos:** migrar de `/opt/cmpdocs` (disco do VPS) para **storage de objetos
  (Cloudflare R2)**, separado por inquilino — antes que o VPS encha. Ajuste na rota
  `/api/docs`.
- **Backup dos arquivos:** hoje o backup cobre o banco; **os arquivos precisam de backup
  próprio** (urgente antes de subir os 30 GB).
- **Deploy:** automatizar `build`+`restart` no botão Publicar (tira a chatice do terminal)
  — não exige mudar a infra.

---

## 6. O sistema, como está, já pode ser a raiz de outros?
**Quase — a estrutura tem a forma certa, mas ainda NÃO está "pronto de fábrica".**

**Já existe (boa fundação):**
- Conceito de inquilino via `escritorio_id` nas tabelas; Supabase Auth; tabela `usuarios`.
- Padrão de **pastas** no menu (Inove, Encerrados, James) — a UI para agrupar por cliente.
- Personalização por configuração já iniciada (funil com etapas editáveis, etiquetas,
  changelog de sugestões).
- Envio por **remetente único** (`/api/enviar-email`).

**Falta (o que impede "as-is"):**
- **Descolar do Djan:** hoje há coisas chumbadas — `escritorio_id` fixo, coordenador
  `djan.adv@gmail.com` fixo (em `/api/acessos` e `/api/deploy`), marca "CMPGestão/CMP"
  no HTML. Tudo isso vira **configuração por inquilino**.
- **RLS por inquilino à prova de falhas** em todas as tabelas (auditar/fechar).
- **Domínio → inquilino** (mapeamento + SSL por domínio) — não existe ainda.
- **Marca por inquilino** (config de logo/nome/cores) — não existe ainda.
- **Onboarding de inquilino** + **link de convite** + **limite de assentos** — não existe.

**Conclusão:** não é um recomeço — é uma **evolução**. Os ossos certos já estão lá; falta
o encanamento multi-inquilino e remover o que está preso ao nome do dono. A **Inove** é o
primeiro inquilino que nos obriga a construir esse encanamento do jeito certo.

---

## 7. Ordem de construção (fases)
1. **Fundação + Inove como 1º inquilino:** coluna/isolamento por inquilino, perfil
   restrito, RLS, link de convite com auto-cadastro e limite de assentos, envio de
   e-mail desligado para o perfil restrito.
2. **Descolar do dono:** marca/coordenador/id viram configuração; painel-mãe com
   clientes como pastas; botão "novo cliente" (plano/assentos, gera link).
3. **White-label por domínio:** domínio próprio → inquilino, SSL automático, marca por
   inquilino, remetente por domínio do cliente (SPF/DKIM).
4. **Storage de objetos (R2)** para documentos, por inquilino.
5. **Cobrança/planos** automatizada.

## 8. Ressalva importante (sigilo)
Neste modelo, o operador (Djan) enxerga os dados de todos os inquilinos pelo painel-mãe.
Para advocacia isso mistura **sigilo entre escritórios** — ok para começar, mas ao vender
para terceiros provavelmente vamos querer uma **camada extra de isolamento** (o operador
não ver o conteúdo dos clientes). A decidir na fase de produto.

## 9. Relacionados
- `ops/PROJETO-GESTAO-FINANCEIRA.md` — módulo financeiro (Cora + NFS-e).
- `ops/IDEIAS-FUTURAS.md` — outras ideias guardadas.

---

## 10. Inove — 1º inquilino (spec de entrega)

**Negócio:** perícia atuarial (perito atuário **Thiago Silveira**). Dois módulos:
- **Cadastros (Tribunais):** cadastro do Thiago como auxiliar/perito nos **27 TJs**
  (tabela `inove_tribunais`, já carregada com situação real: 9 cadastrado, 7 enviado,
  11 a fazer — link, senha, observações por TJ).
- **Processos (perícias):** triagem/kanban das perícias, usando as **57 movimentações**
  próprias do Thiago (`inove_movimentacoes`) e os **quesitos** (`inove_quesitos`).

**Endereço:** `inove.djan.app.br` (subdomínio na mesma Hostinger do VPS) — depois trocado
pelo **domínio próprio deles**.

**Perfil `inove` (restrições):**
- **Sem** "Agendar com Claude", **sem** envio de e-mail.
- **Sem** marca CMP em nada — tela **neutra** (sem nome/logo de advogados da CMP).
- **Sem** busca no DJEN por advogado (cada processo tem um advogado diferente; Thiago é o
  perito, não o advogado).
- Vê **só a pasta dele** (isolamento por inquilino — RLS).

**Acessos:** **3 logins da Inove + 1 de teste (Djan)**. Auto-cadastro por **link**
(a pessoa cria e-mail e senha próprios; Djan não gerencia senha). Limite por plano.

**Painel de sugestões próprio (comercial):** botão **"Solicitar novas funcionalidades"**
(nome comercial). Fluxo: cliente pede → **Djan aprova e define valor** → **pagamento
comprovado → inicia**. Separado do painel de Sugestões da CMP.

**Documento-padrão:** gerar o documento de cadastro/declaração preenchido com os dados do
Thiago (fornecidos: Dados cadastrais, Declaração perito atuarial, Currículo — com marca
d'água). CPF Thiago 063.474.586-75; CNPJ Inove 24.756.013/0001-53 (do NUPeJ RN).

**Isolado da CMP:** nada da Inove entra no painel Sugestões/Melhorias da CMP; a CMP é a raiz.

### O que falta para entregar
- App: seção **Cadastros (Tribunais)** (pronta) + módulo **Processos/triagem** com as 57
  movimentações; **perfil inove** (esconde Agendar/e-mail/DJEN-advogado/marca CMP);
  **branding neutro**; painel **"Solicitar novas funcionalidades"** com aprovação+valor.
- Infra (depende do Djan): apontar **DNS `inove.djan.app.br` → VPS**; **rebuild** no VPS
  para rotas novas; criar os **3+1 acessos** (link de convite).

---

## 11. Inove — status de entrega (atualizado 12/07/2026)

**Pronto no sistema (raiz CMP, perfil neutro):**
- Cadastros nos 27 TJs com situação real, links e senhas (módulo Cadastros/Tribunais).
- Processos Inove (pasta própria, sem automações da CMP).
- Perfil de login **"Perito / Inove"** com **marca neutra ("Portal do Perito")**:
  esconde marcas e ferramentas exclusivas da CMP no menu e na ficha (Agendar com
  Claude, e-mails de Acompanhamento/Atualizar cliente). Abre direto na pasta Inove.
- **Solicitar novas funcionalidades** (sugestões pagas): solicitante envia →
  coordenador aprova com valor → pago → em desenvolvimento → concluída. Tabela
  `inove_solicitacoes`.
- **Documento-padrão do atuário**: perfil editável (nome/CPF/CNPJ já preenchidos;
  demais campos em branco) + modelo com campos {{substituíveis}}, geração por
  tribunal, copiar/baixar .txt. Tabela `inove_config`. Regra respeitada: nada de
  dado inventado — campos sem informação ficam visíveis como {{campo}}.

**Depende do Djan (infra/decisão):**
- DNS `inove.djan.app.br` → VPS (Hostinger) — ou domínio próprio do cliente depois.
- Rebuild do VPS (`npm run build` + `pm2 restart cmpgestao`) para rotas novas.
- Criar os **3 acessos Inove + 1 de teste (nosso)** por link de auto-cadastro
  (o cliente define o próprio e-mail/senha; Djan não gerencia senha) — exige a
  auth separada por inquilino (escopo real de dados por tenant).
- Colar o **modelo real** do documento e completar os dados cadastrais do Thiago
  (RG, registro profissional, endereço, e-mail, telefone) uma única vez.
