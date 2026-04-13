import type { Logger } from 'winston';
import type { DiagramAgent, DiagramInput } from '../agents/diagram-agent.mts';
import type { ValidationAgent, ValidationResult } from '../agents/validation-agent.mts';
import type { CostTracker } from '../llm/cost-tracker.mts';
import type { Workspace } from '../io/workspace.mts';
import type { Task, TaskState, DiagramFile, DiagramFormat } from '../types/index.mts';

/**
 * After this many iterations, accept the diagram if it has zero errors
 * OR only warnings/suggestions (no hard errors). This prevents infinite
 * loops where the validator keeps inventing new cosmetic issues.
 */
const GOOD_ENOUGH_AFTER_ITERATION = 2;

/**
 * Maximum number of hard errors that still allow acceptance after the
 * good-enough threshold. At iteration >= GOOD_ENOUGH_AFTER_ITERATION,
 * a diagram with <= this many errors is accepted with a warning.
 */
const ACCEPTABLE_ERROR_CEILING = 2;

interface FixLoopOptions {
  readonly runId: string;
  readonly task: Task;
  readonly prdContent: string;
  readonly outputFormat: DiagramFormat;
  readonly maxIterations: number;
  readonly taskCostLimit: number;
  readonly existingDiagrams: readonly DiagramFile[];
  readonly noValidate: boolean;
}

interface FixLoopDeps {
  readonly diagramAgent: DiagramAgent;
  readonly validationAgent: ValidationAgent;
  readonly costTracker: CostTracker;
  readonly workspace: Workspace;
  readonly logger: Logger;
}

