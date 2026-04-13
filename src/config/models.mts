export type LlmProvider = `ollama` | `openai` | `anthropic`;

export type AgentRole = `planning` | `diagram` | `validation` | `documentation`;

export interface ModelConfig {
  readonly model: string;
  readonly temperature: number;
}

type ProviderModelMap = Record<LlmProvider, Record<AgentRole, ModelConfig>>;

export const PROVIDER_MODEL_MAP: ProviderModelMap = {
  ollama: {
    planning: { model: `qwen3.5:27b`, temperature: 0.3 },
    diagram: { model: `qwen3-coder-next`, temperature: 0.2 },
    validation: { model: `qwen3-coder-next`, temperature: 0.1 },
    documentation: { model: `qwen3.5:27b`, temperature: 0.1 },
  },
  openai: {
    planning: { model: `gpt-4.1`, temperature: 0.3 },
    diagram: { model: `gpt-4.1`, temperature: 0.2 },
    validation: { model: `gpt-4.1-mini`, temperature: 0.1 },
    documentation: { model: `gpt-4.1`, temperature: 0.1 },
  },
  anthropic: {
    planning: { model: `claude-sonnet-4-6`, temperature: 0.3 },
    diagram: { model: `claude-sonnet-4-6`, temperature: 0.2 },
    validation: { model: `claude-haiku-4-5`, temperature: 0.1 },
    documentation: { model: `claude-sonnet-4-6`, temperature: 0.1 },
  },
};

export interface FallbackTier {
  readonly provider: LlmProvider;
  readonly role: AgentRole;
  readonly model: string;
  readonly temperature: number;
  readonly maxIterations: number;
}

/**
 * Cross-provider fallback tiers used when the primary model stalls.
 * Each tier specifies a provider-appropriate model name — never mix
 * Ollama model names with the OpenAI/Anthropic APIs.
 */
export const FALLBACK_TIERS: readonly FallbackTier[] = [
  { provider: `ollama`, role: `diagram`, model: `qwen3-coder-next`, temperature: 0.2, maxIterations: 20 },
  { provider: `openai`, role: `diagram`, model: `gpt-4.1`, temperature: 0.2, maxIterations: 16 },
  { provider: `anthropic`, role: `diagram`, model: `claude-sonnet-4-6`, temperature: 0.2, maxIterations: 16 },
];

/**
 * Returns the ordered fallback tiers for a given primary provider.
 * The primary provider is excluded — these are alternatives to try
 * when the primary is failing.
 */
export function getFallbackTiers(primaryProvider: LlmProvider): readonly FallbackTier[] {
  return FALLBACK_TIERS.filter((tier) => tier.provider !== primaryProvider);
}
