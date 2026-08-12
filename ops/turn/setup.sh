#!/usr/bin/env bash
# TURN próprio do escritório (coturn) — retransmissão das chamadas de vídeo/voz
# quando a rede bloqueia a ligação direta entre os dois aparelhos.
#
# Rodar UMA vez no VPS, como root:
#   bash ops/turn/setup.sh
#
# O sistema já está configurado para usar turn:gestao.cmpadvogados.com.br:3478
# com as credenciais abaixo — assim que este script terminar, as chamadas passam
# a usar o VPS como relay (a mídia continua cifrada de ponta a ponta; o relay só
# encaminha pacotes que não consegue ler).
set -euo pipefail

USUARIO="cmp"
SENHA="e933e7efb6e977b645ba39a5dc6be4a2d5213f7fc30e596a"
DOMINIO="gestao.cmpadvogados.com.br"

apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq coturn

IP_PUB=$(curl -s https://api.ipify.org || true)

cat > /etc/turnserver.conf << CONF
# coturn do CMPGestão — só relay de chamadas, sem admin web
listening-port=3478
fingerprint
lt-cred-mech
user=${USUARIO}:${SENHA}
realm=${DOMINIO}
# faixa de portas do relay (abrir no firewall junto com 3478 udp/tcp)
min-port=49160
max-port=49300
$( [ -n "$IP_PUB" ] && echo "external-ip=$IP_PUB" )
no-cli
no-tlsv1
no-tlsv1_1
# sem loopback/anônimo: só quem tem a credencial usa o relay
no-loopback-peers
no-multicast-peers
CONF

# habilita o serviço (o pacote vem desativado por padrão)
sed -i 's/^#*TURNSERVER_ENABLED=.*/TURNSERVER_ENABLED=1/' /etc/default/coturn 2>/dev/null || echo 'TURNSERVER_ENABLED=1' > /etc/default/coturn

# firewall: ufw se existir; senão, confie no provedor (abrir 3478 tcp/udp e 49160-49300 udp no painel)
if command -v ufw >/dev/null 2>&1; then
  ufw allow 3478/tcp || true
  ufw allow 3478/udp || true
  ufw allow 49160:49300/udp || true
fi

systemctl enable coturn
systemctl restart coturn
sleep 1
systemctl --no-pager status coturn | head -5
echo
echo "✓ TURN no ar em ${DOMINIO}:3478 (usuário ${USUARIO})."
echo "  Se o VPS tiver firewall no PAINEL do provedor, abra também lá: 3478 tcp/udp e 49160–49300 udp."
