@echo off
REM diagram-generator-agent — Background launcher (Windows)
REM Usage: run-bg.cmd <prd-file> [options]

if "%~1"=="" (
  echo Usage: run-bg.cmd ^<prd-file^> [options]
  exit /b 1
)

if not exist .workspace mkdir .workspace

echo Starting diagram-generator-agent in background...
start /B bun run src/index.mts %* > .workspace\bg.log 2>&1

echo Log file: .workspace\bg.log
echo Use 'type .workspace\bg.log' to view progress.
