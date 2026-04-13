import { ChatOpenAI } from '@langchain/openai';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { ILlmFactory } from '../interfaces/i-llm-factory.mts';

export class OpenAIFactory implements ILlmFactory {

  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(apiKey: string, timeoutMs: number) {
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
  }

  create(model: string, temperature: number): BaseChatModel {
    return new ChatOpenAI({
      model,
      temperature,
      openAIApiKey: this.apiKey,
      timeout: this.timeoutMs,
    });
  }

  createWithThinking(model: string, temperature: number): BaseChatModel {
    return this.create(model, temperature);
  }
}
