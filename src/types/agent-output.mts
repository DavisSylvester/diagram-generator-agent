export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface AgentOutput<T> {
  readonly result: T;
  readonly model: string;
  readonly durationMs: number;
  readonly tokenUsage: TokenUsage;
}
