# Projeto — Site do corretor de imóveis (djan.net.br)

> Status: **código pronto** (portal tipo OLX, certidão paga, vídeo nos anúncios,
> cadastro corretor/proprietário — ver seções 3 e 7). O que falta agora só o Djan
> consegue fazer: colar o **texto do termo de autorização** (já existe, falta só me
> passar) e publicar de verdade — **DNS na Hostinger + nginx + certbot + variáveis de
> ambiente na VPS** (passo a passo na seção 4). Claude não tem acesso a Hostinger/VPS,
> só ao repositório Git e ao Supabase (via MCP) — não consegue executar essa parte.
> Domínio: subdomínio `corretor.djan.net.br` (dentro do `djan.net.br` do Djan, na
> Hostinger).

---

## 1. Dados do corretor

- E-mail: `djan@creci.org.br`
- CRECI: `5401`
- CNAI (avaliador): `8514`
- Título público: **Corretor e Avaliador de Imóveis**
- Telefone: o mesmo número pessoal já usado (WhatsApp) — a definir no painel (`/corretor/admin` → Perfil).

**Restrição levada em conta em todo o site:** nenhuma menção a advocacia, CMP,
"Crispim Mendonça e Pinheiro" ou qualquer termo jurídico — o CRECI veta a mistura de
atividades no material de divulogação do corretor. Marca, cores, favicon e textos são
100% próprios do site do corretor (ver seção 3).

## 2. Decisões tomadas com o Djan

1. **Domínio:** decidido usar o **subdomínio `corretor.djan.net.br`** (dentro do
   `djan.net.br`, que já é do Djan, na Hostinger) — não o domínio raiz. Enquanto o DNS
   não aponta pra cá, o site já responde em `corretor.djan.app.br` (mesmo padrão do
   `inove.djan.app.br`), pra dar pra revisar antes de trocar. `middleware.js` já aceita
   os dois hosts (`corretor.djan.net.br` e `corretor.djan.app.br`), além de
   `djan.net.br`/`www` puro como alternativa — falta só o DNS/nginx (ver seção 4).
2. **Banco:** mesmo projeto Supabase da CMP, mas em **schema isolado (`imoveis`)** com
   role dedicado (`imoveis_app`) sem nenhum privilégio no `public` — mesmo desenho já
   validado com a Inove (ver `ops/PROJETO-INOVE.md`, seção 4). Não é um projeto Supabase
   novo.
3. **Conteúdo:** por enquanto, **só a estrutura + painel de administração** — sem
   imóveis reais cadastrados ainda. O Djan cadastra pelo painel quando tiver fotos/dados.
4. **Portal de avaliação:** um **formulário de solicitação** (nome, telefone, e-mail,
   endereço do imóvel, mensagem) que vira lead na aba "Solicitações" do painel — não é
   vitrine de laudos nem calculadora automática (descartado por agora; se quiser depois,
   registrar aqui antes de reimplementar).
5. **Instagram:** vai ser criado, com foco em **intenção, não atenção** — conteúdo
   pensado pra quem já está em decisão de comprar/vender/avaliar, não pra alcance/viral.
   Sem conta ainda; quando tiver o `@`, entra no campo Perfil → Instagram do painel e
   passa a aparecer no rodapé do site.
6. **Chat "comercial" (aba esquerda, azul claro, como a Agenda):** o Djan pediu pra
   reaproveitar um chat que "já temos pronto". Procurei no sistema inteiro (nav
   Comercial do `sistema.html`, módulo Agenda, `app/chat/`, o widget flutuante do
   `sistema.html`, o chat do `portal.html`) e **não existe nenhum componente que bata
   com essa descrição** — o mais perto é o funil "Comercial" (kanban de leads, sem
   chat) e o chat interno da equipe (`app/chat/`, verde estilo WhatsApp, preso a
   `usuarios`/`processos` da CMP). Fica **pendente de esclarecimento** antes de
   implementar — ver seção 6.
