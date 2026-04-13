export interface PipelineConfig {
  readonly maxFixIterations: number;
  readonly maxConcurrency: number;
  readonly maxTasks: number;
  readonly llmTimeoutMs: number;
  readonly workspaceDir: string;
  readonly taskCostLimit: number;
  readonly noDocs: boolean;
  readonly noValidate: boolean;
}
