export type AgentRole = `planning` | `diagram` | `validation` | `documentation`;

interface ModelConfig {
  readonly model: string;
  readonly temperature: number;
}

type ProviderModelMap = Record<string, Record<AgentRole, ModelConfig>>;

export const PROVIDER_MODEL_MAP: ProviderModelMap = {
  ollama: {
    planning: { model: `qwen3.5:27b`, temperature: 0.3 },
    diagram: { model: `qwen3-coder-next`, temperature: 0.2 },
    validation: { model: `qwen3-coder-next`, temperature: 0.1 },
    documentation: { model: `qwen3.5:27b`, temperature: 0.1 },
  },
  openai: {
    planning: { model: `gpt-5.4`, temperature: 0.3 },
    diagram: { model: `gpt-5.4`, temperature: 0.2 },
    validation: { model: `gpt-5.4`, temperature: 0.1 },
    documentation: { model: `gpt-5.4`, temperature: 0.1 },
  },
  anthropic: {
    planning: { model: `claude-sonnet-4-6`, temperature: 0.3 },
    diagram: { model: `claude-sonnet-4-6`, temperature: 0.2 },
    validation: { model: `claude-sonnet-4-6`, temperature: 0.1 },
    documentation: { model: `claude-sonnet-4-6`, temperature: 0.1 },
  },
};

export interface FallbackTier {
  readonly provider: string;
  readonly model: string;
  readonly maxIterations: number;
}

export const FALLBACK_TIERS: readonly FallbackTier[] = [
  { provider: `ollama`, model: `qwen3-coder-next`, maxIterations: 20 },
  { provider: `openai`, model: `gpt-5.4`, maxIterations: 16 },
  { provider: `anthropic`, model: `claude-sonnet-4-6`, maxIterations: 16 },
];
