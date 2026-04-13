# Contributing to diagram-generator-agent

Thank you for your interest in contributing!

## Getting Started

1. Fork the repository
2. Clone your fork locally
3. Install dependencies: `bun install`
4. Create a feature branch: `git checkout -b feature/your-feature`

## Development Setup

### Prerequisites

- [Bun](https://bun.sh) v1.1+
- An LLM provider configured (Ollama, OpenAI, or Anthropic)

### Environment

Copy `.env.example` to `.env` and configure your provider:

```bash
cp .env.example .env
```

### Running

```bash
bun run src/index.mts --prd path/to/prd.md
```

### Type Checking

```bash
bunx tsc --noEmit
```

### Testing

```bash
bun test
```

### Linting

```bash
bunx eslint src/
```

## Code Standards

- **TypeScript strict mode** — no `any` types
- **`.mts` extensions** — all source files use ES module TypeScript extension
- **Explicit imports** — always include `.mts` extension in import specifiers
- **Result types** — use `Result<T, E>` for error handling, not thrown exceptions
- **One function per file** — each top-level function lives in its own `.mts` file
- **One interface per file** — prefixed with `i-` (e.g., `i-llm-factory.mts`)
- **No `console.log`** — use the Winston logger from the DI container
- **DI everywhere** — no `new` inside services or agents; resolve from container

## Pull Request Process

1. Ensure `bunx tsc --noEmit` passes with no errors
2. Ensure `bunx eslint src/` reports no errors
3. Ensure all tests pass: `bun test`
4. Update documentation if you changed behavior
5. Write a clear PR description with context on *why* the change was made
6. Request review from a maintainer

## Commit Messages

- Use imperative mood: "Add feature" not "Added feature"
- Keep the first line under 72 characters
- Reference issues where applicable: "Fix #42: resolve timeout handling"

## Architecture

See the [README](README.md) for architecture overview and the `docs/` directory for detailed documentation.
