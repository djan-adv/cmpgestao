# Migração do Assinador — juntar os dois bancos e derrubar US$ 10/mês

**Status:** passo 0 decidido, passo 1 em andamento. Levantamento feito em 04/08/2026.
As decisões do passo 0 e as correções ao inventário estão na **seção 10**, no fim
deste arquivo — leia antes de executar qualquer passo.

Este arquivo existe para que a obra possa ser executada em qualquer sessão nova
sem refazer o levantamento. Leia daqui, não do zero.

---

## 1. Por que existem dois projetos

Não foi decisão de arquitetura — foi ordem cronológica.

| Projeto | Ref | Região | Criado |
|---|---|---|---|
| Assinador | `fjboytucivmdykkfpdhs` | us-east-1 | **02/07/2026** |
| CMP Gestão | `ndeqlyrydcijbgjiviuw` | sa-east-1 | 03/07/2026 |

O assinador nasceu **um dia antes** do Gestão, como produto independente rodando em
`djan.app.br/link/` (HTML estático falando direto com o Supabase dele). Depois foi
trazido para dentro do Gestão como módulo, e o `ops/MODULO-ASSINATURA.md` registra a
decisão da época: *"Nada foi alterado no banco nem nas edge functions. Os dois convivem."*

Ou seja: manteve-se o banco separado porque era o caminho que não quebrava nada, não
porque separado fosse melhor.

## 2. Quanto custa hoje e quanto passa a custar

Org `rcgcxdcuijaskmctfglj`, plano **Pro**.

```
Pro Plan                      US$ 25
Compute projeto Gestão        US$ 10
Compute projeto Assinador     US$ 10
Créditos de compute          -US$ 10
                             ────────
hoje                          US$ 35 / mês
depois da migração            US$ 25 / mês
```

**Economia: US$ 10/mês, US$ 120/ano.**

### O detalhe que fecha a porta do meio-termo

No plano Pro **não dá para pausar projeto**. A documentação da Supabase é explícita:
*"Only Free Projects can be paused at this time."*

Consequência: a economia só acontece quando o projeto do assinador for **apagado**.
E apagar é irreversível — banco, storage, edge functions, logins, tudo. Não existe
"desliga e vê no que dá".

## 3. Caminho escolhido e o que foi descartado

### Escolhido: schema `assinatura` dentro do banco do Gestão

Um projeto, pastas separadas:

```
banco cmpgestao (ndeqlyrydcijbgjiviuw)
├── public/       ← o Gestão
├── assinatura/   ← o assinador (esta migração)
└── inove/        ← a perícia (obra separada, ver seção 8)
```

### Descartado: transferir o assinador para uma organização Free

Cabe folgado no Free (7 documentos, 43 arquivos, 6 logins, contra limites de 500 MB
de banco e 1 GB de storage) e economizaria os mesmos US$ 10 com ~1 hora de trabalho.

**Motivo da recusa:** projeto no plano Free **pausa sozinho após 7 dias sem uso**.
Assinatura de cliente é exatamente o caso em que o link fica parado uma semana e
depois alguém clica — quebraria. E o Free não tem backup automático.

Se um dia o assinador virar produto de uso diário, vale reconsiderar.

## 4. Inventário do que precisa mudar de casa

### 4.1 Tabelas — 11 no total

**Do assinador (4), migram para o schema `assinatura`:**

| Tabela | Linhas |
|---|---|
| `documentos` | 7 (mais recente: 03/08/2026) |
| `signatarios` | 9 |
| `eventos_auditoria` | 29 |
| `otp_codigos` | 0 |

**De igreja (7), são lixo — apagar, não migrar:**

`igreja_departamentos` (5), `igreja_formularios` (1), `igreja_links` (1),
`igreja_membros` (0), `igreja_membro_departamento` (0), `igreja_respostas` (0),
`igreja_eventos` (0).

> Djan confirmou em 04/08/2026 que nunca fez módulo de igreja. Descartar.
> A função `igreja_registrar_clique` cai junto.

### 4.2 Funções SQL — 17

```
admin_atualizar_email      admin_detalhe_documento    admin_excluir_documento
admin_listar_documentos    assinar_avulso             assinar_por_token
assinar_procuracao         atualiza_status_documento  avulso_por_token
confirmar_assinatura       doc_por_token              email_e_signatario
igreja_registrar_clique    is_admin                   is_dono_documento
marcar_visto               touch_atualizado_em
```

Todas precisam ser recriadas em `assinatura.*`, com `search_path` explícito.
`igreja_registrar_clique` não vai.

**Atenção em `is_admin()`** — ver seção 5.

### 4.3 Edge functions — 7

| Slug | Observação |
|---|---|
| `app` | slug genérico demais; renomear para `assinatura-app` |
| `enviar-email` | |
| `enviar-copia-assinada` | |
| `finalizar-documento` | |
| `ver-documento` | |
| `enviar-lembretes` | |
| `enviar-confirmacao` | |

Conferido: **nenhum colide** com as 5 já existentes no Gestão (`ler-lead`,
`inove-signup`, `extrair-partes`, `melhorias`, `publicar-melhorias`).

