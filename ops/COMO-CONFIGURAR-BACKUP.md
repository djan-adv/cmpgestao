# Backup automático do CMP Gestão (banco Supabase) no VPS Hostinger

Objetivo: um backup **diário** do banco, com **pontos de restauração** datados
(30 dias), guardado no VPS e copiado para o **OneDrive**
(`OneDrive - C.M.P. ADVs\Sistema\backups`).

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

# rclone (para enviar ao OneDrive)
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

## Passo 3 — Instalar o script

Copie o `backup-supabase.sh` para o VPS (ex.: na sua home) e torne executável:

```bash
chmod +x ~/backup-supabase.sh
```

## Passo 4 — Configurar o OneDrive no rclone (uma vez)

O OneDrive da empresa usa login Microsoft (abre o navegador). Como o VPS não tem
navegador, faça a autorização **no seu PC**:

1. No **seu PC** (Windows), instale o rclone e rode:
   `rclone authorize "onedrive"`
   → abre o navegador, você faz login e ele devolve um **token** (um texto JSON).
2. **No VPS**, rode `rclone config` e responda:
   - `n` (novo remote) → nome: **onedrive**
   - tipo: **onedrive** (Microsoft OneDrive)
   - client_id / secret: deixe em branco (Enter)
   - quando perguntar "Use auto config?": responda **n** e **cole o token** do PC
   - escolha o drive **OneDrive for Business** de **C.M.P. ADVs**
3. Teste:
   ```bash
   rclone lsd onedrive:
   ```
   Deve listar as pastas do OneDrive. A pasta de destino
   (`Sistema/backups`) é criada sozinha no primeiro envio.

## Passo 5 — Primeira execução (seu 1º ponto de restauração hoje)

```bash
~/backup-supabase.sh
```

Deve terminar com "Backup concluído com sucesso". Confira:

```bash
ls -lh ~/cmp-backups/
```

## Passo 6 — Agendar todo dia às 03:00 (cron)

```bash
crontab -e
```

Adicione a linha (ajuste o caminho se não for a home):

```
0 3 * * * /home/SEU_USUARIO/backup-supabase.sh >> /home/SEU_USUARIO/cmp-backups/backup.log 2>&1
```

Pronto: todo dia às 3h gera um novo ponto de restauração, mantém 30 dias e
manda a cópia para o OneDrive. O log fica em `~/cmp-backups/backup.log`.

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
| Banco (VPS) | `~/cmp-backups/` | diário 03:00 | 30 dias |
| Banco (nuvem) | OneDrive `Sistema/backups` | diário 03:00 | 30 dias + histórico do OneDrive |
