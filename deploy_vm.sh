#!/bin/bash
# Deploy AI Log Analyzer to VM at 192.168.31.12
set -e

echo "=== Clone repo ==="
cd ~
rm -rf ai-log-analyzer
git clone https://github.com/h19980816/ai-log-analyzer.git
cd ai-log-analyzer

echo "=== Fix Grafana port ==="
sed -i 's/3001:3000/3002:3000/g' docker-compose.yml

echo "=== Create .env ==="
cat > .env << 'EOF'
AI_BASE_URL=http://host.docker.internal:11434/v1
AI_API_KEY=ollama
AI_MODEL=qwen2.5
EOF

echo "=== Start services ==="
sudo docker compose up -d --build

echo "=== Status ==="
sudo docker compose ps
echo ""
echo "Done! Access at:"
echo "  Frontend:  http://192.168.31.12:8080"
echo "  Backend:   http://192.168.31.12:8000"
echo "  Grafana:   http://192.168.31.12:3002"
echo "  Prometheus: http://192.168.31.12:9090"
