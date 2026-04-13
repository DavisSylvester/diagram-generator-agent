import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { Logger } from 'winston';
import { BaseAgent } from './base-agent.mts';
import type { TaskGraph, Task } from '../types/index.mts';
import { PLANNING_SYSTEM_PROMPT } from '../prompts/planning.mts';

interface PlanningInput {
  readonly prdContent: string;
  readonly runId: string;
  readonly outputFormat: string;
}

export class PlanningAgent extends BaseAgent<PlanningInput, TaskGraph> {

  constructor(
    logger: Logger,
    modelChain: readonly { model: BaseChatModel; name: string }[],
    timeoutMs: number,
  ) {
    super(logger, modelChain, timeoutMs);
  }

  protected async execute(input: PlanningInput, model: BaseChatModel): Promise<TaskGraph> {
    const messages = [
      new SystemMessage(PLANNING_SYSTEM_PROMPT),
      new HumanMessage(
        `Generate a diagram task plan for the following PRD.\n\n` +
        `Output format: ${input.outputFormat}\n\n` +
        `---\n\n${input.prdContent}`,
      ),
    ];

    const response = await model.invoke(messages);
    const content = typeof response.content === `string`
      ? response.content
      : JSON.stringify(response.content);

    // Extract JSON from response
    const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) ?? content.match(/(\{[\s\S]*\})/);
    if (!jsonMatch?.[1]) {
      throw new Error(`Failed to extract JSON task graph from LLM response`);
    }

    const raw = jsonMatch[1].trim();
    const cleaned = raw
      .replace(/[\x00-\x1f]/g, ` `)
      .replace(/,\s*([}\]])/g, `$1`);

    const parsed = JSON.parse(cleaned) as { tasks: Task[] };

    if (!parsed.tasks || !Array.isArray(parsed.tasks)) {
      throw new Error(`Invalid task graph: missing tasks array`);
    }

    const prdHash = await this.hashPrd(input.prdContent);

    return {
      runId: input.runId,
      prdHash,
      tasks: parsed.tasks,
    };
  }

  private async hashPrd(content: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest(`SHA-256`, data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, `0`)).join(``);
  }
}
