# Projeto — Site do corretor de imóveis (djan.net.br)

> Status: **banco já criado e populado no Supabase real (via MCP). Falta só a parte
> que só o Djan consegue fazer: DNS/nginx da VPS e colar as variáveis de ambiente.**
> Pedido original: site de perfil completo do corretor — imóveis próprios, imóveis em
> parceria, anúncios de terceiros e portal de avaliação — **separado da CMP**, mas
> reaproveitando VPS + GitHub + Supabase já existentes. Domínio confirmado:
> `djan.net.br`, já registrado na Hostinger.

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

1. **Domínio:** `djan.net.br` (já é do Djan). Enquanto o DNS não aponta pra cá, o site
   já responde em `corretor.djan.app.br` (mesmo padrão do `inove.djan.app.br`), pra dar
   pra revisar antes de trocar o domínio de verdade.
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

## 3. O que já está pronto no código (branch `claude/corretor-imoveis-profile-site-4hntzf`)

- **Roteamento por domínio:** `middleware.js` na raiz — quem chega por `djan.net.br`,
  `www.djan.net.br` ou `corretor.djan.app.br` é redirecionado por dentro para as rotas
  em `app/corretor/*`, sem mexer no restante do CMPGestão. O mesmo processo Next/PM2
  atende os dois sites; só o nginx da VPS precisa de mais um `server_name` (ver seção 5).
- **Marca própria:** `app/corretor/layout.jsx` define título/descrição/favicon
  (`public/favicon-corretor.svg`) próprios — não herda "CMPGestão" nem o ícone da CMP.
  Paleta em `app/corretor/_componentes/tema.js` (verde-escuro + dourado queimado),
  deliberadamente diferente do navy/dourado da CMP.
- **Banco:** `ops/sql/imoveis_schema.sql` — schema `imoveis` com as tabelas `perfil`
  (linha única, editável), `imoveis` (próprios e parceria), `anuncios` (terceiros),
  `leads` (avaliação/imóvel/parceria/contato) e `sessoes` (login do painel), mais o
  role `imoveis_app`. **Já aplicado no Supabase real** (projeto `cmpgestao`,
  `ndeqlyrydcijbgjiviuw`) via MCP — schema, tabelas e role já existem lá. Isolamento
  conferido na hora:
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
  direta via `pg`, sem `service_role`, sem tocar no cliente Supabase da CMP). Leitura
  pública (perfil, imóveis, anúncios), envio de lead público, login único do admin e
  CRUD protegido por sessão (Bearer token).
- **Páginas públicas:** `/corretor` (perfil/hero), `/corretor/imoveis` (lista com
  abas Todos/Próprios/Parceria), `/corretor/imoveis/[id]` (detalhe + formulário de
  interesse), `/corretor/parcerias` (imóveis de parceria + formulário para propor
  parceria), `/corretor/anuncios` (vitrine de terceiros), `/corretor/avaliacao`
  (formulário de solicitação).
- **Painel:** `/corretor/admin` — login por senha única, abas Imóveis (CRUD completo),
  Anúncios (CRUD), Solicitações (lista + mudar status) e Perfil (editar bio/contato/foto).
- **Script:** `scripts/hash-senha-imoveis.mjs` — gera o hash da senha do painel (scrypt,
  mesmo formato do Portal do Cliente/Inove).

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
4. **DNS + nginx:** apontar `djan.net.br` (e `www`) para a VPS (Hostinger), e criar o
   `server_name` correspondente no nginx (proxy genérico pra `127.0.0.1:3000`, igual ao
   que já existe pro `inove.djan.app.br`) + certificado SSL (certbot). Enquanto isso não
   acontece, dá pra testar por `corretor.djan.app.br` (mesmo esquema, precisa do DNS
   desse subdomínio apontando pra VPS, se ainda não apontar).
5. **Rebuild:** `npm install` (novo pacote `pg` já é dependência existente, nada novo)
   + `npm run build` + `pm2 restart cmpgestao`.
6. **Conteúdo real:** foto de perfil, telefone/WhatsApp, bio definitiva, completar
   UF/bairro/fotos dos 2 imóveis de teste já cadastrados — tudo pelo painel, sem
   precisar de deploy novo.
7. **Logo/favicon definitivo:** hoje é um "D" provisório em SVG
   (`public/favicon-corretor.svg`) — trocar quando tiver a marca definitiva.
8. **Chat comercial (aba esquerda, azul claro):** esclarecer o que é exatamente antes
   de implementar — ver seção 6.

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
