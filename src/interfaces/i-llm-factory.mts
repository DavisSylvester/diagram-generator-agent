import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

export interface ILlmFactory {
  create(model: string, temperature: number): BaseChatModel;
  createWithThinking(model: string, temperature: number): BaseChatModel;
}
