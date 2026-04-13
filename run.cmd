@echo off
REM diagram-generator-agent — Foreground launcher (Windows)
REM Usage: run.cmd <prd-file> [--format mermaid|plantuml|d2] [--iterations N]

if "%~1"=="" (
  echo Usage: run.cmd ^<prd-file^> [options]
  echo        run.cmd --help
  exit /b 1
)

bun run src/index.mts %*