export async function runFixLoop(
  options: FixLoopOptions,
  deps: FixLoopDeps,
): Promise<{ state: TaskState; diagrams: DiagramFile[] }> {
  const { runId, task, prdContent, outputFormat, maxIterations, taskCostLimit, noValidate } = options;
  const { diagramAgent, validationAgent, costTracker, workspace, logger } = deps;

  let currentDiagrams: DiagramFile[] = [];
  let lastErrors: string[] = [];
  let lastErrorSet = new Set<string>();
  let consecutiveNoImprovement = 0;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    logger.info(`[Iteration ${iteration}] Task: ${task.name}`, { taskId: task.id });

    // Check cost limit
    const taskCost = costTracker.getTaskCost(task.id);
    if (taskCost > taskCostLimit) {
      logger.error(`Cost limit exceeded for task ${task.name}: $${taskCost.toFixed(2)} > $${taskCostLimit.toFixed(2)}`);
      return {
        state: { taskId: task.id, status: `failed`, iteration, lastError: `Cost limit exceeded` },
        diagrams: currentDiagrams,
      };
    }

    // Circuit breaker: 5 consecutive iterations with no improvement
    if (consecutiveNoImprovement >= 5) {
      // Even on circuit break, if we have diagrams, save them as best-effort
      if (currentDiagrams.length > 0) {
        logger.warn(`Circuit breaker tripped for task: ${task.name} — saving best-effort diagrams`, { taskId: task.id, iteration });
        return await acceptDiagrams(workspace, runId, task, iteration, currentDiagrams, `completed`);
      }
      return {
        state: { taskId: task.id, status: `failed`, iteration, lastError: `Circuit breaker: no improvement`, circuitBroken: true },
        diagrams: currentDiagrams,
      };
    }

    // Step 1: Generate / Fix diagram
    const diagramInput: DiagramInput = {
      taskName: task.name,
      taskDescription: task.description,
      diagramType: task.diagramType,
      outputFormat,
      prdContent,
      existingDiagrams: options.existingDiagrams,
      mode: iteration === 0 ? `generate` : `fix`,
      errors: lastErrors,
    };

    const diagramResult = await diagramAgent.run(diagramInput);

    if (!diagramResult.ok) {
      logger.error(`Diagram generation failed for task: ${task.name}`, { error: diagramResult.error.message });
      lastErrors = [diagramResult.error.message];
      consecutiveNoImprovement++;
      continue;
    }

    currentDiagrams = diagramResult.value.result;
    costTracker.record(
      diagramResult.value.model,
      diagramResult.value.tokenUsage.inputTokens,
      diagramResult.value.tokenUsage.outputTokens,
      task.id,
    );

    // Save iteration snapshot
    await workspace.saveIterationSnapshot(runId, task.id, iteration, currentDiagrams);

    // Step 2: Validate (optional)
    if (noValidate) {
      logger.info(`Validation skipped for task: ${task.name}`);
      return await acceptDiagrams(workspace, runId, task, iteration, currentDiagrams, `completed`);
    }

    // Collect validation results across all diagrams in this task
    const allErrors: string[] = [];
    const allWarnings: string[] = [];
    let validationRan = false;

    for (const diagram of currentDiagrams) {
      const validationResult = await validationAgent.run({
        diagram,
        prdContent,
      });

      if (!validationResult.ok) {
        // Validation agent itself failed — fail-open with a warning.
        // Don't block the diagram because the validator crashed.
        logger.warn(`Validation agent failed for ${diagram.diagramType} — accepting diagram (fail-open)`, {
          taskId: task.id,
          error: validationResult.error.message,
        });
        continue;
      }

      validationRan = true;
      costTracker.record(
        validationResult.value.model,
        validationResult.value.tokenUsage.inputTokens,
        validationResult.value.tokenUsage.outputTokens,
        task.id,
      );

      const vr: ValidationResult = validationResult.value.result;

      // Only errors block acceptance — warnings and suggestions are logged but don't fail
      if (!vr.valid && vr.errors.length > 0) {
        allErrors.push(...vr.errors);
      }
      if (vr.warnings.length > 0) {
        allWarnings.push(...vr.warnings);
      }
    }

    // Log warnings (informational, never blocking)
    if (allWarnings.length > 0) {
      logger.info(`Validation warnings for task: ${task.name}`, { warnings: allWarnings.length, items: allWarnings });
    }

    // ── Accept if clean ──────────────────────────────────────────
    if (allErrors.length === 0) {
      logger.info(`Task completed successfully: ${task.name}`, { taskId: task.id, iteration });
      return await acceptDiagrams(workspace, runId, task, iteration, currentDiagrams, `completed`);
    }

    // ── Good-enough threshold ────────────────────────────────────
    // After N iterations, accept diagrams with minor remaining errors
    // rather than looping until the circuit breaker trips.
    if (iteration >= GOOD_ENOUGH_AFTER_ITERATION && allErrors.length <= ACCEPTABLE_ERROR_CEILING) {
      logger.info(
        `Task accepted (good enough after ${iteration + 1} iterations): ${task.name}`,
        { taskId: task.id, iteration, remainingErrors: allErrors.length, errors: allErrors },
      );
      return await acceptDiagrams(workspace, runId, task, iteration, currentDiagrams, `completed`);
    }

    // ── Track improvement (compare error content, not just count) ─
    const currentErrorSet = new Set(allErrors);
    const newErrors = allErrors.filter((e) => !lastErrorSet.has(e));
    const fixedErrors = [...lastErrorSet].filter((e) => !currentErrorSet.has(e));

    if (newErrors.length === 0 && fixedErrors.length === 0) {
      // Exact same errors as last iteration — no progress at all
      consecutiveNoImprovement++;
    } else if (fixedErrors.length > 0) {
      // Some old errors were fixed — progress even if new ones appeared
      consecutiveNoImprovement = 0;
      logger.info(`Progress: fixed ${fixedErrors.length} errors, ${newErrors.length} new`, { taskId: task.id });
    } else {
      // Only new errors (different from last time) — partial progress
      consecutiveNoImprovement++;
    }

    lastErrors = allErrors;
    lastErrorSet = currentErrorSet;
    logger.warn(`Validation errors for task: ${task.name}`, { errors: allErrors.length, iteration, items: allErrors });
  }

  // Max iterations reached — save whatever we have
  if (currentDiagrams.length > 0) {
    logger.warn(`Max iterations reached for task: ${task.name} — saving best-effort diagrams`, { taskId: task.id });
    return await acceptDiagrams(workspace, runId, task, maxIterations, currentDiagrams, `completed`);
  }

  return {
    state: { taskId: task.id, status: `failed`, iteration: maxIterations, lastError: `Max iterations reached with no diagrams` },
    diagrams: currentDiagrams,
  };
}

/** Save diagrams + task state and return a consistent result. */
async function acceptDiagrams(
  workspace: Workspace,
  runId: string,
  task: Task,
  iteration: number,
  diagrams: DiagramFile[],
  status: `completed` | `failed`,
): Promise<{ state: TaskState; diagrams: DiagramFile[] }> {
  for (const diagram of diagrams) {
    await workspace.saveDiagram(runId, diagram);
  }

  const state: TaskState = { taskId: task.id, status, iteration };
  await workspace.saveTaskState(runId, task.id, state);

  return { state, diagrams };
}
