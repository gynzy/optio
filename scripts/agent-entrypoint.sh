#!/bin/bash
set -euo pipefail

echo "[optio] Starting agent: ${OPTIO_AGENT_TYPE}"
echo "[optio] Task ID: ${OPTIO_TASK_ID}"
echo "[optio] Repo: ${OPTIO_REPO_URL} (branch: ${OPTIO_REPO_BRANCH})"
echo "[optio] Auth mode: ${OPTIO_AUTH_MODE:-api-key}"

# Configure git
git config --global user.name "Optio Agent"
git config --global user.email "optio-agent@noreply.github.com"

# Authenticate GitHub CLI
echo "${GITHUB_TOKEN}" | gh auth login --with-token
echo "[optio] GitHub CLI authenticated"

# Clone repo
cd /workspace
git clone --branch "${OPTIO_REPO_BRANCH}" "${OPTIO_REPO_URL}" repo
cd repo

# Create working branch
BRANCH_NAME="${OPTIO_BRANCH_NAME:-optio/task-${OPTIO_TASK_ID}}"
git checkout -b "${BRANCH_NAME}"
echo "[optio] Working on branch: ${BRANCH_NAME}"

# Create any setup files injected by the orchestrator
if [ -n "${OPTIO_SETUP_FILES:-}" ]; then
  echo "[optio] Writing setup files..."
  echo "${OPTIO_SETUP_FILES}" | base64 -d | python3 -c "
import json, sys, os
files = json.load(sys.stdin)
for f in files:
    os.makedirs(os.path.dirname(f['path']), exist_ok=True)
    with open(f['path'], 'w') as fh:
        fh.write(f['content'])
    if f.get('executable'):
        os.chmod(f['path'], 0o755)
    print(f'  wrote {f[\"path\"]}')
"
fi

# Run the appropriate agent
case "${OPTIO_AGENT_TYPE}" in
  claude-code)
    # Set up auth based on mode
    if [ "${OPTIO_AUTH_MODE:-api-key}" = "max-subscription" ]; then
      echo "[optio] Using Max subscription (token proxy)"
      # Verify the token proxy is reachable
      if curl -sf "${OPTIO_API_URL}/api/auth/claude-token" > /dev/null 2>&1; then
        echo "[optio] Token proxy reachable"
      else
        echo "[optio] WARNING: Token proxy not reachable at ${OPTIO_API_URL}"
      fi
      # Unset API key so Claude Code uses the apiKeyHelper
      unset ANTHROPIC_API_KEY 2>/dev/null || true
    else
      echo "[optio] Using API key"
    fi

    echo "[optio] Running Claude Code..."
    claude -p "${OPTIO_PROMPT}" \
      --allowedTools "Bash,Read,Write,Edit,Glob,Grep,WebSearch,WebFetch" \
      --output-format stream-json \
      --verbose
    ;;
  codex)
    echo "[optio] Running OpenAI Codex..."
    codex exec --full-auto "${OPTIO_PROMPT}" --json
    ;;
  *)
    echo "[optio] Unknown agent type: ${OPTIO_AGENT_TYPE}"
    exit 1
    ;;
esac

echo "[optio] Agent finished"
