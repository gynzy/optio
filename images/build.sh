#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== Building Optio Agent Images ==="

# Base image (all others depend on this)
echo "[1/6] Building optio-base..."
docker build -t optio-base:latest -f "$SCRIPT_DIR/base.Dockerfile" "$ROOT_DIR"

# Language-specific images (can be built in parallel)
echo "[2/6] Building optio-node..."
docker build -t optio-node:latest -f "$SCRIPT_DIR/node.Dockerfile" "$ROOT_DIR" &

echo "[3/6] Building optio-python..."
docker build -t optio-python:latest -f "$SCRIPT_DIR/python.Dockerfile" "$ROOT_DIR" &

echo "[4/6] Building optio-go..."
docker build -t optio-go:latest -f "$SCRIPT_DIR/go.Dockerfile" "$ROOT_DIR" &

echo "[5/6] Building optio-rust..."
docker build -t optio-rust:latest -f "$SCRIPT_DIR/rust.Dockerfile" "$ROOT_DIR" &

wait

echo "[6/6] Building optio-full..."
docker build -t optio-full:latest -f "$SCRIPT_DIR/full.Dockerfile" "$ROOT_DIR"

# Tag optio-base as the default
docker tag optio-base:latest optio-agent:latest

echo ""
echo "=== Images Built ==="
docker images --filter "reference=optio-*" --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}"
