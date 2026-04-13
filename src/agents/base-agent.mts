import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Logger } from 'winston';
import type { Result, AgentOutput, TokenUsage } from '../types/index.mts';
import { ok, err } from '../types/index.mts';

interface ModelChainEntry {
  readonly model: BaseChatModel;
  readonly name: string;
}

export abstract class BaseAgent<TIn, TOut> {

  protected readonly logger: Logger;
  protected readonly timeoutMs: number;
  private readonly modelChain: readonly ModelChainEntry[];
  private lastTokenUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

  constructor(
    logger: Logger,
    modelChain: readonly ModelChainEntry[],
    timeoutMs: number,
  ) {
    this.logger = logger;
    this.modelChain = modelChain;
    this.timeoutMs = timeoutMs;
  }

  protected abstract execute(
    input: TIn,
    model: BaseChatModel,
  ): Promise<TOut>;

  async run(input: TIn): Promise<Result<AgentOutput<TOut>, Error>> {
    for (const entry of this.modelChain) {
      const startMs = Date.now();

      try {
        this.logger.info(`Agent executing with model: ${entry.name}`);
        const result = await this.withTimeout(this.execute(input, entry.model));
        const durationMs = Date.now() - startMs;

        return ok({
          result,
          model: entry.name,
          durationMs,
          tokenUsage: this.lastTokenUsage,
        });
      } catch (error) {
        const durationMs = Date.now() - startMs;
        this.logger.warn(`Model ${entry.name} failed after ${durationMs}ms`, {
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }

    return err(new Error(`All models in chain exhausted`));
  }

  protected setTokenUsage(usage: TokenUsage): void {
    this.lastTokenUsage = usage;
  }

  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`LLM call timed out after ${this.timeoutMs}ms`)),
        this.timeoutMs,
      );

      promise
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }
}
