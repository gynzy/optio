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
command -v helm >/dev/null 2>&1 || { echo "❌ helm is required. Install with: brew install helm"; exit 1; }

# Check cluster connectivity
if ! kubectl cluster-info >/dev/null 2>&1; then
  echo "❌ No Kubernetes cluster found."
  echo "   Enable Kubernetes in Docker Desktop: Settings → Kubernetes → Enable"
  exit 1
fi

# Check available disk space in Docker (need ~15GB for images)
DOCKER_DISK_FREE=$(docker system df --format '{{.Reclaimable}}' 2>/dev/null | head -1 || true)
echo "   Docker disk reclaimable: ${DOCKER_DISK_FREE:-unknown}"
echo "   Tip: run 'docker system prune -a --volumes' if builds fail with 'no space left on device'"
echo ""

echo "[1/6] Installing dependencies..."
pnpm install

echo "[2/6] Building agent images..."
echo "   Building optio-base (required)..."
docker build -t optio-base:latest -f images/base.Dockerfile . -q
docker tag optio-base:latest optio-agent:latest
echo "   Building optio-node..."
docker build -t optio-node:latest -f images/node.Dockerfile . -q &
echo "   Building optio-python..."
docker build -t optio-python:latest -f images/python.Dockerfile . -q &
echo "   Building optio-go..."
docker build -t optio-go:latest -f images/go.Dockerfile . -q &
echo "   Building optio-rust..."
docker build -t optio-rust:latest -f images/rust.Dockerfile . -q &
echo "   Building optio-optio (operations assistant)..."
docker build -t optio-optio:latest -f Dockerfile.optio . -q &
wait
echo "   Building optio-full..."
docker build -t optio-full:latest -f images/full.Dockerfile . -q || echo "   ⚠ optio-full build failed (optional, skipping)"
echo "   All agent images built."

echo "[3/6] Building API and Web images..."
docker build -t optio-api:latest -f Dockerfile.api . -q
docker build -t optio-web:latest -f Dockerfile.web . -q
echo "   API and Web images built."

# Pull external images that the Helm chart needs (containerd may not have them)
echo "   Pulling postgres:16 and redis:7-alpine..."
docker pull -q postgres:16 2>/dev/null || echo "   ⚠ Failed to pull postgres:16 (will try at deploy time)"
docker pull -q redis:7-alpine 2>/dev/null || echo "   ⚠ Failed to pull redis:7-alpine (will try at deploy time)"

echo "[4/6] Installing metrics-server..."
if kubectl get deployment metrics-server -n kube-system &>/dev/null; then
  echo "   metrics-server already installed, skipping"
else
  kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml 2>/dev/null || {
    echo "   ⚠ Failed to install metrics-server (resource utilization will show N/A)"
  }
  # Docker Desktop / kind / minikube need --kubelet-insecure-tls
  kubectl patch deployment metrics-server -n kube-system --type=json \
    -p '[{"op":"add","path":"/spec/template/spec/containers/0/args/-","value":"--kubelet-insecure-tls"}]' 2>/dev/null || true
  echo "   metrics-server installed (may take a minute to become ready)"
fi

echo "[5/6] Deploying Optio to Kubernetes via Helm..."
ENCRYPTION_KEY=$(openssl rand -hex 32)

# Clean up any stuck-terminating namespace from a previous failed run
if kubectl get namespace optio -o jsonpath='{.status.phase}' 2>/dev/null | grep -q Terminating; then
  echo "   Cleaning up stuck namespace from previous run..."
  kubectl get namespace optio -o json \
    | python3 -c "import sys,json; d=json.load(sys.stdin); d['spec']['finalizers']=[]; json.dump(d,sys.stdout)" \
    | kubectl replace --raw "/api/v1/namespaces/optio/finalize" -f - >/dev/null 2>&1 || true
  sleep 3
fi

