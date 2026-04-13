#!/usr/bin/env bash
set -euo pipefail

# diagram-generator-agent — Background launcher
# Usage: ./run-bg.sh <prd-file> [options]
# Runs the pipeline in the background with nohup, logs to .workspace/bg.log

if [ $# -lt 1 ]; then
  echo "Usage: ./run-bg.sh <prd-file> [options]"
  exit 1
fi

LOG_FILE=".workspace/bg.log"
mkdir -p .workspace

echo "Starting diagram-generator-agent in background..."
echo "Log file: $LOG_FILE"

nohup bun run src/index.mts "$@" > "$LOG_FILE" 2>&1 &
PID=$!

echo "PID: $PID"
echo "$PID" > .workspace/bg.pid

echo "Use 'tail -f $LOG_FILE' to follow progress."
echo "Use 'kill $PID' to stop the pipeline."
