import { mkdir, readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import type { Logger } from 'winston';
import type { TaskGraph, TaskState, DiagramFile } from '../types/index.mts';

export class Workspace {

  private readonly baseDir: string;
  private readonly logger: Logger;

  constructor(baseDir: string, logger: Logger) {
    this.baseDir = baseDir;
    this.logger = logger;
  }

  async init(runId: string): Promise<string> {
    const runDir = join(this.baseDir, runId);

    await mkdir(join(runDir, `logs`), { recursive: true });
    await mkdir(join(runDir, `output`, `diagrams`), { recursive: true });
    await mkdir(join(runDir, `tasks`), { recursive: true });
    await mkdir(join(this.baseDir, `.plan-cache`), { recursive: true });

    this.logger.info(`Workspace initialized`, { runDir });
    return runDir;
  }

  async savePlan(runId: string, plan: TaskGraph): Promise<void> {
    const planPath = join(this.baseDir, runId, `plan.json`);
    await writeFile(planPath, JSON.stringify(plan, null, 2));
  }

  async loadPlan(runId: string): Promise<TaskGraph | null> {
    try {
      const planPath = join(this.baseDir, runId, `plan.json`);
      const content = await readFile(planPath, `utf-8`);
      return JSON.parse(content) as TaskGraph;
    } catch {
      return null;
    }
  }

  async saveCachedPlan(prdHash: string, plan: TaskGraph): Promise<void> {
    const cachePath = join(this.baseDir, `.plan-cache`, `${prdHash}.json`);
    await writeFile(cachePath, JSON.stringify(plan, null, 2));
  }

  async loadCachedPlan(prdHash: string): Promise<TaskGraph | null> {
    try {
      const cachePath = join(this.baseDir, `.plan-cache`, `${prdHash}.json`);
      const content = await readFile(cachePath, `utf-8`);
      return JSON.parse(content) as TaskGraph;
    } catch {
      return null;
    }
  }

  async saveTaskState(runId: string, taskId: string, state: TaskState): Promise<void> {
    const taskDir = join(this.baseDir, runId, `tasks`, taskId);
    await mkdir(taskDir, { recursive: true });
    await writeFile(join(taskDir, `status.json`), JSON.stringify(state, null, 2));
  }

  async loadTaskState(runId: string, taskId: string): Promise<TaskState | null> {
    try {
      const statusPath = join(this.baseDir, runId, `tasks`, taskId, `status.json`);
      const content = await readFile(statusPath, `utf-8`);
      return JSON.parse(content) as TaskState;
    } catch {
      return null;
    }
  }

  async saveDiagram(runId: string, diagram: DiagramFile): Promise<void> {
    const diagramPath = join(this.baseDir, runId, `output`, diagram.path);
    await mkdir(dirname(diagramPath), { recursive: true });
    await writeFile(diagramPath, diagram.content);
    this.logger.info(`Diagram saved`, { path: diagram.path, type: diagram.diagramType });
  }

  async saveIterationSnapshot(
    runId: string,
    taskId: string,
    iteration: number,
    diagrams: readonly DiagramFile[],
  ): Promise<void> {
    const iterDir = join(this.baseDir, runId, `tasks`, taskId, `iterations`, String(iteration));
    await mkdir(iterDir, { recursive: true });

    for (const diagram of diagrams) {
      const fileName = basename(diagram.path) || `diagram.txt`;
      await writeFile(join(iterDir, fileName), diagram.content);
    }
  }

  async saveConfig(runId: string, config: Record<string, unknown>): Promise<void> {
    const configPath = join(this.baseDir, runId, `config.json`);
    await writeFile(configPath, JSON.stringify(config, null, 2));
  }

  async listRuns(): Promise<string[]> {
    try {
      const entries = await readdir(this.baseDir, { withFileTypes: true });
      const runs: string[] = [];

      for (const entry of entries) {
        if (entry.isDirectory() && entry.name !== `.plan-cache`) {
          runs.push(entry.name);
        }
      }

      return runs;
    } catch {
      return [];
    }
  }

  async getRunStatus(runId: string): Promise<Record<string, TaskState>> {
    const tasksDir = join(this.baseDir, runId, `tasks`);
    const states: Record<string, TaskState> = {};

    try {
      const taskDirs = await readdir(tasksDir, { withFileTypes: true });

      for (const dir of taskDirs) {
        if (dir.isDirectory()) {
          const state = await this.loadTaskState(runId, dir.name);
          if (state) {
            states[dir.name] = state;
          }
        }
      }
    } catch {
      // No tasks directory yet
    }

    return states;
  }

  async saveExecutionSummary(runId: string, summary: Record<string, unknown>): Promise<void> {
    const summaryPath = join(this.baseDir, runId, `execution-summary.json`);
    await writeFile(summaryPath, JSON.stringify(summary, null, 2));
  }

  async saveTokenUsage(runId: string, usage: Record<string, unknown>): Promise<void> {
    const usagePath = join(this.baseDir, runId, `token-usage.json`);
    await writeFile(usagePath, JSON.stringify(usage, null, 2));
  }
}