7. **Pivot pra portal tipo OLX (nova decisão):** o Djan recapitulou o pedido — não é
   só uma vitrine que o Djan mesmo alimenta, é um **portal onde qualquer dono de
   imóvel cadastra o próprio anúncio**, igual OLX:
   - **Cadastro é gratuito.**
   - **Impulsionar (destacar) custa R$ 50/mês** — cobrado **por fora, manualmente**
     por enquanto (Pix/dinheiro combinado direto com o Djan); o painel só marca
     "destacado" com uma data de referência pra lembrar de renovar.
   - Ao publicar, o dono do imóvel **autoriza o Djan como corretor a intermediar a
     venda, com direito à comissão** — aceite registrado com data/hora/IP/versão do
     termo (não é blockchain — é o mesmo espírito de "prova de aceite" que o termo
     jurídico local descreve, só que em log de banco, não em rede distribuída).
   - Todo anúncio novo entra como **pendente** e só fica público depois que o Djan
     aprova pelo painel (ele é o corretor responsável, precisa revisar antes).
8. **Pergunta em aberto do Djan sobre pagamento automático:** ele perguntou se conta
   pessoa física do Banco Inter tem API (ele tem conta lá). Resposta: **sim, o Inter
   tem API pública (Central de Desenvolvedores / Inter API) acessível também por
   conta PF**, não só PJ como o Cora — dá pra gerar client_id/client_secret +
   certificado (mTLS) direto no internet banking e cobrar PIX (cobrança imediata/QR
   code) por lá. Não implementado agora porque o pagamento ficou **manual por
   decisão do Djan** nesta rodada — se quiser automatizar depois, essa é uma rota
   viável (diferente do Cora, que já teve PIX dinâmico e cartão testados e
   descartados — ver `CLAUDE.md` — o Inter ainda não foi tentado neste projeto).
9. **djan.net.br já tem um anúncio de avaliação de imóveis:** o Djan mencionou isso e
   Claude não conseguiu confirmar (o proxy da rede bloqueou o fetch externo pro
   domínio, e Claude não tem acesso ao Hostinger). **Fica pendente de confirmação:**
   é um conteúdo que já existe fora deste projeto (ex.: no site builder da Hostinger)
   e precisa ser preservado/substituído, ou é a página `/corretor/avaliacao` que já
   foi construída aqui?

## 3. O que já está pronto no código (branch `claude/corretor-imoveis-profile-site-4hntzf`)

- **Roteamento por domínio:** `middleware.js` na raiz — quem chega por `djan.net.br`,
  `www.djan.net.br` ou `corretor.djan.app.br` é redirecionado por dentro para as rotas
  em `app/corretor/*`, sem mexer no restante do CMPGestão. O mesmo processo Next/PM2
  atende os dois sites; só o nginx da VPS precisa de mais um `server_name` (ver seção 5).
- **Marca própria:** `app/corretor/layout.jsx` define título/descrição/favicon
  (`public/favicon-corretor.svg`) próprios — não herda "CMPGestão" nem o ícone da CMP.
  Paleta em `app/corretor/_componentes/tema.js` (verde-escuro + dourado queimado),
  deliberadamente diferente do navy/dourado da CMP.
- **Banco:** `ops/sql/imoveis_schema.sql` — schema `imoveis` com `perfil` (editável),
  `imoveis` (próprios, parceria **e terceiro/anunciante**, com `anunciante_id`,
  `termo_versao`, `termo_aceito_em`, `destaque_ate`), `anunciantes` (conta do dono do
  imóvel) + `anunciante_sessoes`, `termo` (texto vigente, editável no painel) +
  `termo_aceites` (log de aceite, só insert), `anuncios` (banners de patrocinador —
  feature separada do marketplace de imóveis), `leads`, `sessoes` (admin) e o role
  `imoveis_app`. **Já aplicado no Supabase real** (projeto `cmpgestao`,
  `ndeqlyrydcijbgjiviuw`) via MCP, em duas migrations (`imoveis_schema` e
  `imoveis_marketplace_terceiros`). Isolamento conferido de novo depois da segunda:
  ```
  has_table_privilege('imoveis_app','public.processos','select') → false
  has_table_privilege('imoveis_app','public.processos','update') → false
  has_schema_privilege('imoveis_app','imoveis','usage')           → true
  ```
