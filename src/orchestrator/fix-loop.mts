import type { Logger } from 'winston';
import type { DiagramAgent, DiagramInput } from '../agents/diagram-agent.mts';
import type { ValidationAgent } from '../agents/validation-agent.mts';
import type { CostTracker } from '../llm/cost-tracker.mts';
import type { Workspace } from '../io/workspace.mts';
import type { Task, TaskState, DiagramFile, DiagramFormat } from '../types/index.mts';

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
      logger.warn(`Circuit breaker tripped for task: ${task.name}`, { taskId: task.id, iteration });
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
      // Save final diagrams
      for (const diagram of currentDiagrams) {
        await workspace.saveDiagram(runId, diagram);
      }

      await workspace.saveTaskState(runId, task.id, {
        taskId: task.id,
        status: `completed`,
        iteration,
      });

      return {
        state: { taskId: task.id, status: `completed`, iteration },
        diagrams: currentDiagrams,
      };
    }

    const allErrors: string[] = [];
    for (const diagram of currentDiagrams) {
      const validationResult = await validationAgent.run({
        diagram,
        prdContent,
      });

      if (validationResult.ok) {
        costTracker.record(
          validationResult.value.model,
          validationResult.value.tokenUsage.inputTokens,
          validationResult.value.tokenUsage.outputTokens,
          task.id,
        );

        if (!validationResult.value.result.valid) {
          allErrors.push(...validationResult.value.result.errors);
        }
      }
    }

    if (allErrors.length === 0) {
      logger.info(`Task completed successfully: ${task.name}`, { taskId: task.id, iteration });

      for (const diagram of currentDiagrams) {
        await workspace.saveDiagram(runId, diagram);
      }

      await workspace.saveTaskState(runId, task.id, {
        taskId: task.id,
        status: `completed`,
        iteration,
      });

      return {
        state: { taskId: task.id, status: `completed`, iteration },
        diagrams: currentDiagrams,
      };
    }

    // Track improvement
    if (allErrors.length >= lastErrors.length) {
      consecutiveNoImprovement++;
    } else {
      consecutiveNoImprovement = 0;
    }

    lastErrors = allErrors;
    logger.warn(`Validation errors for task: ${task.name}`, { errors: allErrors.length, iteration });
  }

  // Max iterations reached
  for (const diagram of currentDiagrams) {
    await workspace.saveDiagram(runId, diagram);
  }

  return {
    state: { taskId: task.id, status: `failed`, iteration: maxIterations, lastError: `Max iterations reached` },
    diagrams: currentDiagrams,
  };
}