Todas com `verify_jwt: false` — confirmar que a autorização é por token na própria
função antes de replicar.

### 4.4 Storage — 3 buckets, 43 objetos

| Bucket | Público? |
|---|---|
| `app` | **sim** |
| `assinaturas` | não |
| `documentos` | não |

Buckets não moram em schema. Recriar no projeto do Gestão com nome prefixado
(`assinatura-app`, `assinatura-assinaturas`, `assinatura-documentos`) e copiar os 43
objetos. Replicar as policies de storage — o bucket `app` ser público é intencional.

### 4.5 Login (Auth) — 6 usuários

**Este é o ponto que exige decisão, não execução mecânica.**

Auth não mora em schema. Hoje o assinador tem o próprio `auth.users` com 6 contas, e
o `is_admin()` dele só conhece essas contas. Depois da migração existe **um diretório
de login só** — as 6 contas passam a existir dentro do Gestão.

Antes de migrar, responder:

1. Quem são as 6 contas? Alguma não deveria ter acesso ao Gestão?
2. `is_admin()` precisa ser reescrito contra `public.usuarios` do Gestão.
3. `SIGN_SERVICE_ACCOUNT_EMAIL` / `SIGN_SERVICE_ACCOUNT_SENHA` — hoje é uma conta de
   serviço que loga no projeto do assinador só para chamar as RPCs de admin. Depois
   da migração isso deixa de fazer sentido: as rotas internas passam a usar o JWT do
   próprio Gestão. Remover as duas variáveis.

## 5. Segurança — o que muda para pior e como cobrir

Hoje, um erro de política de acesso no assinador é **incapaz** de alcançar
`processos` — são bancos diferentes, ponto final. Depois da migração, passa a ser
possível.

Agrava o quadro: a chave publishable do Gestão já circula em página aberta
(`public/captar.html`), então naquele nível a única defesa é a política estar certa.

**Mitigação obrigatória, não opcional:** criar um role de banco dedicado
(`assinatura_app`) com

- `USAGE` + `ALL` no schema `assinatura`;
- **nenhum** privilégio em `public`;
- `REVOKE ALL ON SCHEMA public FROM assinatura_app`.

Assim um bug no assinador é barrado pelo Postgres, não pela disciplina de quem
escreveu o código.

## 6. Código do repositório que aponta para o projeto antigo

```
lib/supabaseAssinatura.js          ← SIGN_URL / SIGN_KEY com o ref antigo em fallback
app/api/assinatura/route.js
app/api/assinatura/sync/route.js
```

Páginas que consomem `signSb`:

```
app/assinar/page.jsx
app/assinar/confirmar/page.jsx
app/assinar-doc/page.jsx
app/assinatura/page.jsx
app/assinatura/avulso/page.jsx
app/assinatura/painel/page.jsx
```

Variáveis de ambiente envolvidas:

```
NEXT_PUBLIC_SIGN_SUPABASE_URL       → some (passa a ser a do Gestão)
NEXT_PUBLIC_SIGN_SUPABASE_ANON_KEY  → some
SIGN_SUPABASE_SERVICE_ROLE_KEY      → some
SIGN_SERVICE_ACCOUNT_EMAIL          → some
SIGN_SERVICE_ACCOUNT_SENHA          → some
EMAIL_CONFIRMACAO_ASSINATURA        → permanece
```

**Atenção:** `lib/supabaseAssinatura.js` tem o ref e a chave antigos **hardcoded como
fallback**. Não basta trocar a variável de ambiente — tem que trocar o literal, senão
em qualquer ambiente sem a env o código volta silenciosamente para o banco velho.

## 7. O risco de verdade: links já enviados a clientes

Dois pontos, em ordem de gravidade:

**a) O site antigo `djan.app.br/link/` quebra.** Ele fala direto com o projeto antigo.
Quando o projeto for apagado, ele para. Decidir antes: desligar o site antigo e
redirecionar para `/assinar`, ou repontá-lo para o banco novo.

**b) Links de assinatura em circulação.** O token vive na tabela `documentos`. Se a
migração preservar os mesmos IDs e tokens, os links servidos pelo Gestão
(`/assinar?d=…&s=…`) continuam válidos. Os servidos pelo site antigo dependem do
item (a).

Antes de apagar o projeto antigo, levantar quais documentos estão **pendentes de
assinatura** e avisar os signatários se houver risco de janela.

## 8. Ordem de execução

O passo 0 é decisão, não código. Não avance sem ele.

- [x] **0.** ~~Responder as 3 perguntas da seção 4.5~~ e ~~decidir o destino do site
      antigo~~ — **decidido em 04/08/2026, ver seção 10.**
- [~] **1.** Dump completo do projeto antigo (banco + os 43 objetos de storage +
      código das 7 edge functions) guardado fora da Supabase. É a única rede de
      segurança — não dá para despausar o que foi apagado.
      - [x] código das edge functions → `ops/backup-assinador/edge-functions/`
            (6 de 7; a `app` não é recuperável, ver seção 10)
      - [ ] banco + storage → rodar `ops/backup-assinador.sh` no VPS.
            Roteiro em `ops/COMO-BACKUP-ASSINADOR.md`.