- **2 imóveis de teste já cadastrados no banco** (`tipo='proprio'`, `status='ativo'`):
  - Casa em Patos, Rua JK 288 — R$ 700.001
  - Prédio comercial em Patos, Rua Felizardo Leite 44 — R$ 1.400.000
  Faltou **UF, bairro e fotos** (o Djan não passou) — completar pelo painel
  (`/corretor/admin` → Imóveis → Editar) assim que o site estiver no ar.
- **API:** `app/api/imoveis/route.js` + `lib.js` — mesmo padrão da Inove (conexão
  direta via `pg`, sem `service_role`, sem tocar no cliente Supabase da CMP).
  Cadastro/login do **anunciante** (dono do imóvel) com sessão própria (scrypt +
  Bearer, mesmo formato do admin), CRUD do próprio anúncio (só o dono edita/exclui o
  que é dele), aceite do termo registrado em `termo_aceites` na hora de publicar.
  Login único do admin continua separado (sessão diferente, `imoveis.sessoes`).
- **Páginas públicas:** `/corretor` (perfil/hero, agora com CTA "Anunciar meu
  imóvel"), `/corretor/imoveis` (lista com abas Todos/Próprios/Parceria/**Anunciantes**),
  `/corretor/imoveis/[id]` (detalhe + formulário de interesse), `/corretor/parcerias`,
  `/corretor/anuncios` (banners), `/corretor/avaliacao` (lead de avaliação),
  `/corretor/termo` (texto do termo de autorização) e **`/corretor/anunciar`** —
  cadastro/login do anunciante + "Meus anúncios" (criar/editar/remover o próprio
  imóvel, com aceite obrigatório do termo pra publicar; todo anúncio novo nasce
  **pendente**, só fica público depois que o admin aprova).
- **Painel:** `/corretor/admin` — login por senha única. Abas: **Terceiros**
  (aprovar/rejeitar anúncio pendente, marcar/remover destaque com data de
  referência de 30 dias), Imóveis (CRUD dos próprios/parceria), Anúncios (banners),
  Solicitações, **Termo** (editar texto/versão do termo de autorização) e Perfil.
- **Script:** `scripts/hash-senha-imoveis.mjs` — gera hash de senha (scrypt), usado
  tanto pro admin quanto internamente pro cadastro de anunciantes.

## 4. O que falta — depende do Djan

1. ~~Rodar o SQL~~ — **feito** (schema/tabelas/role já existem no Supabase real).
2. ~~Senha do role~~ — **feita** (`imoveis_app`), gerada e aplicada. O valor foi
   passado direto no chat (não fica em arquivo nenhum do repositório) — precisa ir
   pro `.env.local` da VPS, ver item 3.
3. **Variáveis de ambiente na VPS** (`/opt/cmpgestao/.env.local`, nunca commitado):
   - `IMOVEIS_DB_URL` — connection string do Postgres como `imoveis_app` (senha
     enviada no chat). Jeito mais seguro de montar certo: **copiar a `INOVE_DB_URL`
     que já está no `.env.local`** e só trocar usuário/senha antes do `@`
     (`imoveis_app:<a-senha-que-mandei>@` no lugar de `inove_app:...@`) — garante o
     mesmo host/porta que já funciona daí. Se preferir montar do zero, o formato
     Supabase costuma ser
     `postgresql://imoveis_app.ndeqlyrydcijbgjiviuw:<senha>@aws-0-sa-east-1.pooler.supabase.com:5432/postgres`
     — mas confirme comparando com a `INOVE_DB_URL` real antes de usar essa segunda opção.
   - `IMOVEIS_ADMIN_SENHA_HASH` — já gerei um hash (senha e hash enviados no chat).
     Se preferir escolher sua própria senha do painel, é só rodar
     `node scripts/hash-senha-imoveis.mjs "sua-senha"` e colar o resultado no lugar.
4. **DNS + nginx do subdomínio `corretor.djan.net.br`** (decisão nova — seção 2, item 1):
   - **Na Hostinger** (painel do domínio `djan.net.br` → DNS / Zona DNS): criar um
     registro pro nome `corretor`. Duas formas, escolha uma:
     - **CNAME** `corretor` → `inove.djan.app.br` (mais simples: reaproveita o mesmo
       hostname que já funciona e já aponta pra VPS certa, sem precisar saber o IP).
     - ou **A** `corretor` → o mesmo IP que o registro A de `inove.djan.app.br` usa
       hoje (confira esse IP no DNS de onde `djan.app.br` está registrado).
   - **Na VPS, no nginx:** criar um `server` block novo com
     `server_name corretor.djan.net.br;` e `proxy_pass http://127.0.0.1:3000;` — copiar
     a configuração que já existe pro `inove.djan.app.br` e só trocar o `server_name`.
   - **Certificado SSL:** `certbot --nginx -d corretor.djan.net.br` (depois do DNS já
     estar propagado, senão o certbot falha ao validar).
   - Enquanto isso não estiver pronto, dá pra revisar por `corretor.djan.app.br`
     (mesmo esquema, já deve estar respondendo se o DNS desse subdomínio já aponta
     pra VPS).
   - Se preferir usar o domínio raiz (`djan.net.br`/`www`) em vez do subdomínio, o
     código já aceita os dois — é só apontar o DNS raiz pra VPS em vez do `corretor`.
5. **Rebuild:** `npm install` (novo pacote `pg` já é dependência existente, nada novo)
   + `npm run build` + `pm2 restart cmpgestao`.
6. **Conteúdo real:** foto de perfil, telefone/WhatsApp, bio definitiva, completar
   UF/bairro/fotos dos 2 imóveis de teste já cadastrados — tudo pelo painel, sem
   precisar de deploy novo.
7. **Logo/favicon definitivo:** hoje é um "D" provisório em SVG
   (`public/favicon-corretor.svg`) — trocar quando tiver a marca definitiva.
8. **Chat comercial (aba esquerda, azul claro):** esclarecer o que é exatamente antes
   de implementar — ver seção 6.
9. **Texto do termo de autorização — bloqueia o marketplace:** o Djan disse que já
   tem um texto pronto. **Preciso que ele me passe esse texto** — sem ele, o campo
   fica em branco em `imoveis.termo` e a página `/corretor/termo` mostra "ainda não
   foi cadastrado". Anunciante consegue publicar mesmo assim (o checkbox de aceite
   não trava no texto vazio), mas o aceite não vale nada sem o termo de verdade —
   **não divulgar `/corretor/anunciar` publicamente até isso ser resolvido**. Assim
   que o Djan mandar o texto, entra pelo painel (`/corretor/admin` → Termo) — não
   precisa de deploy novo.
