import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { rm, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger, transports } from 'winston';
import { Workspace } from '../src/io/workspace.mts';
import type { DiagramFile, TaskState, DiagramType } from '../src/types/index.mts';

const TEST_DIR = `.workspace-test`;
const TEST_RUN_ID = `test-run-001`;

const silentLogger = createLogger({ silent: true, transports: [new transports.Console()] });

function makeDiagram(diagramType: DiagramType, fileName: string): DiagramFile {
  return {
    path: `diagrams/${fileName}`,
    content: `graph TD\n  A --> B`,
    diagramType,
    format: `mermaid`,
    title: `${diagramType} diagram`,
  };
}

describe(`Workspace`, () => {
  let workspace: Workspace;

  beforeEach(async () => {
    workspace = new Workspace(TEST_DIR, silentLogger);
    await workspace.init(TEST_RUN_ID);
  });

  afterEach(async () => {
    await rm(TEST_DIR, { recursive: true, force: true });
  });

  it(`should initialize workspace directories`, async () => {
    const logsDir = join(TEST_DIR, TEST_RUN_ID, `logs`);
    const outputDir = join(TEST_DIR, TEST_RUN_ID, `output`, `diagrams`);
    const tasksDir = join(TEST_DIR, TEST_RUN_ID, `tasks`);

    const [logsStat, outputStat, tasksStat] = await Promise.all([
      stat(logsDir),
      stat(outputDir),
      stat(tasksDir),
    ]);

    expect(logsStat.isDirectory()).toBe(true);
    expect(outputStat.isDirectory()).toBe(true);
    expect(tasksStat.isDirectory()).toBe(true);
  });

  it(`should save and read back a diagram file`, async () => {
    const diagram = makeDiagram(`system-context`, `system-context.mmd`);

    await workspace.saveDiagram(TEST_RUN_ID, diagram);

    const savedPath = join(TEST_DIR, TEST_RUN_ID, `output`, `diagrams`, `system-context.mmd`);
    const content = await readFile(savedPath, `utf-8`);
    expect(content).toBe(diagram.content);
  });

  it(`should save diagrams whose path contains forward slashes (cross-platform)`, async () => {
    // This is the exact scenario that crashed on Windows:
    // diagram.path = "diagrams/system-context.mmd" with a forward slash,
    // but path.join normalizes to backslash on Windows.
    // The old code used lastIndexOf('/') to find the parent dir — fails on Windows.
    const diagram: DiagramFile = {
      path: `diagrams/system-context.mmd`,
      content: `graph TD\n  Client --> API`,
      diagramType: `system-context`,
      format: `mermaid`,
      title: `System Context`,
    };

    // Must not throw
    await workspace.saveDiagram(TEST_RUN_ID, diagram);

    const savedPath = join(TEST_DIR, TEST_RUN_ID, `output`, `diagrams`, `system-context.mmd`);
    const content = await readFile(savedPath, `utf-8`);
    expect(content).toBe(diagram.content);
  });

  it(`should save diagrams in nested subdirectories`, async () => {
    const diagram: DiagramFile = {
      path: `diagrams/sequences/auth-flow.mmd`,
      content: `sequenceDiagram\n  Client->>API: login`,
      diagramType: `sequence`,
      format: `mermaid`,
      title: `Auth Flow`,
    };

    await workspace.saveDiagram(TEST_RUN_ID, diagram);

    const savedPath = join(TEST_DIR, TEST_RUN_ID, `output`, `diagrams`, `sequences`, `auth-flow.mmd`);
    const content = await readFile(savedPath, `utf-8`);
    expect(content).toBe(diagram.content);
  });

  it(`should save iteration snapshots with correct filenames`, async () => {
    const diagrams: DiagramFile[] = [
      makeDiagram(`system-context`, `system-context.mmd`),
      makeDiagram(`container`, `container.mmd`),
    ];

    await workspace.saveIterationSnapshot(TEST_RUN_ID, `task-1`, 0, diagrams);

    const iterDir = join(TEST_DIR, TEST_RUN_ID, `tasks`, `task-1`, `iterations`, `0`);
    const file1 = await readFile(join(iterDir, `system-context.mmd`), `utf-8`);
    const file2 = await readFile(join(iterDir, `container.mmd`), `utf-8`);

    expect(file1).toBe(diagrams[0]!.content);
    expect(file2).toBe(diagrams[1]!.content);
  });

  it(`should save and load task state`, async () => {
    const state: TaskState = {
      taskId: `task-1`,
      status: `completed`,
      iteration: 2,
    };

    await workspace.saveTaskState(TEST_RUN_ID, `task-1`, state);
    const loaded = await workspace.loadTaskState(TEST_RUN_ID, `task-1`);

    expect(loaded).not.toBeNull();
    expect(loaded!.taskId).toBe(`task-1`);
    expect(loaded!.status).toBe(`completed`);
    expect(loaded!.iteration).toBe(2);
  });

  it(`should return null for missing task state`, async () => {
    const loaded = await workspace.loadTaskState(TEST_RUN_ID, `nonexistent`);
    expect(loaded).toBeNull();
  });

  it(`should list runs`, async () => {
    const runs = await workspace.listRuns();
    expect(runs).toContain(TEST_RUN_ID);
  });

  it(`should get run status across multiple tasks`, async () => {
    await workspace.saveTaskState(TEST_RUN_ID, `task-1`, {
      taskId: `task-1`,
      status: `completed`,
      iteration: 1,
    });
    await workspace.saveTaskState(TEST_RUN_ID, `task-2`, {
      taskId: `task-2`,
      status: `failed`,
      iteration: 5,
      lastError: `Max iterations`,
    });

    const status = await workspace.getRunStatus(TEST_RUN_ID);
    expect(Object.keys(status).length).toBe(2);
    expect(status[`task-1`]!.status).toBe(`completed`);
    expect(status[`task-2`]!.status).toBe(`failed`);
  });

  it(`should save and load cached plans`, async () => {
    const plan = {
      runId: TEST_RUN_ID,
      prdHash: `abc123`,
      tasks: [],
    };

    await workspace.saveCachedPlan(`abc123`, plan);
    const loaded = await workspace.loadCachedPlan(`abc123`);

    expect(loaded).not.toBeNull();
    expect(loaded!.prdHash).toBe(`abc123`);
  });
});
