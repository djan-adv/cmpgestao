# Vercel — por que está desligada

O CMPGestão roda no **VPS do escritório** (gestao.cmpadvogados.com.br). O botão
"↑ Publicar" faz `git reset --hard origin/main` lá e, quando a mudança sai de
`public/`, recompila e reinicia o serviço. É esse o caminho de produção.

A Vercel é resto de uma configuração antiga: o repositório continuou ligado a um
projeto lá, então **cada push disparava um build** — e falhava, mandando
"Production deployment failed" por e-mail (relatado em 03/09/2026, quatro
e-mails em meia hora).

A falha não é um defeito do sistema: duas rotas de IA declaram tempo máximo
acima do teto da Vercel — `ia/diagnostico` pede 900s (lê a íntegra dos autos
inteira) e `peticao` pede 600s; a Vercel recusa acima de 300s. No VPS não há
esse teto. Baixar os tempos para caber num serviço que não usamos seria quebrar
o diagnóstico para agradar a plataforma errada.

Por isso o `vercel.json` deste repositório desliga o deploy automático do `main`
(`git.deploymentEnabled`). Os dois crons do DJEN que viviam ali também saíram:
o agendador interno (`/api/cron/tick`) já roda o DJEN de 2 em 2 horas, então
eram duplicata.

Se ainda assim chegar e-mail de falha, o desligamento definitivo é no painel:
vercel.com → projeto `cmpgestao` → Settings → Git → **Disconnect** (ou apagar o
projeto). Nada do escritório depende dele.