10. **Confirmar o que já existe em djan.net.br:** o "anúncio de avaliação de
    imóveis" que o Djan mencionou — é conteúdo fora deste projeto (Hostinger) ou é
    a página `/corretor/avaliacao` já construída aqui? Ver item 9 da seção 2.

## 5. Notas técnicas

- **Por que schema isolado, não projeto Supabase novo:** mesmo raciocínio já registrado
  em `ops/PROJETO-MULTIEMPRESA.md` e `ops/PROJETO-INOVE.md` — banco separado não reduz
  risco, aumenta (mais uma conta pra manter, sem ganho de isolamento real, já que o
  isolamento aqui é por role/schema, à prova de bug do Postgres, não por "estar em outro
  lugar").
- **Roteamento por domínio dentro do Next (`middleware.js`), não só por nginx:** o
  `inove.djan.app.br` depende inteiramente de um arquivo estático + link direto; aqui,
  qualquer rota nova em `app/corretor/*` já responde em qualquer domínio mapeado no
  `middleware.js`, sem precisar mexer no nginx de novo a cada página nova — só na
  primeira vez, pra apontar o domínio pro mesmo processo.
- **Sem `service_role`, sem `@supabase/supabase-js`** em `app/api/imoveis/` — conexão
  direta por `pg` como `imoveis_app`, que não tem privilégio nenhum em `public`
  (dados jurídicos da CMP). Verificar depois de criar o role, mesmo teste feito pra
  Inove:
  ```sql
  select has_table_privilege('imoveis_app','public.processos','select'); -- deve ser false
  ```

## 6. Chat "comercial" — pendente de esclarecimento

Pedido: reaproveitar "o chat que já temos pronto de comercial, aba esquerda, azul
claro, parecido com o que já temos de agenda". Procurei em:
- `public/sistema.html` — nav "Comercial" é o **funil de leads (kanban)**, sem chat.
- Módulo "Agenda" — é o calendário/kanban de prazos, sem aba lateral nem chat.
- `app/chat/` (`/chat`) — chat interno da equipe, tela cheia, cores verde/WhatsApp,
  preso a `usuarios`/`processos`.
- Widget flutuante do `sistema.html` (`#cmp-chat`) — **canto inferior direito**, fundo
  amarelo claro, não esquerda/azul.
- `public/portal.html` (`#chat`) — modal cheia tela do portal do cliente, mesmo padrão
  de cores.

**Nenhum bate com "aba esquerda, azul claro".** Antes de implementar qualquer coisa,
preciso confirmar com o Djan: é uma tela específica que ele viu (print/link) e eu não
achei, ou é um pedido novo (ex.: um widget de chat/WhatsApp flutuante, à esquerda, azul
claro, pro site do corretor) inspirado na cara do menu do CMPGestão?

## 7. Backlog — ideias novas do Djan (ainda não implementadas)

Lista aberta em `2026-08-13`, só juntando pra executar tudo de uma vez depois — nada
disto está feito ainda.

1. ~~Botão "Solicitar certidão do imóvel"~~ — **feito.** Página `/corretor/certidao`
   (também linkada no cartão de serviços da home e no botão da página de detalhe do
   imóvel), lead tipo `certidao`, R$ 360 — cobrança manual (mesmo modelo do destaque:
   o Djan combina o pagamento por fora antes de emitir).
2. **"Quadro de imóveis de contato próprio"** — ainda não esclarecido: se é uma
   seção/vitrine separada pros imóveis que já são `tipo='proprio'` (destacando o
   contato direto com ele, sem intermediário), ou algo diferente do que a aba
   "Próprios" já mostra hoje em `/corretor/imoveis`.
3. **Reforço de "imóveis de terceiros / parceria"** — já existem (`tipo='parceria'` e
   `tipo='terceiro'`); provavelmente só reafirmar prioridade, não pedido novo —
   confirmar se há algo além do que já está em `/corretor/imoveis` (abas
   Próprios/Parceria/Anunciantes) e no painel (aba Terceiros).
4. ~~Cadastro perguntando "corretor ou proprietário"~~ — **feito.** `/corretor/anunciar`
   agora pergunta no cadastro (`anunciantes.papel`, `'proprietario'` ou `'corretor'`) e
   roteia o anúncio publicado pro tipo certo: `proprietario` → `tipo='terceiro'`
   (pendente de aprovação, como já era); `corretor` → `tipo='parceria'`, com
   `parceiro_nome`/`parceiro_contato` preenchidos automaticamente com os dados da
   conta. **Assunção que fiz sem confirmar com o Djan:** usei o **mesmo termo de
   autorização** pros dois papéis — se ele quiser um texto diferente pra corretor
   parceiro (ex.: sem cláusula de comissão do dono, já que quem assina é outro
   corretor), isso ainda não está separado (`imoveis.termo` é uma linha só, sem
   variação por papel).
5. **Botão "Solicitar avaliação de imóvel"** — já existia, mantido em destaque.
6. ~~Espaço pra vídeo nos anúncios~~ — **feito.** Campo `video_url` (link do
   YouTube/outro) no cadastro (painel admin e `/corretor/anunciar`), embutido como
   player na página de detalhe do imóvel (ou link simples se não for YouTube). Fotos
   e descrição já existiam.
7. **Marca d'água opcional da Djan Imóveis nas fotos:** ainda não implementado — hoje
   as fotos são só **URLs digitadas** (não existe upload de arquivo/armazenamento no
   site), então antes de aplicar marca d'água tem duas coisas pra decidir: (a) montar
   um pipeline de upload de verdade (provavelmente Supabase Storage — hoje não tem
   nenhum bucket configurado pra isso) e (b) ter a **logo/marca definitiva** do Djan
   pra usar como marca d'água (ainda é um "D" provisório, ver seção 4, item 7). Sem
   essas duas coisas resolvidas, fica maior que os outros itens do backlog.
