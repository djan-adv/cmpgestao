# Incidente 02/08/2026 — banco do CMPGestão fora do ar (disco cheio)

Projeto Supabase afetado: `ndeqlyrydcijbgjiviuw` (cmpgestao, região sa-east-1).
O projeto `fjboytucivmdykkfpdhs` (assinador/djan-adv) **não** foi afetado.

## Sintoma

Toda conexão ao banco devolve:

```
FATAL: 57P03: the database system is not accepting connections
DETAIL: Hot standby mode is disabled.
```

A API de gerenciamento da Supabase segue reportando o projeto como
`ACTIVE_HEALTHY` — o status do painel **não** reflete o estado real do Postgres.

## Causa raiz (confirmada nos logs do Postgres)

```
LOG   database system was interrupted while in recovery at 2026-08-02 10:53:35 UTC
LOG   database system was not properly shut down; automatic recovery in progress
LOG   redo starts at 25/1D06C818
LOG   redo done at 25/34FFF958
FATAL could not write to file "pg_wal/xlogtemp.8002": No space left on device
LOG   startup process (PID 8002) exited with exit code 1
LOG   shutting down due to startup process failure
LOG   database system is shut down
```

**Disco cheio.** O ciclo se repete a cada ~25 segundos:

1. O Postgres inicia e detecta desligamento sujo;
2. roda o redo do WAL até o fim;
3. precisa gravar em `pg_wal/` para concluir a recuperação;
4. não há espaço → `FATAL` → o startup process morre → o servidor desliga;
5. o supervisor reinicia e tudo recomeça.

Ou seja: não é falha de infraestrutura da Supabase nem corrupção de dados. É
falta de espaço em disco, e a própria recuperação não consegue terminar porque
precisa escrever justamente onde não cabe mais nada.

## Solução

O tamanho do disco é amarrado ao plano da organização. No plano **Free** o disco
é fixo e não pode ser expandido pelo painel — por isso o loop não se resolve
sozinho e não há o que fazer pelo lado do cliente.

Passos:

1. Upgrade da organização (`djan-adv's Org`) para o plano **Pro**;
2. Project Settings → Database → aumentar o **Disk size** (planos pagos também
   ganham autoscaling de disco);
3. com espaço, o redo termina, o WAL é gravado e o Postgres sobe;
4. se não subir em alguns minutos, abrir ticket em https://supabase.help — no
   Pro o atendimento tem SLA, no Free não.

Depois de voltar: rodar `VACUUM` nas tabelas maiores e verificar o que consumiu
o disco (WAL acumulado x dados x logs) antes de considerar o caso encerrado.

## Estado das cópias de segurança na hora do incidente

| Camada | Situação |
|---|---|
| Código | **Seguro** — GitHub, histórico completo |
| Schema (tabelas, RLS, funções, triggers) | **Sem cópia no repositório** — não existe pasta `supabase/` nem nenhum arquivo `.sql`; a estrutura vive só no banco |
| Dados | Depende do dump diário do VPS/OneDrive (`ops/backup-supabase.sh`) — **não verificado** |
| Storage (PDFs, documentos) | **Sem cópia** — o `pg_dump` salva tabelas, não os arquivos dos buckets |
| Backup da Supabase | Indisponível: no plano Free não há restore pelo painel |

## Lições / pendências depois que voltar

- [ ] Versionar o schema no repositório (migrations), para deixar de depender do
      banco vivo como única fonte da estrutura.
- [ ] Incluir os buckets do Storage na rotina de backup — hoje ficam de fora.
- [ ] Conferir se o cron do `backup-supabase.sh` está mesmo rodando no VPS
      (`ls -lh ~/cmp-backups/` e `tail ~/cmp-backups/backup.log`); ter o script
      no repositório não prova que foi instalado.
- [ ] Monitorar o uso de disco do projeto e alertar antes de encher.
