#!/bin/bash
# 生成 HTTPS 测试证书（自签 CA + 服务端 + 客户端）
# 用法: bash test/https/generate-certs.sh

set -euo pipefail

CERTS_DIR="$(cd "$(dirname "$0")/certs" && pwd)"
mkdir -p "$CERTS_DIR"
cd "$CERTS_DIR"

echo "=== 生成 CA 根证书 ==="

# CA 私钥
openssl genrsa -out ca.key 2048 2>/dev/null

# CA 证书（10 年有效期）
openssl req -new -x509 -days 3650 -key ca.key -out ca.crt \
  -subj "/C=CN/ST=Test/O=AutoTest/CN=AutoTest-CA" 2>/dev/null

echo "=== 生成服务端证书 ==="

# 服务端私钥
openssl genrsa -out server.key 2048 2>/dev/null

# 服务端 CSR（带 SAN）
cat > server.cnf <<EOF
[req]
distinguished_name = req_dn
req_extensions = v3_req
prompt = no

[req_dn]
C = CN
ST = Test
O = AutoTest
CN = localhost

[v3_req]
subjectAltName = @alt_names

[alt_names]
DNS.1 = localhost
IP.1 = 127.0.0.1
EOF

openssl req -new -key server.key -out server.csr -config server.cnf 2>/dev/null

# CA 签发服务端证书（3 年有效期）
openssl x509 -req -days 1095 -in server.csr -CA ca.crt -CAkey ca.key \
  -CAcreateserial -out server.crt -extensions v3_req -extfile server.cnf 2>/dev/null

echo "=== 生成客户端证书 ==="

# 客户端私钥
openssl genrsa -out client.key 2048 2>/dev/null

# 客户端 CSR
openssl req -new -key client.key -out client.csr \
  -subj "/C=CN/ST=Test/O=AutoTest/CN=test-client" 2>/dev/null

# CA 签发客户端证书（3 年有效期）
openssl x509 -req -days 1095 -in client.csr -CA ca.crt -CAkey ca.key \
  -CAcreateserial -out client.crt 2>/dev/null

# 清理临时文件
rm -f server.csr client.csr server.cnf ca.srl

echo "=== 证书生成完成 ==="
echo "CA 证书:     $CERTS_DIR/ca.crt"
echo "服务端证书:  $CERTS_DIR/server.crt"
echo "服务端私钥:  $CERTS_DIR/server.key"
echo "客户端证书:  $CERTS_DIR/client.crt"
echo "客户端私钥:  $CERTS_DIR/client.key"
