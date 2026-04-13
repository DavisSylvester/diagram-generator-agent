import type { Logger } from 'winston';
import type { Task, TaskState } from '../types/index.mts';

interface ExecutorOptions {
  readonly concurrency: number;
  readonly completedTaskIds: ReadonlySet<string>;
}

type TaskRunner = (task: Task) => Promise<TaskState>;

export class ParallelExecutor {

  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  async execute(
    tasks: readonly Task[],
    runner: TaskRunner,
    options: ExecutorOptions,
  ): Promise<Map<string, TaskState>> {
    const { concurrency, completedTaskIds } = options;
    const results = new Map<string, TaskState>();
    const pending = new Map<string, Task>();
    const running = new Set<string>();

    // Initialize pending tasks (skip already completed)
    for (const task of tasks) {
      if (completedTaskIds.has(task.id)) {
        results.set(task.id, {
          taskId: task.id,
          status: `completed`,
          iteration: 0,
        });
        this.logger.info(`Skipping completed task: ${task.name}`, { taskId: task.id });
      } else {
        pending.set(task.id, task);
      }
    }

    const isReady = (task: Task): boolean => {
      return task.dependsOn.every((depId) => {
        const depState = results.get(depId);
        return depState?.status === `completed`;
      });
    };

    const hasFailed = (task: Task): boolean => {
      return task.dependsOn.some((depId) => {
        const depState = results.get(depId);
        return depState?.status === `failed`;
      });
    };

    while (pending.size > 0 || running.size > 0) {
      // Skip tasks whose dependencies failed
      for (const [taskId, task] of pending) {
        if (hasFailed(task)) {
          pending.delete(taskId);
          results.set(taskId, {
            taskId,
            status: `skipped`,
            iteration: 0,
            lastError: `Dependency failed`,
          });
          this.logger.warn(`Skipping task due to failed dependency: ${task.name}`, { taskId });
        }
      }

      // Launch ready tasks up to concurrency limit
      const launchable: Task[] = [];
      for (const [, task] of pending) {
        if (running.size + launchable.length >= concurrency) break;
        if (isReady(task)) {
          launchable.push(task);
        }
      }

      const promises: Promise<void>[] = [];
      for (const task of launchable) {
        pending.delete(task.id);
        running.add(task.id);

        this.logger.info(`Starting task: ${task.name}`, {
          taskId: task.id,
          type: task.diagramType,
          running: running.size,
          pending: pending.size,
        });

        const promise = runner(task)
          .then((state) => {
            running.delete(task.id);
            results.set(task.id, state);

            const icon = state.status === `completed` ? `+` : `-`;
            this.logger.info(`[${icon}] Task ${state.status}: ${task.name}`, {
              taskId: task.id,
              status: state.status,
              iterations: state.iteration,
            });
          })
          .catch((error) => {
            running.delete(task.id);
            results.set(task.id, {
              taskId: task.id,
              status: `failed`,
              iteration: 0,
              lastError: error instanceof Error ? error.message : String(error),
            });
            this.logger.error(`Task crashed: ${task.name}`, { taskId: task.id, error });
          });

        promises.push(promise);
      }

      if (promises.length > 0) {
        await Promise.race(promises);
        // Small yield to allow other tasks to settle
        await new Promise((resolve) => setTimeout(resolve, 10));
      } else if (running.size > 0) {
        // Wait for a running task to complete
        await new Promise((resolve) => setTimeout(resolve, 100));
      } else {
        // Deadlock detection: no tasks can run and none are running
        this.logger.error(`Deadlock detected: ${pending.size} tasks pending but none can run`);
        for (const [taskId] of pending) {
          results.set(taskId, {
            taskId,
            status: `failed`,
            iteration: 0,
            lastError: `Deadlock: unresolvable dependencies`,
          });
        }
        break;
      }
    }

    return results;
  }
}
