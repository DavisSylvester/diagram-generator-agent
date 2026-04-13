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

## Severity Definitions

Use these definitions strictly when categorizing issues:

**errors** — ONLY for issues that make the diagram factually wrong or unrenderable:
  - Syntax errors that prevent the diagram from rendering (missing closing tags, invalid keywords)
  - Completely wrong relationships (e.g., diagram shows A→B but PRD says B→A)
  - Major components from the PRD that are entirely absent (e.g., a primary database is missing from a container diagram)

**warnings** — For issues that reduce quality but the diagram is still usable:
  - A secondary or supporting component from the PRD is missing
  - Relationship labels are vague but not wrong
  - Minor naming inconsistencies

**suggestions** — For optional improvements only:
  - Styling or layout improvements
  - Additional detail that would enhance clarity
  - Alternative approaches to representing the same information

## Setting "valid"

Set "valid": true if ALL of the following are met:
  1. The diagram syntax is correct and will render without errors
  2. The major components and primary relationships from the PRD are present
  3. No relationships are factually wrong

Set "valid": false ONLY if there are items in the "errors" array.

Do NOT set valid to false for missing minor details, style issues, or suggestions.
Be pragmatic — a diagram that captures 80% of the PRD accurately is valid.

Respond with JSON:
\`\`\`json
{
  "valid": true|false,
  "errors": ["critical issues only — syntax breaks or factually wrong relationships"],
  "warnings": ["quality issues that do not block acceptance"],
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
