#!/bin/bash
set -euo pipefail

echo "[optio] Initializing repo pod"
echo "[optio] Repo: ${OPTIO_REPO_URL} (branch: ${OPTIO_REPO_BRANCH})"

# Configure git
git config --global user.name "Optio Agent"
git config --global user.email "optio-agent@noreply.github.com"

# Authenticate GitHub CLI
if [ -n "${GITHUB_TOKEN:-}" ]; then
  echo "${GITHUB_TOKEN}" | gh auth login --with-token
  echo "[optio] GitHub CLI authenticated"
fi

# Install extra packages if requested (comma or space separated)
if [ -n "${OPTIO_EXTRA_PACKAGES:-}" ]; then
  PACKAGES=$(echo "${OPTIO_EXTRA_PACKAGES}" | tr ',' ' ')
  echo "[optio] Installing extra packages: ${PACKAGES}"
  sudo apt-get update -qq 2>/dev/null && sudo apt-get install -y -qq ${PACKAGES} 2>&1 | tail -1 || echo "[optio] Warning: extra package install failed (may need root)"
fi

# Clone repo
cd /workspace
git clone --branch "${OPTIO_REPO_BRANCH}" "${OPTIO_REPO_URL}" repo
echo "[optio] Repo cloned"

# Run repo-level setup if present (.optio/setup.sh)
# This lets repo owners define custom setup: install deps, run build, etc.
if [ -f /workspace/repo/.optio/setup.sh ]; then
  echo "[optio] Running repo setup script (.optio/setup.sh)..."
  chmod +x /workspace/repo/.optio/setup.sh
  cd /workspace/repo && ./.optio/setup.sh
  echo "[optio] Repo setup complete"
fi

# Create tasks directory for worktrees
mkdir -p /workspace/tasks

echo "[optio] Repo pod ready — waiting for tasks"

# Keep the pod alive
exec sleep infinity
