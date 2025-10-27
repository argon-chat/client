#!/bin/sh
set -x

wget -O /tmp/vault_response.json \
  --header="X-Vault-Token: $VAULT_TOKEN" \
  "$VAULT_ADDR/v1/x-frontend-development/data/certificates"

jq -r .data.data.public /tmp/vault_response.json > /tmp/cert.pem
jq -r .data.data.private /tmp/vault_response.json > /tmp/key.pem

ls -lh /tmp/cert.pem /tmp/key.pem

PORT=${PORT:-443}
exec busybox httpd -f -v -p "$PORT" -r -c /tmp/cert.pem,/tmp/key.pem
