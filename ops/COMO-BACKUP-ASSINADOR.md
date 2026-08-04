# Passo 1 da migração — backup completo do projeto do assinador

Este é o **passo 1** de `ops/MIGRACAO-ASSINADOR.md`, e é o único que não dá para
refazer depois. O passo 11 apaga o projeto `fjboytucivmdykkfpdhs`, e projeto
apagado não volta — no plano Pro não existe nem pausar, muito menos despausar.
Enquanto este backup não estiver conferido, **não avance para o passo 2**.

Roda **no VPS**, não aqui na sessão do Claude. Duas razões:

1. O container da sessão é temporário e é apagado quando ela encerra. O passo 11
   é a semanas de distância — um arquivo gerado aqui não existiria mais.
2. Rodando no VPS, a senha do banco e a `service_role` key ficam num arquivo
   `chmod 600` da sua máquina e **não passam pelo chat** nem ficam gravadas no
   histórico da conversa.

O script **não manda nada para a nuvem**, de propósito: o dump tem nome, e-mail,
CPF e telefone de cliente, e os arquivos são procurações assinadas de processos
de terceiros. Fica só no VPS.

---

## Passo 1.1 — Conferir o cliente do PostgreSQL

O banco do assinador é **PostgreSQL 17.6**. Cliente 16 ou anterior recusa o dump.

```bash
pg_dump --version     # tem que mostrar 17.x
```

Se mostrar menos que 17, instale o client 17 — é o mesmo procedimento do
`ops/COMO-CONFIGURAR-BACKUP.md`, Passo 1:

```bash
sudo apt-get update
sudo apt-get install -y postgresql-common curl
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
sudo apt-get install -y postgresql-client-17
```

## Passo 1.2 — Pegar a connection string do banco antigo

No painel da Supabase, **atenção ao projeto**: é o do assinador
(`fjboytucivmdykkfpdhs`), não o do Gestão.

1. Supabase → projeto **do assinador** → botão **Connect** (topo da página).
2. Aba **URI**. Copie. O formato é:
   `postgresql://postgres:[SUA-SENHA]@db.fjboytucivmdykkfpdhs.supabase.co:5432/postgres`
3. Troque `[SUA-SENHA]` pela senha real do banco.
   - Não lembra a senha? Project Settings → Database → **Reset database password**.
     Trocar a senha aqui não afeta o site nem o Gestão — quem usa o banco no
     dia a dia são as chaves de API, não a senha do Postgres.
   - Se o VPS não tiver IPv6, use a opção **Session pooler** que aparece na
     mesma tela (é IPv4). Serve igual para o `pg_dump`.

## Passo 1.3 — Pegar a service_role key do banco antigo

É o que permite baixar os 40 arquivos dos buckets privados (`documentos` e
`assinaturas`). Sem ela, só o bucket `app` baixaria.

- Supabase → projeto **do assinador** → **Project Settings** → **API keys** →
  **service_role** → revelar e copiar.
- É a mesma chave que já está na Vercel como `SIGN_SUPABASE_SERVICE_ROLE_KEY`,
  se for mais fácil pegar de lá.

> Essa chave ignora RLS por completo. Ela vai para um arquivo `chmod 600` do VPS
> e não deve ser colada em chat, commit, ou e-mail.

## Passo 1.4 — Guardar os dois segredos no VPS

```bash
mkdir -p ~/.config/cmp-backup
nano ~/.config/cmp-backup/assinador.env
```

Três linhas, com os valores reais:

```
SIGN_DB_URL=postgresql://postgres:SENHA_AQUI@db.fjboytucivmdykkfpdhs.supabase.co:5432/postgres
SIGN_SERVICE_ROLE_KEY=eyJ...
SIGN_PROJECT_REF=fjboytucivmdykkfpdhs
```

Proteja:

```bash
chmod 600 ~/.config/cmp-backup/assinador.env
```

> É um arquivo **separado** do `db.env` que o backup diário do Gestão usa. Os
> dois projetos são bancos diferentes e cada um tem a sua senha.

## Passo 1.5 — Instalar e rodar o script

Copie o `ops/backup-assinador.sh` deste repositório para o VPS (ex.: na home):

```bash
chmod +x ~/backup-assinador.sh
~/backup-assinador.sh
```

Deve terminar com:

```
Backup completo e conferido. Pode seguir para o passo 2 da migração.
```

## Passo 1.6 — Conferir antes de confiar

```bash
ls -lh ~/cmp-backups/assinador/*/
cat ~/cmp-backups/assinador/*/MANIFEST.txt
```

O `MANIFEST.txt` tem que mostrar, no retrato de 04/08/2026:

| Item | Esperado |
|---|---|
| objetos baixados | **43** (19 `documentos` + 21 `assinaturas` + 3 `app`) |
| falhas | **0** |
| `documentos` | 7 linhas |
| `signatarios` | 9 linhas |
| `eventos_auditoria` | 29 linhas |
| `otp_codigos` | 0 linhas |

Se documentos novos foram assinados desde então, os números sobem — é normal.
O que **não** pode é `falhas` diferente de zero. O script sai com erro nesse
caso, justamente para não deixar passar.

Teste também que o dump abre (não restaura nada, só lê o índice):

```bash
pg_restore --list ~/cmp-backups/assinador/*/dump.custom | head -30
```

Se listar as tabelas e funções, o dump está íntegro.

---

## Como restaurar, se precisar

Cenário real: a migração deu errado depois do passo 11 e o projeto antigo já não
existe. O dump não recria o projeto — ele recria os **dados** dentro de outro
banco. Então:

```bash
# 1. Crie um projeto Supabase novo (ou use um schema separado no do Gestão)
# 2. Restaure por cima:
pg_restore --clean --if-exists --no-owner --no-privileges \
  -d "postgresql://postgres:SENHA@db.NOVOREF.supabase.co:5432/postgres" \
  ~/cmp-backups/assinador/2026-08-04_1530/dump.custom
```

Os arquivos de storage voltam pelo upload da pasta `storage/` (a estrutura é
`storage/<bucket>/<nome>`), e as edge functions pelo código versionado em
`ops/backup-assinador/edge-functions/` neste repositório.

> O que o dump **não** carrega: os 6 logins do `auth.users` do projeto antigo.
> Isso é intencional — a decisão do passo 0 foi não migrar nenhum deles.

---

## O que este backup cobre, e o que não

| Parte | Onde fica | Quem faz |
|---|---|---|
| Banco (restaurável) | `~/cmp-backups/assinador/<data>/dump.custom` | script, no VPS |
| Banco (SQL legível) | `~/cmp-backups/assinador/<data>/schema.sql` | script, no VPS |
| 43 arquivos de storage | `~/cmp-backups/assinador/<data>/storage/` | script, no VPS |
| Config dos buckets | `~/cmp-backups/assinador/<data>/buckets.tsv` | script, no VPS |
| Código das 7 edge functions | `ops/backup-assinador/edge-functions/` (GitHub) | Claude, na sessão |

As edge functions vão para o **repositório** em vez do VPS porque são código —
não têm dado de cliente, servem de fonte para o passo 6, e o GitHub já é o
backup do código.

**Secrets das edge functions não estão em backup nenhum** e não dá para lê-los
pelo painel depois de salvos. Antes do passo 11, confirme que você tem os
valores de `SMTP_HOSTNAME`, `SMTP_PORT`, `SMTP_USERNAME`, `CMP_EMAIL_PASS` e
`OFFICE_EMAIL` — eles precisam ser recriados no projeto do Gestão no passo 6,
senão as funções sobem e falham no envio de e-mail.
