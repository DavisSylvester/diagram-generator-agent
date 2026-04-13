import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { Logger } from 'winston';
import { BaseAgent } from './base-agent.mts';
import type { DiagramFile } from '../types/index.mts';

export interface ValidationInput {
  readonly diagram: DiagramFile;
  readonly prdContent: string;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly suggestions: readonly string[];
}

const VALIDATION_SYSTEM_PROMPT = `You are a diagram validation expert. Your job is to validate architecture diagrams against a PRD (Product Requirements Document).

Check for:
1. **Completeness** — Are all major components from the PRD represented?
2. **Accuracy** — Do the relationships between components match the PRD?
3. **Syntax** — Is the diagram syntax valid for its format (Mermaid/PlantUML/D2)?
4. **Best practices** — Does the diagram follow standard diagramming conventions?
5. **Clarity** — Is the diagram readable and well-organized?

Respond with JSON:
\`\`\`json
{
  "valid": true|false,
  "errors": ["critical issues that must be fixed"],
  "warnings": ["non-critical issues that should be addressed"],
  "suggestions": ["optional improvements"]
}
\`\`\``;

export class ValidationAgent extends BaseAgent<ValidationInput, ValidationResult> {

  constructor(
    logger: Logger,
    modelChain: readonly { model: BaseChatModel; name: string }[],
    timeoutMs: number,
  ) {
    super(logger, modelChain, timeoutMs);
  }

  protected async execute(input: ValidationInput, model: BaseChatModel): Promise<ValidationResult> {
    const messages = [
      new SystemMessage(VALIDATION_SYSTEM_PROMPT),
      new HumanMessage(
        `## Diagram to Validate\n\n` +
        `**Type:** ${input.diagram.diagramType}\n` +
        `**Format:** ${input.diagram.format}\n` +
        `**Title:** ${input.diagram.title}\n\n` +
        `\`\`\`${input.diagram.format}\n${input.diagram.content}\n\`\`\`\n\n` +
        `## PRD for Reference\n\n${input.prdContent}`,
      ),
    ];

    const response = await model.invoke(messages);
    const content = typeof response.content === `string`
      ? response.content
      : JSON.stringify(response.content);

    const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) ?? content.match(/(\{[\s\S]*\})/);
    if (!jsonMatch?.[1]) {
      throw new Error(`Failed to extract validation result from LLM response`);
    }

    const parsed = JSON.parse(jsonMatch[1].trim()) as ValidationResult;

    return {
      valid: parsed.valid ?? false,
      errors: parsed.errors ?? [],
      warnings: parsed.warnings ?? [],
      suggestions: parsed.suggestions ?? [],
    };
  }
}
