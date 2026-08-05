# Backup automático do CMP Gestão (banco Supabase) no VPS Hostinger

Objetivo: um backup **diário** do banco, com **pontos de restauração** datados
(30 dias), guardado no VPS e copiado para o **Google Drive**
(pasta `Sistema/backups`) — zero custo extra, usa o armazenamento que a conta
já tem.

> O que é copiado é o **banco de dados** (processos, andamentos, contatos,
> agenda, kanban e logins). O código do sistema já tem backup no GitHub.

---

## Passo 1 — Instalar as ferramentas no VPS (uma vez)

Conecte no VPS por SSH e rode (Ubuntu/Debian):

```bash
# Cliente do PostgreSQL 17 (mesma versão do Supabase)
sudo apt-get update
sudo apt-get install -y postgresql-common curl
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
sudo apt-get install -y postgresql-client-17

# rclone (para enviar ao Google Drive)
sudo -v ; curl https://rclone.org/install.sh | sudo bash

# confere as versões
pg_dump --version     # deve mostrar 17.x
rclone version
```

## Passo 2 — Guardar a string de conexão do banco (segredo)

1. No painel do **Supabase** → seu projeto **cmpgestao** → **Project Settings**
   → **Database** → **Connection string** → aba **URI**.
   - Copie a URI. Ela tem o formato:
     `postgresql://postgres:[SUA-SENHA]@db.ndeqlyrydcijbgjiviuw.supabase.co:5432/postgres`
   - Se o VPS não tiver IPv6, use a opção **"Session pooler"** (também mostrada
     ali) — funciona por IPv4.
2. Substitua `[SUA-SENHA]` pela senha real do banco.
3. No VPS, crie o arquivo protegido:

```bash
mkdir -p ~/.config/cmp-backup
nano ~/.config/cmp-backup/db.env
```

Coloque **uma linha** (com a sua URI real) e salve:

```
SUPABASE_DB_URL=postgresql://postgres:SENHA_AQUI@db.ndeqlyrydcijbgjiviuw.supabase.co:5432/postgres
```

Proteja o arquivo (só você lê):

```bash
chmod 600 ~/.config/cmp-backup/db.env
```

> A senha fica **só** nesse arquivo do VPS, nunca dentro do script nem no GitHub.

## Passo 3 — Instalar os scripts

Copie o `backup-supabase.sh` (banco) e o `backup-cmpdocs.sh` (arquivos em
`/opt/cmpdocs` — petições, autos do jus.br etc.) para o VPS (ex.: na sua home)
e torne ambos executáveis:

```bash
chmod +x ~/backup-supabase.sh ~/backup-cmpdocs.sh
```

## Passo 4 — Configurar o Google Drive no rclone (uma vez)

O Google Drive usa login Google (abre o navegador). Como o VPS não tem
navegador, faça a autorização **no seu PC**:

1. No **seu PC**, instale o rclone e rode:
   `rclone authorize "drive"`
   → abre o navegador, você faz login com a conta Google do escritório e ele
   devolve um **token** (um texto JSON).
2. **No VPS**, rode `rclone config` e responda:
   - `n` (novo remote) → nome: **gdrive**
   - tipo: **drive** (Google Drive)
   - client_id / client_secret: deixe em branco (Enter) — usa o app padrão do rclone
   - scope: **1** (acesso completo de leitura/escrita ao próprio Drive)
   - root_folder_id: deixe em branco (Enter)
   - quando perguntar "Use auto config?": responda **n** e **cole o token** do PC
   - "Configure this as a Shared Drive?": **n**, a menos que vocês usem um Drive
     compartilhado do Google Workspace — nesse caso responda **y** e escolha-o
3. Teste:
   ```bash
   rclone lsd gdrive:
   ```
   Deve listar as pastas do Google Drive. A pasta de destino
   (`Sistema/backups`) é criada sozinha no primeiro envio.

> Já tem backup configurado no OneDrive e quer manter os dois? Repita o
> Passo 4 com `rclone authorize "onedrive"` / tipo **onedrive** / remote
> **onedrive**, e ajuste `RCLONE_REMOTE` nos dois scripts (ou rode duas vezes,
> uma para cada remote) — sem custo adicional, é só mais um destino de cópia.

## Passo 5 — Primeira execução (seu 1º ponto de restauração hoje)

```bash
~/backup-supabase.sh
~/backup-cmpdocs.sh
```

O primeiro deve terminar com "Backup concluído com sucesso". Confira:

```bash
ls -lh ~/cmp-backups/
```

O segundo (`backup-cmpdocs.sh`) pode demorar bastante na primeira vez — está
enviando TODOS os documentos já existentes em `/opt/cmpdocs` para o Google
Drive. Da segunda vez em diante só envia o que for novo ou tiver mudado,
então fica rápido.

## Passo 6 — Agendar todo dia às 03:00 (cron)

```bash
crontab -e
```

Adicione as duas linhas (ajuste o caminho se não for a home):

```
0 3 * * * /home/SEU_USUARIO/backup-supabase.sh >> /home/SEU_USUARIO/cmp-backups/backup.log 2>&1
15 3 * * * /home/SEU_USUARIO/backup-cmpdocs.sh >> /home/SEU_USUARIO/cmp-backups/backup-docs.log 2>&1
```

(O segundo horário é 15 minutos depois só para não competir com o dump do
banco pela mesma janela de rede/disco.)

