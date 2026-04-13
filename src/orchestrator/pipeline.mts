import type { Logger } from 'winston';
import type { PlanningAgent } from '../agents/planning-agent.mts';
import type { DiagramAgent } from '../agents/diagram-agent.mts';
import type { ValidationAgent } from '../agents/validation-agent.mts';
import type { SyntaxValidator } from '../verification/syntax-validator.mts';
import type { CostTracker } from '../llm/cost-tracker.mts';
import type { Workspace } from '../io/workspace.mts';
import type { ParallelExecutor } from '../graph/parallel-executor.mts';
import type { INotifier } from '../interfaces/i-notifier.mts';
import type { PipelineConfig, TaskGraph, TaskState, DiagramFile, DiagramFormat } from '../types/index.mts';
import { runFixLoop } from './fix-loop.mts';

interface PipelineDeps {
  readonly logger: Logger;
  readonly planningAgent: PlanningAgent;
  readonly diagramAgent: DiagramAgent;
  readonly validationAgent: ValidationAgent;
  readonly syntaxValidator: SyntaxValidator;
  readonly costTracker: CostTracker;
  readonly workspace: Workspace;
  readonly executor: ParallelExecutor;
  readonly notifier: INotifier;
}

interface PipelineInput {
  readonly prdContent: string;
  readonly runId: string;
  readonly outputFormat: DiagramFormat;
  readonly resumeRunId?: string | undefined;
}

export interface PipelineResult {
  readonly runId: string;
  readonly taskResults: Map<string, TaskState>;
  readonly diagrams: DiagramFile[];
  readonly totalCost: number;
  readonly durationMs: number;
}

export async function runPipeline(
  input: PipelineInput,
  config: PipelineConfig,
  deps: PipelineDeps,
): Promise<PipelineResult> {
  const { logger, planningAgent, diagramAgent, validationAgent, syntaxValidator, costTracker, workspace, executor, notifier } = deps;
  const { prdContent, runId, outputFormat } = input;
  const startMs = Date.now();

  // ── Phase 0: Workspace Setup ──────────────────────────────────────
  logger.info(`\n========== Phase 0: Workspace Setup ==========`);
  const runDir = await workspace.init(runId);

  await workspace.saveConfig(runId, {
    runId,
    outputFormat,
    maxFixIterations: config.maxFixIterations,
    maxConcurrency: config.maxConcurrency,
    maxTasks: config.maxTasks,
    startedAt: new Date().toISOString(),
  });

  // Load completed task IDs if resuming
  const completedTaskIds = new Set<string>();
  if (input.resumeRunId) {
    const existingStates = await workspace.getRunStatus(input.resumeRunId);
    for (const [taskId, state] of Object.entries(existingStates)) {
      if (state.status === `completed`) {
        completedTaskIds.add(taskId);
      }
    }
    logger.info(`Resuming run: ${completedTaskIds.size} tasks already completed`);
  }

  // ── Phase 1: Planning ─────────────────────────────────────────────
  logger.info(`\n========== Phase 1: Planning ==========`);

  let plan: TaskGraph | null = null;

  // Check plan cache
  const prdHash = await hashContent(prdContent);
  const cachedPlan = await workspace.loadCachedPlan(prdHash);

  if (cachedPlan) {
    logger.info(`Using cached plan (PRD hash: ${prdHash.slice(0, 8)}...)`);
    plan = { ...cachedPlan, runId };
  } else if (input.resumeRunId) {
    plan = await workspace.loadPlan(input.resumeRunId);
  }

  if (!plan) {
    logger.info(`Generating new diagram plan from PRD...`);
    const planResult = await planningAgent.run({ prdContent, runId, outputFormat });

    if (!planResult.ok) {
      logger.error(`Planning failed: ${planResult.error.message}`);
      return {
        runId,
        taskResults: new Map(),
        diagrams: [],
        totalCost: costTracker.getTotalCost(),
        durationMs: Date.now() - startMs,
      };
    }

    plan = planResult.value.result;
    costTracker.record(
      planResult.value.model,
      planResult.value.tokenUsage.inputTokens,
      planResult.value.tokenUsage.outputTokens,
      `planning`,
    );

    await workspace.saveCachedPlan(prdHash, plan);
  }

  await workspace.savePlan(runId, plan);

  // Trim tasks if --max-tasks is set
  let tasks = [...plan.tasks];
  if (config.maxTasks > 0 && config.maxTasks < tasks.length) {
    tasks = tasks.slice(0, config.maxTasks);
    logger.info(`Trimmed to ${config.maxTasks} tasks`);
  }

  logger.info(`Plan contains ${tasks.length} diagram tasks`);

  // ── Phase 2: Diagram Generation ───────────────────────────────────
  logger.info(`\n========== Phase 2: Diagram Generation ==========`);

  const allDiagrams: DiagramFile[] = [];
  const diagramsByTask = new Map<string, DiagramFile[]>();

  const taskResults = await executor.execute(
    tasks,
    async (task) => {
      await notifier.notifyTaskStarted(task.id, task.name);

      // Gather existing diagrams from completed dependencies
      const existingDiagrams: DiagramFile[] = [];
      for (const depId of task.dependsOn) {
        const depDiagrams = diagramsByTask.get(depId);
        if (depDiagrams) {
          existingDiagrams.push(...depDiagrams);
        }
      }

      const { state, diagrams } = await runFixLoop(
        {
          runId,
          task,
          prdContent,
          outputFormat,
          maxIterations: config.maxFixIterations,
          taskCostLimit: config.taskCostLimit,
          existingDiagrams,
          noValidate: config.noValidate,
        },
        { diagramAgent, validationAgent, syntaxValidator, costTracker, workspace, logger },
      );

      diagramsByTask.set(task.id, diagrams);
      allDiagrams.push(...diagrams);

      if (state.status === `completed`) {
        await notifier.notifyTaskCompleted(task.id, task.name);
      } else {
        await notifier.notifyTaskFailed(task.id, task.name, state.lastError ?? `Unknown error`);
      }

      return state;
    },
    { concurrency: config.maxConcurrency, completedTaskIds },
  );

  // ── Phase 3: Summary ──────────────────────────────────────────────
  logger.info(`\n========== Phase 3: Summary ==========`);

  const completed = [...taskResults.values()].filter((s) => s.status === `completed`).length;
  const failed = [...taskResults.values()].filter((s) => s.status === `failed`).length;
  const skipped = [...taskResults.values()].filter((s) => s.status === `skipped`).length;
  const totalCost = costTracker.getTotalCost();
  const durationMs = Date.now() - startMs;

  const summary = {
    runId,
    completed,
    failed,
    skipped,
    totalTasks: tasks.length,
    totalDiagrams: allDiagrams.length,
    totalCost: totalCost.toFixed(4),
    durationMs,
    durationFormatted: formatDuration(durationMs),
  };

  await workspace.saveExecutionSummary(runId, summary);
  await workspace.saveTokenUsage(runId, costTracker.getSummary());

  logger.info(`Pipeline complete`, summary);
  await notifier.notifyPipelineComplete(
    `Completed: ${completed}/${tasks.length} tasks, ${allDiagrams.length} diagrams, $${totalCost.toFixed(4)}, ${formatDuration(durationMs)}`,
  );

  return { runId, taskResults, diagrams: allDiagrams, totalCost, durationMs };
}

async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest(`SHA-256`, data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, `0`)).join(``);
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}
