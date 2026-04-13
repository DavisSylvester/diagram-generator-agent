#!/usr/bin/env bash
set -euo pipefail

# diagram-generator-agent — Foreground launcher
# Usage: ./run.sh <prd-file> [--format mermaid|plantuml|d2] [--iterations N]

if [ $# -lt 1 ]; then
  echo "Usage: ./run.sh <prd-file> [options]"
  echo "       ./run.sh --help"
  exit 1
fi

exec bun run src/index.mts "$@"