- [ ] **2.** Criar schema `assinatura` e o role `assinatura_app` no banco do Gestão.
- [ ] **3.** Migrar as 4 tabelas com os **mesmos IDs e tokens**. Não migrar igreja.
- [ ] **4.** Recriar as 16 funções (17 menos `igreja_registrar_clique`) e as RLS.
      Reescrever `is_admin()` conforme decidido no passo 0.
- [ ] **5.** Criar os 3 buckets prefixados, copiar os 43 objetos, replicar policies.
- [ ] **6.** Deployar as 7 edge functions (`app` → `assinatura-app`).
- [ ] **7.** Repontar o código (seção 6) — **incluindo o literal hardcoded**.
- [ ] **8.** Testar de ponta a ponta, com o projeto antigo **ainda vivo**: gerar
      procuração, assinar pelo link, confirmar por e-mail, avulso com múltiplos
      signatários, painel, download do PDF assinado.
- [ ] **9.** Resolver o site antigo (seção 7a).
- [ ] **10.** Rodar em produção por ~1 semana com os dois de pé.
- [ ] **11.** Só então apagar o projeto antigo. **Irreversível.**
- [ ] **12.** Confirmar na fatura seguinte que caiu para US$ 25.

## 9. O que NÃO fazer junto

Não misturar esta migração com a obra da Inove (schema `inove`, portal do perito,
documentos do jus.br com tarja).

São independentes, e juntar as duas significa mexer em coisa que já funciona —
assinatura de cliente — no mesmo momento em que se estreia coisa nova. É assim que
se fabrica o bug difícil de achar.

**Ordem recomendada:** Inove primeiro (schema novo, não toca em nada existente),
assinador depois.

## 10. Decisões do passo 0 e correções ao inventário (04/08/2026)

### 10.1 As quatro decisões

1. **Os 6 logins do assinador não migram.** Nenhum dado aponta para eles
   (`documentos.criado_por` está NULL nas 7 linhas) e o `is_admin()` antigo só
   reconhecia 2 dos 6 e-mails. Quem precisar do módulo entra pelo login do
   Gestão. Jaline ainda não tem login no Gestão e vai criar depois; novas
   pessoas entram do mesmo jeito.
2. **`is_admin()` passa a ser "existe em `public.usuarios`"** — não uma lista de
   e-mails. Isso já é o comportamento efetivo de hoje (a API interna valida a
   sessão do Gestão e opera com a chave secreta, então a lista antiga não
   restringia nada) e resolve sozinho a entrada de gente nova.
3. **A conta de serviço sai.** Remover `SIGN_SERVICE_ACCOUNT_EMAIL` e
   `SIGN_SERVICE_ACCOUNT_SENHA` **e** a linha `sign_service_account` da tabela
   `app_secrets` do Gestão — o plano original só mencionava as duas variáveis,
   mas `credenciaisServico()` em `app/api/assinatura/route.js` cai nesse segundo
   lugar quando as variáveis faltam.
4. **Site antigo `djan.app.br/link/`: redirect 301** para `/assinar` e
   `/assinar-doc`, preservando `d=` e `s=`. Inclui trocar o link fixo dentro da
   edge function `enviar-lembretes`.

### 10.2 Correções ao inventário

- **A edge function `app` não é recuperável.** A API responde
  `Failed to retrieve function bundle`. É a única sem `entrypoint_path` e sem
  `ezbr_sha256` na listagem — deploy de 02/07/2026 em formato que o painel já não
  serve. Nada no CMPGestão a chama; o bucket público `app` guarda
  `assinar.html`, `config.js` e `painel.html`, então ela provavelmente servia as
  telas do site antigo. **Decidido: não migrar.** O passo 6 passa a ser
  "deployar 6 edge functions", não 7.
- **Os secrets das edge functions não estão em backup nenhum** e a Supabase não
  deixa relê-los. `CMP_EMAIL_PASS` é o crítico (não tem padrão no código; sem
  ela nenhum e-mail sai). Confirmar antes do passo 11.
- **Existe uma 8ª tabela de igreja**, `igreja_inscricoes`, que a seção 4.1 não
  listou. Lixo igual às outras 7.
- **`documentos.criado_por` tem FK para `auth.users(id)`** com
  `ON DELETE SET NULL`. Os valores são todos NULL, então não bloqueia a
  migração — mas a FK tem de ser recriada apontando para o `auth.users` do
  Gestão, não copiada às cegas.
- **`is_admin()` não tem `search_path` nem é `SECURITY DEFINER`** (só `STABLE`).
  Ao reescrever no passo 4, definir `search_path` explícito.
- **Buraco de segurança que NÃO deve ser replicado no passo 5:** as policies de
  storage do projeto antigo deixam `anon` inserir e atualizar objetos em
  `documentos` e `assinaturas` sem checar dono (`documentos_insert_anon`,
  `assinatura_insert_anon`, e `arquivos_update` incluindo `anon`). Hoje isso está
  num banco isolado; replicado no banco do Gestão, vira porta aberta ao lado dos
  processos. Fechar ao recriar, não copiar.
