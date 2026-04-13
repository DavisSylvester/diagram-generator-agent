# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| 0.1.x   | :white_check_mark: |

## Threat Model

`diagram-generator-agent` is a **local CLI tool** that reads PRD files and generates architecture diagrams via LLM providers. It is not a server and does not accept inbound network connections.

### Data Flow

1. User provides a PRD file on disk
2. CLI reads the PRD and sends content to the configured LLM provider (Ollama / OpenAI / Anthropic)
3. LLM responses are parsed and written to the local `.workspace/` directory
4. No data is stored externally beyond what the LLM provider retains per their own policy

## Credential Handling

| Control                        | Implementation                                                       |
|--------------------------------|----------------------------------------------------------------------|
| API key source                 | Environment variables only — never hardcoded                         |
| Log redaction                  | Winston redacts patterns: `sk-*`, `sk-ant-*`, `key-*`, known fields |
| Workspace output               | No credentials are written to generated diagrams or workspace files  |
| `.env` excluded from git       | `.gitignore` blocks all `.env*` files (except `.env.example`)        |
| No post-install scripts        | `package.json` contains no lifecycle hooks that execute code         |
| Dependencies pinned            | `bun.lock` ensures reproducible installs                             |

## Environment Variables

All secrets are loaded from environment variables and validated at startup via Zod schemas in `src/config/env.mts`. If a required key is missing or malformed, the process exits immediately with a descriptive error — it never falls through to a default or empty string.

## Generated Output

- Diagrams are written to `.workspace/<runId>/output/`
- No executable code is generated — output is Mermaid/PlantUML/SVG only
- No credentials or API keys are embedded in output files

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly:

1. **Do NOT open a public issue**
2. Email: [security contact — update with your email]
3. Include: description, reproduction steps, and impact assessment
4. Expected response time: 48 hours

## Dependencies

- All dependencies are declared in `package.json` and locked via `bun.lock`
- Dependabot is configured to monitor for vulnerable dependencies
- CodeQL scanning is enabled via GitHub Actions
