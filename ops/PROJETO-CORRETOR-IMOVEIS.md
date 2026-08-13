# Projeto — Site do corretor de imóveis (djan.net.br)

> Status: **base construída, depende de infra/credenciais do Djan para ir ao ar.**
> Pedido original: site de perfil completo do corretor — imóveis próprios, imóveis em
> parceria, anúncios de terceiros e portal de avaliação — **separado da CMP**, mas
> reaproveitando VPS + GitHub + Supabase já existentes.

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
  role `imoveis_app`.
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

1. **Rodar o SQL:** colar `ops/sql/imoveis_schema.sql` inteiro no SQL Editor do
   Supabase do projeto `cmpgestao`.
2. **Senha do role:** `alter role imoveis_app with password 'uma-senha-forte';` — não
   fica em arquivo nenhum.
3. **Variáveis de ambiente na VPS** (`/opt/cmpgestao/.env.local`, nunca commitado):
   - `IMOVEIS_DB_URL` — connection string do Postgres do Supabase como `imoveis_app`
     (mesmo host/porta usados em `INOVE_DB_URL`, só troca usuário/senha).
   - `IMOVEIS_ADMIN_SENHA_HASH` — rodar `node scripts/hash-senha-imoveis.mjs "senha"`
     e colar o resultado.
4. **DNS + nginx:** apontar `djan.net.br` (e `www`) para a VPS, e criar o `server_name`
   correspondente no nginx (proxy genérico pra `127.0.0.1:3000`, igual ao que já existe
   pro `inove.djan.app.br`) + certificado SSL (certbot). Enquanto isso não acontece, dá
   pra testar por `corretor.djan.app.br` (mesmo esquema, só precisa do DNS desse
   subdomínio apontando pra VPS, se ainda não apontar).
5. **Rebuild:** `npm install` (novo pacote `pg` já é dependência existente, nada novo)
   + `npm run build` + `pm2 restart cmpgestao`.
6. **Conteúdo real:** foto de perfil, telefone/WhatsApp, bio definitiva, primeiros
   imóveis (fotos + dados) — tudo cadastrável direto no painel, sem precisar de deploy
   novo.
7. **Logo/favicon definitivo:** hoje é um "D" provisório em SVG
   (`public/favicon-corretor.svg`) — trocar quando tiver a marca definitiva.

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