# Pre-create namespace with Helm ownership labels (chart includes a Namespace resource,
# so --create-namespace would conflict with it)
if ! kubectl get namespace optio &>/dev/null; then
  kubectl create namespace optio
  kubectl label namespace optio app.kubernetes.io/managed-by=Helm
  kubectl annotate namespace optio meta.helm.sh/release-name=optio meta.helm.sh/release-namespace=optio
fi

helm upgrade --install optio helm/optio -n optio \
  --set encryption.key="$ENCRYPTION_KEY" \
  --set api.image.pullPolicy=IfNotPresent \
  --set web.image.pullPolicy=IfNotPresent \
  --set agent.image.repository=optio-base \
  --set agent.image.tag=latest \
  --set agent.imagePullPolicy=IfNotPresent \
  --set optio.image.pullPolicy=IfNotPresent \
  --set auth.disabled=true \
  --set api.service.type=NodePort \
  --set api.service.nodePort=30400 \
  --set web.service.type=NodePort \
  --set web.service.nodePort=30310 \
  --set postgresql.auth.password=optio_dev \
  --timeout=120s
echo "   Helm deployment complete."

echo "[6/6] Waiting for pods to be ready..."
kubectl wait --namespace optio --for=condition=available deployment/optio-postgres --timeout=60s 2>/dev/null || true
kubectl wait --namespace optio --for=condition=available deployment/optio-redis --timeout=30s 2>/dev/null || true
kubectl wait --namespace optio --for=condition=available deployment/optio-api --timeout=90s 2>/dev/null || true
kubectl wait --namespace optio --for=condition=available deployment/optio-web --timeout=60s 2>/dev/null || true
kubectl wait --namespace optio --for=condition=available deployment/optio-optio --timeout=60s 2>/dev/null || true

# Start port-forwarding (NodePort may not be reachable on Docker Desktop with kind/containerd)
echo ""
echo "   Starting port-forwarding..."
pkill -f "kubectl port-forward.*optio" 2>/dev/null || true
sleep 1
kubectl port-forward svc/optio-web 30310:3000 -n optio &>/dev/null &
PF_WEB_PID=$!
kubectl port-forward svc/optio-api 30400:4000 -n optio &>/dev/null &
PF_API_PID=$!
sleep 2

# Verify services are reachable
WEB_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:30310 2>/dev/null || echo "000")
API_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:30400/api/health 2>/dev/null || echo "000")

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Services:"
if [ "$WEB_STATUS" = "200" ]; then
  echo "  Web UI ...... http://localhost:30310 ✓"
else
  echo "  Web UI ...... http://localhost:30310 (status: $WEB_STATUS — may still be starting)"
fi
if [ "$API_STATUS" = "200" ]; then
  echo "  API ......... http://localhost:30400 ✓"
else
  echo "  API ......... http://localhost:30400 (status: $API_STATUS — may still be starting)"
fi
echo "  Postgres .... optio-postgres:5432 (K8s internal)"
echo "  Redis ....... optio-redis:6379 (K8s internal)"
echo ""
echo "Pod status:"
kubectl get pods -n optio --no-headers 2>/dev/null | sed 's/^/  /'
echo ""
echo "Agent images:"
docker images --filter "reference=optio-*" --format "  {{.Repository}}:{{.Tag}}" 2>/dev/null || true
echo ""
echo "Port-forwarding is running in the background (PIDs: $PF_WEB_PID, $PF_API_PID)."
echo "If it stops, restart with:"
echo "  kubectl port-forward svc/optio-web 30310:3000 -n optio &"
echo "  kubectl port-forward svc/optio-api 30400:4000 -n optio &"
echo ""
echo "Next steps:"
echo ""
echo "  1. Open the setup wizard:"
echo "     http://localhost:30310/setup"
echo ""
echo "  2. After rebuilding images, redeploy with:"
echo "     docker build -t optio-api:latest -f Dockerfile.api ."
echo "     docker build -t optio-web:latest -f Dockerfile.web ."
echo "     kubectl rollout restart deployment/optio-api deployment/optio-web -n optio"
echo ""
echo "To tear down:"
echo "  helm uninstall optio -n optio"
