import type { Logger } from 'winston';

interface CostEntry {
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cost: number;
  readonly taskId: string;
  readonly timestamp: Date;
}

interface ModelPricing {
  readonly inputPerMillion: number;
  readonly outputPerMillion: number;
}

const PRICING: Record<string, ModelPricing> = {
  // OpenAI
  'gpt-4.1': { inputPerMillion: 2.00, outputPerMillion: 8.00 },
  'gpt-4.1-mini': { inputPerMillion: 0.40, outputPerMillion: 1.60 },
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.60 },
  // Anthropic
  'claude-sonnet-4-6': { inputPerMillion: 3.00, outputPerMillion: 15.00 },
  'claude-haiku-4-5': { inputPerMillion: 0.80, outputPerMillion: 4.00 },
  // Ollama — local models are free
};

export class CostTracker {

  private readonly entries: CostEntry[] = [];
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  record(model: string, inputTokens: number, outputTokens: number, taskId: string): void {
    // Model name may be in "provider/model" format from the chain — extract the model name
    const modelName = model.includes(`/`) ? model.split(`/`).slice(1).join(`/`) : model;
    const pricing = PRICING[modelName];
    const cost = pricing
      ? (inputTokens / 1_000_000) * pricing.inputPerMillion +
        (outputTokens / 1_000_000) * pricing.outputPerMillion
      : 0;

    const entry: CostEntry = {
      model,
      inputTokens,
      outputTokens,
      cost,
      taskId,
      timestamp: new Date(),
    };

    this.entries.push(entry);
    this.logger.debug(`Cost recorded`, { model, inputTokens, outputTokens, cost: cost.toFixed(4), taskId });
  }

  getTaskCost(taskId: string): number {
    return this.entries
      .filter((e) => e.taskId === taskId)
      .reduce((sum, e) => sum + e.cost, 0);
  }

  getTotalCost(): number {
    return this.entries.reduce((sum, e) => sum + e.cost, 0);
  }

  getSummary(): {
    totalCost: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    byModel: Record<string, { cost: number; calls: number }>;
    byTask: Record<string, number>;
  } {
    const byModel: Record<string, { cost: number; calls: number }> = {};
    const byTask: Record<string, number> = {};

    for (const entry of this.entries) {
      const modelEntry = byModel[entry.model] ?? { cost: 0, calls: 0 };
      modelEntry.cost += entry.cost;
      modelEntry.calls += 1;
      byModel[entry.model] = modelEntry;

      byTask[entry.taskId] = (byTask[entry.taskId] ?? 0) + entry.cost;
    }

    return {
      totalCost: this.getTotalCost(),
      totalInputTokens: this.entries.reduce((sum, e) => sum + e.inputTokens, 0),
      totalOutputTokens: this.entries.reduce((sum, e) => sum + e.outputTokens, 0),
      byModel,
      byTask,
    };
  }
}