Pronto: todo dia às 3h gera um novo ponto de restauração do banco, e às 3h15
sincroniza os documentos do disco (`/opt/cmpdocs`) com o Google Drive. O banco
mantém 30 dias de pontos de restauração; os documentos ficam espelhados
(sem limite de retenção — é uma cópia viva, não pontos no tempo). Logs em
`~/cmp-backups/backup.log` e `~/cmp-backups/backup-docs.log`.

> **Não apague o crontab sem olhar `ops/crontab-cmp.txt` primeiro** — esse
> arquivo (versionado no GitHub) é o espelho de que linhas devem estar
> agendadas. Se `crontab -e` for mexido sem querer, é para lá que se volta.

---

## Como RESTAURAR (voltar a um ponto no tempo)

Escolha o arquivo do dia desejado (ex.: `cmpgestao_2026-07-09_0300.dump`) e:

```bash
# restaura TUDO por cima do banco atual (substitui os dados existentes)
pg_restore --clean --if-exists --no-owner --no-privileges \
  -d "$SUPABASE_DB_URL" ~/cmp-backups/cmpgestao_2026-07-09_0300.dump
```

Restaurar **só uma tabela** (ex.: recuperar andamentos sem mexer no resto):

```bash
pg_restore --data-only --no-owner -t andamentos \
  -d "$SUPABASE_DB_URL" ~/cmp-backups/cmpgestao_2026-07-09_0300.dump
```

> Dica: antes de uma restauração grande, gere um backup na hora
> (`~/backup-supabase.sh`) para ter como voltar caso algo dê errado.

---

## Resumo da proteção depois de configurado

| Camada | Onde | Frequência | Retenção |
|---|---|---|---|
| Código | GitHub | a cada alteração | histórico completo |
| Agendamentos (cron) | GitHub (`ops/crontab-cmp.txt`) | a cada mudança | histórico completo |
| Banco (VPS) | `~/cmp-backups/` | diário 03:00 | 30 dias |
| Banco (nuvem) | Google Drive `Sistema/backups` | diário 03:00 | 30 dias + histórico do Drive |
| Documentos (VPS) | `/opt/cmpdocs` | ao vivo | — (é o original) |
| Documentos (nuvem) | Google Drive `Sistema/backups/cmpdocs` | diário 03:15 | espelho contínuo |

---

## Estado real nesta VPS — apurado em 05/08/2026

**O backup diário nunca rodou nesta máquina.** Não foi o cron que falhou: ele nunca
chegou a ser criado. Levantamento item a item:

| Item | Estado |
|---|---|
| `pg_dump` | ✅ instalado, 17.10 (bate com o Passo 1) |
| `rclone` | ✅ instalado em 05/08/2026 (`apt install rclone`, v1.60.1) |
| `~/cmp-backups/` | ✅ criada em 05/08/2026 (estava faltando) |
| `~/.config/cmp-backup/` | ✅ existe — criada em **09/07/2026**, vazia desde então |
| `~/.config/cmp-backup/db.env` | ❌ **não existe** — é o bloqueio |
| Remote `gdrive` no rclone | ❌ não configurado (Passo 4 exige navegador) |
| Linhas de cron do backup | ❌ **ausentes** do `crontab -l` do root |

A pasta de config datada de 09/07 mostra que o Passo 2 foi começado naquele dia e
parou antes de gravar a credencial. Daí em diante nada mais foi feito.

### O que trava, exatamente

`backup-supabase.sh` precisa de `SUPABASE_DB_URL` com credencial que leia o schema
`public`. **Não existe nenhuma nesta máquina** — procurado em `.env.local`,
`.env.local.save`, `~/.pgpass` e outras homes. O que há é:

- `INOVE_DB_URL` → role `inove_app`, que **por construção não enxerga o `public`**
  (ver `ops/PROJETO-INOVE.md`, seção 4). Um `pg_dump` com ela geraria um arquivo que
  *parece* backup e não tem o Gestão dentro. **Não usar.**
- `SUPABASE_SERVICE_ROLE_KEY` → chave da API REST, **não** é senha de Postgres.
  O `pg_dump` não aceita.

### Para destravar (duas coisas, independentes)

1. **A credencial do banco** — sem ela não há dump nenhum. Pegue em Supabase →
   Project Settings → Database → Connection string → **URI**, aba **Session pooler**
   (porta 5432, IPv4). Na VPS:

   ```bash
   printf 'SUPABASE_DB_URL=postgresql://...\n' > ~/.config/cmp-backup/db.env
   chmod 600 ~/.config/cmp-backup/db.env
   /opt/cmpgestao/ops/backup-supabase.sh      # 1ª execução, valida o dump
   ```

   Alternativa, se preferir não pôr a senha do superusuário no disco: criar um role
   dedicado só de leitura (`pg_read_all_data`) e usar a senha dele.

2. **O Google Drive** — só afeta a *cópia na nuvem*; o dump local funciona sem isso
   (o script avisa e segue). Exige `rclone authorize "drive"` **no seu PC**, porque a
   VPS não tem navegador, e colar o token em `rclone config` aqui (Passo 4).

> **O cron só deve ser criado depois da 1ª execução dar certo.** Agendar antes gera
> uma falha silenciosa por dia e dá a impressão de que existe backup quando não
> existe — que é exatamente o buraco que o incidente de 02/08 expôs.

> **Atenção ao volume:** a primeira execução do `backup-cmpdocs.sh` sobe os **18 GB**
> hoje em `/opt/cmpdocs` para o Drive. Conte com a banda e com o espaço na conta.
