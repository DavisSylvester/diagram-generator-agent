import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { Logger } from 'winston';
import { BaseAgent } from './base-agent.mts';
import type { DiagramFile, DiagramType, DiagramFormat } from '../types/index.mts';
import { DIAGRAM_SYSTEM_PROMPT } from '../prompts/diagram.mts';

export interface DiagramInput {
  readonly taskName: string;
  readonly taskDescription: string;
  readonly diagramType: DiagramType;
  readonly outputFormat: DiagramFormat;
  readonly prdContent: string;
  readonly existingDiagrams: readonly DiagramFile[];
  readonly mode: `generate` | `fix`;
  readonly errors?: readonly string[];
}

export class DiagramAgent extends BaseAgent<DiagramInput, DiagramFile[]> {

  constructor(
    logger: Logger,
    modelChain: readonly { model: BaseChatModel; name: string }[],
    timeoutMs: number,
  ) {
    super(logger, modelChain, timeoutMs);
  }

  protected async execute(input: DiagramInput, model: BaseChatModel): Promise<DiagramFile[]> {
    const userPrompt = this.buildUserPrompt(input);

    const messages = [
      new SystemMessage(DIAGRAM_SYSTEM_PROMPT),
      new HumanMessage(userPrompt),
    ];

    const response = await model.invoke(messages);
    const content = typeof response.content === `string`
      ? response.content
      : JSON.stringify(response.content);

    return this.parseDiagramResponse(content, input.diagramType, input.outputFormat);
  }

  private buildUserPrompt(input: DiagramInput): string {
    const parts: string[] = [
      `## Task: ${input.taskName}`,
      `## Description: ${input.taskDescription}`,
      `## Diagram Type: ${input.diagramType}`,
      `## Output Format: ${input.outputFormat}`,
      ``,
      `## PRD Content`,
      input.prdContent,
    ];

    if (input.existingDiagrams.length > 0) {
      parts.push(``, `## Existing Diagrams (for context and consistency)`);
      for (const diagram of input.existingDiagrams) {
        parts.push(`### ${diagram.title} (${diagram.diagramType})`, `\`\`\`${diagram.format}`, diagram.content, `\`\`\``);
      }
    }

    if (input.mode === `fix` && input.errors && input.errors.length > 0) {
      parts.push(``, `## Errors to Fix`, ...input.errors.map((e) => `- ${e}`));
    }

    return parts.join(`\n`);
  }

  private parseDiagramResponse(
    content: string,
    diagramType: DiagramType,
    format: DiagramFormat,
  ): DiagramFile[] {
    const diagrams: DiagramFile[] = [];
    const blockPattern = /```(\S+)\s*\n([\s\S]*?)```/g;

    let match: RegExpExecArray | null;
    while ((match = blockPattern.exec(content)) !== null) {
      const lang = match[1]!;
      const body = match[2]!.trim();

      // Match diagram format markers
      if (
        lang === format ||
        lang === `mermaid` ||
        lang === `plantuml` ||
        lang === `d2` ||
        lang === `svg`
      ) {
        const titleMatch = content
          .slice(0, match.index)
          .match(/(?:^|\n)#+\s+(.+?)(?:\n|$)/g);

        const title = titleMatch
          ? titleMatch[titleMatch.length - 1]!.replace(/^#+\s+/, ``).trim()
          : `${diagramType} diagram`;

        const fileName = `${diagramType}.${this.getExtension(lang as DiagramFormat)}`;

        diagrams.push({
          path: `diagrams/${fileName}`,
          content: body,
          diagramType,
          format: lang as DiagramFormat,
          title,
        });
      }
    }

    if (diagrams.length === 0) {
      // Fallback: treat entire response as a diagram
      diagrams.push({
        path: `diagrams/${diagramType}.${this.getExtension(format)}`,
        content: content.trim(),
        diagramType,
        format,
        title: `${diagramType} diagram`,
      });
    }

    return diagrams;
  }

  private getExtension(format: DiagramFormat | string): string {
    switch (format) {
      case `mermaid`: return `mmd`;
      case `plantuml`: return `puml`;
      case `d2`: return `d2`;
      case `svg`: return `svg`;
      default: return `txt`;
    }
  }
}
