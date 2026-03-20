#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

echo "=== Optio Local Setup ==="
echo ""

# Check prerequisites
command -v kubectl >/dev/null 2>&1 || { echo "❌ kubectl is required. Enable Kubernetes in Docker Desktop."; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "❌ pnpm is required. Install with: npm install -g pnpm"; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "❌ docker is required. Install Docker Desktop."; exit 1; }

# Check cluster connectivity
if ! kubectl cluster-info >/dev/null 2>&1; then
  echo "❌ No Kubernetes cluster found."
  echo "   Enable Kubernetes in Docker Desktop: Settings → Kubernetes → Enable"
  exit 1
fi

echo "[1/7] Installing dependencies..."
pnpm install

echo "[2/7] Creating optio namespace..."
kubectl apply -f k8s/namespace.yaml

echo "[3/7] Pre-pulling infrastructure images..."
docker pull postgres:16 -q
docker pull redis:7-alpine -q

echo "[4/7] Deploying Postgres and Redis to K8s..."
kubectl apply -f k8s/infrastructure.yaml
kubectl wait --namespace optio --for=condition=available deployment/postgres --timeout=120s
kubectl wait --namespace optio --for=condition=available deployment/redis --timeout=60s
echo "   Infrastructure ready."

echo "[5/7] Setting up port-forwards..."
pkill -f "kubectl port-forward.*optio" 2>/dev/null || true
sleep 1
kubectl port-forward -n optio svc/postgres 5432:5432 &>/dev/null &
kubectl port-forward -n optio svc/redis 6379:6379 &>/dev/null &
sleep 2

echo "[6/7] Running database migrations..."
cd apps/api && npx drizzle-kit migrate && cd "$ROOT_DIR"

echo "[7/7] Creating .env file..."
if [ ! -f .env ]; then
  cp .env.example .env
  echo "   Created .env from .env.example"
else
  echo "   .env already exists, skipping"
fi

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Infrastructure:"
echo "  Postgres .... localhost:5432 (K8s pod in optio namespace)"
echo "  Redis ...... localhost:6379 (K8s pod in optio namespace)"
echo ""
echo "Next steps:"
echo ""
echo "  1. Start the dev servers:"
echo "     pnpm dev"
echo ""
echo "  2. Open the UI:"
echo "     http://localhost:3000"
echo ""
echo "  3. Add your API keys (or use curl):"
echo "     http://localhost:3000/secrets"
echo ""
echo "  4. Build the agent container image:"
echo "     docker build -t optio-agent:latest -f Dockerfile.agent ."
echo ""
echo "  5. Create a task:"
echo "     http://localhost:3000/tasks/new"
echo ""
echo "To tear down:"
echo "  pkill -f 'kubectl port-forward.*optio'"
echo "  kubectl delete namespace optio"
