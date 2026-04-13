export type CliCommand =
  | { kind: `run`; prdPath: string }
  | { kind: `resume`; runId: string }
  | { kind: `list-runs` }
  | { kind: `status`; runId: string }
  | { kind: `help` };

export interface CliOptions {
  readonly command: CliCommand;
  readonly iterations: number | undefined;
  readonly maxTasks: number | undefined;
  readonly concurrency: number | undefined;
  readonly noDocs: boolean;
  readonly noValidate: boolean;
  readonly outputFormat: `mermaid` | `plantuml` | `d2` | undefined;
}

function printHelp(): void {
  const help = `
diagram-generator-agent — Generate architecture diagrams from PRDs

USAGE
  bun run src/index.mts --prd <file>              Start new diagram generation
  bun run src/index.mts --resume <run-id>          Resume an interrupted run
  bun run src/index.mts --list-runs                List all previous runs
  bun run src/index.mts --status <run-id>          Show task status for a run

OPTIONS
  --prd <file>          Path to the PRD markdown file
  --resume <run-id>     Resume a previous run by ID
  --list-runs           List all previous runs and their status
  --status <run-id>     Show detailed task status for a run
  --iterations <n>      Max fix iterations per diagram (default: 5 or env)
  --max-tasks <n>       Limit to first N diagram tasks
  --concurrency <n>     Parallel task limit (default: 4 or env)
  --format <fmt>        Output format: mermaid, plantuml, d2 (default: mermaid)
  --no-docs             Skip documentation generation
  --no-validate         Skip diagram validation
  --help                Show this help message

ENVIRONMENT
  See .env.example for all configuration options.

EXAMPLES
  bun run src/index.mts --prd ./my-api-prd.md
  bun run src/index.mts --prd ./prd.md --format plantuml --iterations 10
  bun run src/index.mts --resume 01JARX9KP3M2VBCDE4567FG8H
  bun run src/index.mts --list-runs
  bun run src/index.mts --status 01JARX9KP3M2VBCDE4567FG8H
`.trim();

  console.log(help);
}

export function parseArgs(argv: readonly string[]): CliOptions {
  const args = argv.slice(2);

  let command: CliCommand | undefined;
  let iterations: number | undefined;
  let maxTasks: number | undefined;
  let concurrency: number | undefined;
  let noDocs = false;
  let noValidate = false;
  let outputFormat: `mermaid` | `plantuml` | `d2` | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case `--help`:
      case `-h`:
        printHelp();
        command = { kind: `help` };
        break;

      case `--prd`: {
        const prdPath = args[++i];
        if (!prdPath) {
          console.error(`Error: --prd requires a file path`);
          process.exit(1);
        }
        command = { kind: `run`, prdPath };
        break;
      }

      case `--resume`: {
        const runId = args[++i];
        if (!runId) {
          console.error(`Error: --resume requires a run ID`);
          process.exit(1);
        }
        command = { kind: `resume`, runId };
        break;
      }

      case `--list-runs`:
        command = { kind: `list-runs` };
        break;

      case `--status`: {
        const runId = args[++i];
        if (!runId) {
          console.error(`Error: --status requires a run ID`);
          process.exit(1);
        }
        command = { kind: `status`, runId };
        break;
      }

      case `--iterations`: {
        const val = args[++i];
        iterations = val ? parseInt(val, 10) : undefined;
        break;
      }

      case `--max-tasks`: {
        const val = args[++i];
        maxTasks = val ? parseInt(val, 10) : undefined;
        break;
      }

      case `--concurrency`: {
        const val = args[++i];
        concurrency = val ? parseInt(val, 10) : undefined;
        break;
      }

      case `--format`: {
        const val = args[++i] as `mermaid` | `plantuml` | `d2` | undefined;
        if (val && ![`mermaid`, `plantuml`, `d2`].includes(val)) {
          console.error(`Error: --format must be one of: mermaid, plantuml, d2`);
          process.exit(1);
        }
        outputFormat = val;
        break;
      }

      case `--no-docs`:
        noDocs = true;
        break;

      case `--no-validate`:
        noValidate = true;
        break;

      default:
        // Legacy positional args: <prd-file> [max-iterations] [max-tasks]
        if (!command && arg && !arg.startsWith(`-`)) {
          command = { kind: `run`, prdPath: arg };
        } else if (command?.kind === `run` && !iterations && arg && !arg.startsWith(`-`)) {
          iterations = parseInt(arg, 10);
        } else if (command?.kind === `run` && !maxTasks && arg && !arg.startsWith(`-`)) {
          maxTasks = parseInt(arg, 10);
        }
        break;
    }
  }

  if (!command) {
    printHelp();
    command = { kind: `help` };
  }

  return {
    command,
    iterations,
    maxTasks,
    concurrency,
    noDocs,
    noValidate,
    outputFormat,
  };
}
