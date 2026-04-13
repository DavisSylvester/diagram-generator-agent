export type DiagramType =
  | `system-context`
  | `container`
  | `component`
  | `sequence`
  | `er-diagram`
  | `class-diagram`
  | `flow`
  | `deployment`;

export type TaskType =
  | `planning`
  | `diagram-generation`
  | `validation`
  | `export`;

export type TaskStatus =
  | `pending`
  | `running`
  | `completed`
  | `failed`
  | `skipped`;

export interface Task {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly dependsOn: readonly string[];
  readonly type: TaskType;
  readonly diagramType: DiagramType;
  readonly metadata: Record<string, unknown>;
}

export interface TaskGraph {
  readonly runId: string;
  readonly prdHash: string;
  readonly tasks: readonly Task[];
}

export interface TaskState {
  readonly taskId: string;
  readonly status: TaskStatus;
  readonly iteration: number;
  readonly lastError?: string;
  readonly circuitBroken?: boolean;
}
