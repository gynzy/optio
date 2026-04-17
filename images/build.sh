#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
TAG="${1:-latest}"

echo "=== Building Optio Agent Images ==="

# Base image (all others depend on this)
echo "[1/10] Building optio-base..."
docker build -t "optio-base:${TAG}" -f "${SCRIPT_DIR}/base.Dockerfile" "${ROOT_DIR}"

echo "Using base internal image: optio-base:${TAG}"
BASE_IMAGE="optio-base:${TAG}"

# Language-specific images (can be built in parallel)
echo "[2/10] Building optio-node..."
docker build -t "optio-node:${TAG}" --build-arg BASE_IMAGE="${BASE_IMAGE}" -f "${SCRIPT_DIR}/node.Dockerfile" "${ROOT_DIR}" &

echo "[3/10] Building optio-python..."
docker build -t "optio-python:${TAG}" --build-arg BASE_IMAGE="${BASE_IMAGE}" -f "${SCRIPT_DIR}/python.Dockerfile" "${ROOT_DIR}" &

echo "[4/10] Building optio-go..."
docker build -t "optio-go:${TAG}" --build-arg BASE_IMAGE="${BASE_IMAGE}" -f "${SCRIPT_DIR}/go.Dockerfile" "${ROOT_DIR}" &

echo "[5/10] Building optio-rust..."
docker build -t "optio-rust:${TAG}" --build-arg BASE_IMAGE="${BASE_IMAGE}" -f "${SCRIPT_DIR}/rust.Dockerfile" "${ROOT_DIR}" &

echo "[6/10] Building optio-ruby..."
docker build -t "optio-ruby:${TAG}" --build-arg BASE_IMAGE="${BASE_IMAGE}" -f "${SCRIPT_DIR}/ruby.Dockerfile" "${ROOT_DIR}" &

echo "[7/10] Building optio-dart..."
docker build -t "optio-dart:${TAG}" --build-arg BASE_IMAGE="${BASE_IMAGE}" -f "${SCRIPT_DIR}/dart.Dockerfile" "${ROOT_DIR}" &

echo "[8/10] Building optio-dind..."
docker build -t "optio-dind:${TAG}" -f "${SCRIPT_DIR}/dind.Dockerfile" "${ROOT_DIR}" &

echo "[9/10] Building optio-optio (operations assistant)..."
docker build -t "optio-optio:${TAG}" -f "${ROOT_DIR}/Dockerfile.optio" "${ROOT_DIR}" &

wait

echo "[10/10] Building optio-full..."
docker build -t "optio-full:${TAG}" --build-arg BASE_IMAGE="${BASE_IMAGE}" -f "${SCRIPT_DIR}/full.Dockerfile" "${ROOT_DIR}"

# Tag optio-base as the default
docker tag "optio-base:${TAG}" "optio-agent:${TAG}"

echo ""
echo "=== Images Built ==="
docker images --filter "reference=optio-*" --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}"
