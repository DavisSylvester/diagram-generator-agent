import { ChatOllama } from '@langchain/ollama';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { ILlmFactory } from '../interfaces/i-llm-factory.mts';

export class OllamaFactory implements ILlmFactory {

  private readonly host: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;

  constructor(host: string, apiKey: string | undefined, timeoutMs: number) {
    this.host = host;
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
  }

  create(model: string, temperature: number): BaseChatModel {
    const headers: Record<string, string> = {};
    if (this.apiKey) {
      headers[`Authorization`] = `Bearer ${this.apiKey}`;
    }

    return new ChatOllama({
      model,
      temperature,
      baseUrl: this.host,
      numCtx: 8192,
      headers,
    });
  }

  createWithThinking(model: string, temperature: number): BaseChatModel {
    return this.create(model, temperature);
  }
}
