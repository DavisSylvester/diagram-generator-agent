import { ChatAnthropic } from '@langchain/anthropic';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { ILlmFactory } from '../interfaces/i-llm-factory.mts';

export class AnthropicFactory implements ILlmFactory {

  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(apiKey: string, timeoutMs: number) {
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
  }

  create(model: string, temperature: number): BaseChatModel {
    return new ChatAnthropic({
      model,
      temperature,
      anthropicApiKey: this.apiKey,
    });
  }

  createWithThinking(model: string, temperature: number): BaseChatModel {
    return new ChatAnthropic({
      model,
      temperature,
      anthropicApiKey: this.apiKey,
      thinking: {
        type: `enabled`,
        budget_tokens: 8192,
      },
    });
  }
}
