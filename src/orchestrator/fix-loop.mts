import type { Logger } from 'winston';
import type { DiagramAgent, DiagramInput } from '../agents/diagram-agent.mts';
import type { ValidationAgent, ValidationResult } from '../agents/validation-agent.mts';
import type { SyntaxValidator } from '../verification/syntax-validator.mts';
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
 * Maximum number of LLM validation errors that still allow acceptance
 * after the good-enough threshold. Syntax errors are never forgiven.
 */
const ACCEPTABLE_LLM_ERROR_CEILING = 2;

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
  readonly syntaxValidator: SyntaxValidator;
  readonly costTracker: CostTracker;
  readonly workspace: Workspace;
  readonly logger: Logger;
}

export async function runFixLoop(
  options: FixLoopOptions,
  deps: FixLoopDeps,
): Promise<{ state: TaskState; diagrams: DiagramFile[] }> {
  const { runId, task, prdContent, outputFormat, maxIterations, taskCostLimit, noValidate } = options;
  const { diagramAgent, validationAgent, syntaxValidator, costTracker, workspace, logger } = deps;

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
      if (currentDiagrams.length > 0) {
        logger.warn(`Circuit breaker tripped for task: ${task.name} — saving best-effort diagrams`, { taskId: task.id, iteration });
        return await acceptDiagrams(workspace, runId, task, iteration, currentDiagrams, `completed`);
      }
      return {
        state: { taskId: task.id, status: `failed`, iteration, lastError: `Circuit breaker: no improvement`, circuitBroken: true },
        diagrams: currentDiagrams,
      };
    }

    // ── Step 1: Generate / Fix diagram ───────────────────────────
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

    // ── Step 2: Syntax / render validation (always runs) ─────────
    // This is a hard gate — diagrams must parse/render correctly before
    // we spend tokens on LLM validation or accept the result.
    const syntaxErrors: string[] = [];

    for (const diagram of currentDiagrams) {
      const syntaxResult = await syntaxValidator.validate(diagram);

      if (!syntaxResult.valid) {
        const errorMessages = syntaxResult.errors.map((e) => {
          const loc = e.line ? ` (line ${e.line})` : ``;
          return `[${diagram.diagramType}]${loc} ${e.message}`;
        });
        syntaxErrors.push(...errorMessages);

        logger.warn(`Syntax errors in ${diagram.diagramType} [${syntaxResult.method}]`, {
          taskId: task.id,
          errors: errorMessages,
        });
      } else {
        logger.info(`Syntax valid: ${diagram.diagramType} [${syntaxResult.method}]`, { taskId: task.id });
      }
    }

    if (syntaxErrors.length > 0) {
      // Syntax errors go straight back to the diagram agent — no LLM validation
      logger.warn(`Syntax validation failed for task: ${task.name} — resubmitting`, {
        taskId: task.id,
        iteration,
        syntaxErrors: syntaxErrors.length,
      });

      // Track improvement for circuit breaker
      const currentErrorSet = new Set(syntaxErrors);
      const fixedCount = [...lastErrorSet].filter((e) => !currentErrorSet.has(e)).length;
      if (fixedCount > 0) {
        consecutiveNoImprovement = 0;
      } else {
        consecutiveNoImprovement++;
      }

      lastErrors = syntaxErrors;
      lastErrorSet = currentErrorSet;
      continue;
    }

    // ── Step 3: LLM validation (optional — only after syntax passes) ─
    if (noValidate) {
      logger.info(`LLM validation skipped for task: ${task.name} (syntax passed)`);
      return await acceptDiagrams(workspace, runId, task, iteration, currentDiagrams, `completed`);
    }

    const llmErrors: string[] = [];
    const llmWarnings: string[] = [];

    for (const diagram of currentDiagrams) {
      const validationResult = await validationAgent.run({
        diagram,
        prdContent,
      });

      if (!validationResult.ok) {
        logger.warn(`Validation agent failed for ${diagram.diagramType} — accepting diagram (fail-open)`, {
          taskId: task.id,
          error: validationResult.error.message,
        });
        continue;
      }

      costTracker.record(
        validationResult.value.model,
        validationResult.value.tokenUsage.inputTokens,
        validationResult.value.tokenUsage.outputTokens,
        task.id,
      );

      const vr: ValidationResult = validationResult.value.result;

      if (!vr.valid && vr.errors.length > 0) {
        llmErrors.push(...vr.errors);
      }
      if (vr.warnings.length > 0) {
        llmWarnings.push(...vr.warnings);
      }
    }

    if (llmWarnings.length > 0) {
      logger.info(`LLM validation warnings for task: ${task.name}`, { warnings: llmWarnings.length, items: llmWarnings });
    }

    // ── Accept if clean ──────────────────────────────────────────
    if (llmErrors.length === 0) {
      logger.info(`Task completed successfully: ${task.name}`, { taskId: task.id, iteration });
      return await acceptDiagrams(workspace, runId, task, iteration, currentDiagrams, `completed`);
    }

    // ── Good-enough threshold (LLM errors only — syntax already passed) ─
    if (iteration >= GOOD_ENOUGH_AFTER_ITERATION && llmErrors.length <= ACCEPTABLE_LLM_ERROR_CEILING) {
      logger.info(
        `Task accepted (good enough after ${iteration + 1} iterations, syntax clean): ${task.name}`,
        { taskId: task.id, iteration, remainingLlmErrors: llmErrors.length, errors: llmErrors },
      );
      return await acceptDiagrams(workspace, runId, task, iteration, currentDiagrams, `completed`);
    }

    // ── Track improvement (compare error content, not just count) ─
    const allErrors = llmErrors;
    const currentErrorSet = new Set(allErrors);
    const newErrors = allErrors.filter((e) => !lastErrorSet.has(e));
    const fixedErrors = [...lastErrorSet].filter((e) => !currentErrorSet.has(e));

    if (newErrors.length === 0 && fixedErrors.length === 0) {
      consecutiveNoImprovement++;
    } else if (fixedErrors.length > 0) {
      consecutiveNoImprovement = 0;
      logger.info(`Progress: fixed ${fixedErrors.length} errors, ${newErrors.length} new`, { taskId: task.id });
    } else {
      consecutiveNoImprovement++;
    }

    lastErrors = allErrors;
    lastErrorSet = currentErrorSet;
    logger.warn(`LLM validation errors for task: ${task.name}`, { errors: allErrors.length, iteration, items: allErrors });
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
