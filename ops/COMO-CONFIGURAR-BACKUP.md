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
