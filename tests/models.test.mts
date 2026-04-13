import { describe, expect, it } from 'bun:test';
import { PROVIDER_MODEL_MAP, getFallbackTiers, FALLBACK_TIERS } from '../src/config/models.mts';
import type { LlmProvider, AgentRole } from '../src/config/models.mts';

describe(`PROVIDER_MODEL_MAP`, () => {
  const providers: LlmProvider[] = [`ollama`, `openai`, `anthropic`];
  const roles: AgentRole[] = [`planning`, `diagram`, `validation`, `documentation`];

  it(`should have an entry for every provider`, () => {
    for (const provider of providers) {
      expect(PROVIDER_MODEL_MAP[provider]).toBeDefined();
    }
  });

  it(`should have an entry for every role under every provider`, () => {
    for (const provider of providers) {
      for (const role of roles) {
        const config = PROVIDER_MODEL_MAP[provider][role];
        expect(config).toBeDefined();
        expect(config.model).toBeString();
        expect(config.model.length).toBeGreaterThan(0);
        expect(config.temperature).toBeNumber();
      }
    }
  });

  it(`should use Ollama model names only for the ollama provider`, () => {
    const ollamaModels = PROVIDER_MODEL_MAP[`ollama`];
    for (const role of roles) {
      const model = ollamaModels[role].model;
      // Ollama models use colons (qwen3.5:27b) or no prefix — never gpt-* or claude-*
      expect(model).not.toMatch(/^gpt-/);
      expect(model).not.toMatch(/^claude-/);
    }
  });

  it(`should use OpenAI model names only for the openai provider`, () => {
    const openaiModels = PROVIDER_MODEL_MAP[`openai`];
    for (const role of roles) {
      const model = openaiModels[role].model;
      expect(model).toMatch(/^gpt-/);
    }
  });

  it(`should use Anthropic model names only for the anthropic provider`, () => {
    const anthropicModels = PROVIDER_MODEL_MAP[`anthropic`];
    for (const role of roles) {
      const model = anthropicModels[role].model;
      expect(model).toMatch(/^claude-/);
    }
  });
});

describe(`FALLBACK_TIERS`, () => {
  it(`should have entries for all three providers`, () => {
    const tierProviders = new Set(FALLBACK_TIERS.map((t) => t.provider));
    expect(tierProviders.has(`ollama`)).toBe(true);
    expect(tierProviders.has(`openai`)).toBe(true);
    expect(tierProviders.has(`anthropic`)).toBe(true);
  });

  it(`should use provider-appropriate model names in every tier`, () => {
    for (const tier of FALLBACK_TIERS) {
      if (tier.provider === `ollama`) {
        expect(tier.model).not.toMatch(/^gpt-/);
        expect(tier.model).not.toMatch(/^claude-/);
      } else if (tier.provider === `openai`) {
        expect(tier.model).toMatch(/^gpt-/);
      } else if (tier.provider === `anthropic`) {
        expect(tier.model).toMatch(/^claude-/);
      }
    }
  });
});

describe(`getFallbackTiers`, () => {
  it(`should exclude the primary provider`, () => {
    const tiers = getFallbackTiers(`openai`);
    for (const tier of tiers) {
      expect(tier.provider).not.toBe(`openai`);
    }
  });

  it(`should return tiers with provider-appropriate models`, () => {
    const tiers = getFallbackTiers(`ollama`);
    for (const tier of tiers) {
      if (tier.provider === `openai`) {
        expect(tier.model).toMatch(/^gpt-/);
      } else if (tier.provider === `anthropic`) {
        expect(tier.model).toMatch(/^claude-/);
      }
    }
  });

  it(`should return at least one fallback tier for each primary`, () => {
    for (const primary of [`ollama`, `openai`, `anthropic`] as const) {
      const tiers = getFallbackTiers(primary);
      expect(tiers.length).toBeGreaterThan(0);
    }
  });
});
