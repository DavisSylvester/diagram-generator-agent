import { readFile } from 'node:fs/promises';
import type { Logger } from 'winston';
import type { Result } from '../types/index.mts';
import { ok, err } from '../types/index.mts';

export interface ParsedPrd {
  readonly content: string;
  readonly title: string;
  readonly sections: readonly string[];
}

export async function parsePrd(filePath: string, logger: Logger): Promise<Result<ParsedPrd, Error>> {
  try {
    const content = await readFile(filePath, `utf-8`);

    if (!content.trim()) {
      return err(new Error(`PRD file is empty: ${filePath}`));
    }

    // Extract title from first heading
    const titleMatch = content.match(/^#\s+(.+)/m);
    const title = titleMatch?.[1]?.trim() ?? `Untitled PRD`;

    // Extract section headings
    const headingPattern = /^#{1,3}\s+(.+)/gm;
    const sections: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = headingPattern.exec(content)) !== null) {
      if (match[1]) {
        sections.push(match[1].trim());
      }
    }

    logger.info(`PRD parsed`, { title, sections: sections.length, chars: content.length });

    return ok({ content, title, sections });
  } catch (error) {
    return err(
      error instanceof Error
        ? error
        : new Error(`Failed to read PRD: ${String(error)}`),
    );
  }
}
