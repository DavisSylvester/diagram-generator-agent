#!/usr/bin/env bun
import { ulid } from 'ulid';
import { createLogger, format, transports } from 'winston';
import { parseArgs } from './cli/parse-args.mts';
import { loadEnv } from './config/env.mts';
import { createContainer } from './container/di.mts';
import { parsePrd } from './input/prd-parser.mts';
import { runPipeline } from './orchestrator/pipeline.mts';
import type { DiagramFormat, PipelineConfig } from './types/index.mts';

async function main(): Promise<void> {
  const options = parseArgs(process.argv);

  if (options.command.kind === `help`) {
    process.exit(0);
  }

  // Bootstrap logger for env validation
  const bootLogger = createLogger({
    level: `info`,
    format: format.combine(format.colorize(), format.simple()),
    transports: [new transports.Console()],
  });

  const env = loadEnv(bootLogger);

  // Create DI container with CLI overrides
  const overrides: Record<string, unknown> = {
    noDocs: options.noDocs,
    noValidate: options.noValidate,
  };
  if (options.iterations !== undefined) overrides[`maxFixIterations`] = options.iterations;
  if (options.concurrency !== undefined) overrides[`maxConcurrency`] = options.concurrency;
  if (options.maxTasks !== undefined) overrides[`maxTasks`] = options.maxTasks;

  const container = createContainer(env, overrides as Partial<PipelineConfig>);

  const { logger, workspace, pipelineConfig } = container;

  // ── Handle non-pipeline commands ──────────────────────────────
  if (options.command.kind === `list-runs`) {
    const runs = await workspace.listRuns();
    if (runs.length === 0) {
      logger.info(`No previous runs found.`);
    } else {
      logger.info(`Previous runs:`);
      for (const run of runs) {
        logger.info(`  ${run}`);
      }
    }
    process.exit(0);
  }

  if (options.command.kind === `status`) {
    const states = await workspace.getRunStatus(options.command.runId);
    if (Object.keys(states).length === 0) {
      logger.info(`No tasks found for run: ${options.command.runId}`);
    } else {
      logger.info(`Task status for run: ${options.command.runId}`);
      for (const [taskId, state] of Object.entries(states)) {
        const icon = state.status === `completed` ? `✅` : state.status === `failed` ? `❌` : `⏳`;
        logger.info(`  ${icon} ${taskId}: ${state.status} (iteration ${state.iteration})`);
      }
    }
    process.exit(0);
  }

  // ── Run pipeline ──────────────────────────────────────────────
  const runId = ulid();
  const outputFormat: DiagramFormat = options.outputFormat ?? `mermaid`;

  let prdContent: string;
  let resumeRunId: string | undefined;

  if (options.command.kind === `resume`) {
    resumeRunId = options.command.runId;
    // Load PRD from previous run config
    const plan = await workspace.loadPlan(resumeRunId);
    if (!plan) {
      logger.error(`Cannot resume: no plan found for run ${resumeRunId}`);
      process.exit(1);
    }
    // We need the PRD content — for resume, we re-read from the cached plan
    prdContent = `[Resumed from run ${resumeRunId}]`;
    logger.info(`Resuming run: ${resumeRunId} as new run: ${runId}`);
  } else {
    const prdResult = await parsePrd(options.command.prdPath, logger);
    if (!prdResult.ok) {
      logger.error(`Failed to parse PRD: ${prdResult.error.message}`);
      process.exit(1);
    }
    prdContent = prdResult.value.content;
    logger.info(`Loaded PRD: ${prdResult.value.title} (${prdResult.value.sections.length} sections)`);
  }

  logger.info(`Starting diagram generation pipeline`, {
    runId,
    outputFormat,
    maxIterations: pipelineConfig.maxFixIterations,
    maxConcurrency: pipelineConfig.maxConcurrency,
  });

  const result = await runPipeline(
    { prdContent, runId, outputFormat, resumeRunId },
    pipelineConfig,
    {
      logger: container.logger,
      planningAgent: container.planningAgent,
      diagramAgent: container.diagramAgent,
      validationAgent: container.validationAgent,
      syntaxValidator: container.syntaxValidator,
      costTracker: container.costTracker,
      workspace: container.workspace,
      executor: container.executor,
      notifier: container.notifier,
    },
  );

  // ── Exit code ─────────────────────────────────────────────────
  const costSummary = container.costTracker.getSummary();
  logger.info(`\n========== Cost Summary ==========`);
  logger.info(`Total cost: $${costSummary.totalCost.toFixed(4)}`);
  logger.info(`Total tokens: ${costSummary.totalInputTokens} in / ${costSummary.totalOutputTokens} out`);

  const failedCount = [...result.taskResults.values()].filter((s) => s.status === `failed`).length;

  if (failedCount > 0) {
    const hardFailures = [...result.taskResults.values()].filter(
      (s) => s.status === `failed` && s.circuitBroken,
    );

    if (hardFailures.length > 0) {
      logger.error(`${hardFailures.length} tasks hit circuit breaker — exiting with code 2`);
      process.exit(2);
    }

    logger.warn(`${failedCount} tasks failed — exiting with code 1`);
    process.exit(1);
  }

  logger.info(`All tasks completed successfully. Diagrams: ${result.diagrams.length}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(`Fatal error:`, error);
  process.exit(1);
});
