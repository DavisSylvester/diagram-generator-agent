import { writeFile, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ulid } from 'ulid';
import type { Logger } from 'winston';
import type { DiagramFile, DiagramFormat } from '../types/index.mts';

export interface SyntaxError {
  readonly file: string;
  readonly line?: number | undefined;
  readonly message: string;
}

export interface SyntaxValidationResult {
  readonly valid: boolean;
  readonly errors: readonly SyntaxError[];
  readonly method: `cli` | `structural`;
}

/**
 * Validates that diagram source renders without syntax errors.
 *
 * Strategy:
 *   1. Try the CLI tool for the format (mmdc, plantuml, d2) — authoritative
 *   2. Fall back to structural/regex checks if the CLI is not installed
 *
 * The structural checks catch the most common LLM mistakes:
 *   - Wrong diagram type keywords
 *   - Unbalanced braces/brackets
 *   - Missing required delimiters (@startuml/@enduml)
 *   - Empty diagram body
 */
export class SyntaxValidator {

  private readonly logger: Logger;
  private readonly tmpDir: string;
  private readonly cliAvailability = new Map<string, boolean>();

  constructor(logger: Logger, tmpDir: string) {
    this.logger = logger;
    this.tmpDir = tmpDir;
  }

  async validate(diagram: DiagramFile): Promise<SyntaxValidationResult> {
    // Try CLI validation first (most accurate)
    const cliResult = await this.validateWithCli(diagram);
    if (cliResult !== null) {
      return cliResult;
    }

    // Fall back to structural validation
    return this.validateStructural(diagram);
  }

  // ── CLI validation ───────────────────────────────────────────────

  private async validateWithCli(diagram: DiagramFile): Promise<SyntaxValidationResult | null> {
    switch (diagram.format) {
      case `mermaid`:
        return this.validateMermaidCli(diagram);
      case `plantuml`:
        return this.validatePlantUmlCli(diagram);
      case `d2`:
        return this.validateD2Cli(diagram);
      default:
        return null;
    }
  }

  private async validateMermaidCli(diagram: DiagramFile): Promise<SyntaxValidationResult | null> {
    if (!await this.isCliAvailable(`mmdc`)) return null;

    const { inputPath, outputPath, cleanup } = await this.writeTempFile(diagram.content, `mmd`);
    try {
      const result = await this.exec(`mmdc`, [`-i`, inputPath, `-o`, outputPath, `--quiet`]);
      return {
        valid: result.exitCode === 0,
        errors: result.exitCode === 0 ? [] : this.parseCliErrors(result.stderr, diagram.path),
        method: `cli`,
      };
    } finally {
      await cleanup();
    }
  }

  private async validatePlantUmlCli(diagram: DiagramFile): Promise<SyntaxValidationResult | null> {
    if (!await this.isCliAvailable(`plantuml`)) return null;

    const { inputPath, cleanup } = await this.writeTempFile(diagram.content, `puml`);
    try {
      const result = await this.exec(`plantuml`, [`-checkonly`, inputPath]);
      return {
        valid: result.exitCode === 0,
        errors: result.exitCode === 0 ? [] : this.parseCliErrors(result.stderr, diagram.path),
        method: `cli`,
      };
    } finally {
      await cleanup();
    }
  }

  private async validateD2Cli(diagram: DiagramFile): Promise<SyntaxValidationResult | null> {
    if (!await this.isCliAvailable(`d2`)) return null;

    const { inputPath, outputPath, cleanup } = await this.writeTempFile(diagram.content, `d2`);
    try {
      const result = await this.exec(`d2`, [`--dry-run`, inputPath, outputPath]);
      return {
        valid: result.exitCode === 0,
        errors: result.exitCode === 0 ? [] : this.parseCliErrors(result.stderr, diagram.path),
        method: `cli`,
      };
    } finally {
      await cleanup();
    }
  }

  private async isCliAvailable(command: string): Promise<boolean> {
    const cached = this.cliAvailability.get(command);
    if (cached !== undefined) return cached;

    try {
      const which = process.platform === `win32` ? `where` : `which`;
      const proc = Bun.spawn([which, command], { stdout: `pipe`, stderr: `pipe` });
      const exitCode = await proc.exited;
      const available = exitCode === 0;
      this.cliAvailability.set(command, available);

      if (available) {
        this.logger.debug(`CLI tool available: ${command}`);
      }
      return available;
    } catch {
      this.cliAvailability.set(command, false);
      return false;
    }
  }

  private async exec(command: string, args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    try {
      const proc = Bun.spawn([command, ...args], { stdout: `pipe`, stderr: `pipe` });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      return { exitCode, stdout, stderr };
    } catch (error) {
      return {
        exitCode: 1,
        stdout: ``,
        stderr: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async writeTempFile(content: string, ext: string): Promise<{
    inputPath: string;
    outputPath: string;
    cleanup: () => Promise<void>;
  }> {
    const id = ulid();
    const dir = join(this.tmpDir, `syntax-check-${id}`);
    await mkdir(dir, { recursive: true });

    const inputPath = join(dir, `input.${ext}`);
    const outputPath = join(dir, `output.svg`);
    await writeFile(inputPath, content);

    return {
      inputPath,
      outputPath,
      cleanup: async () => {
        await rm(dir, { recursive: true, force: true }).catch(() => {});
      },
    };
  }

  private parseCliErrors(stderr: string, filePath: string): SyntaxError[] {
    if (!stderr.trim()) {
      return [{ file: filePath, message: `CLI reported an error but produced no output` }];
    }

    const errors: SyntaxError[] = [];
    const lines = stderr.split(`\n`).filter((l) => l.trim().length > 0);

    for (const line of lines) {
      // Try to extract line numbers from common error formats
      // e.g., "Error: Parse error on line 5:" or "line 12:3 error: ..."
      const lineNumMatch = line.match(/line\s+(\d+)/i);
      errors.push({
        file: filePath,
        line: lineNumMatch?.[1] ? parseInt(lineNumMatch[1], 10) : undefined,
        message: line.trim(),
      });
    }

    return errors.length > 0 ? errors : [{ file: filePath, message: stderr.trim() }];
  }

  // ── Structural validation (fallback) ─────────────────────────────

  validateStructural(diagram: DiagramFile): SyntaxValidationResult {
    switch (diagram.format) {
      case `mermaid`:
        return this.validateMermaidStructural(diagram);
      case `plantuml`:
        return this.validatePlantUmlStructural(diagram);
      case `d2`:
        return this.validateD2Structural(diagram);
      default:
        return { valid: true, errors: [], method: `structural` };
    }
  }

  private validateMermaidStructural(diagram: DiagramFile): SyntaxValidationResult {
    const content = diagram.content.trim();
    const errors: SyntaxError[] = [];

    // Check for empty content
    if (!content) {
      errors.push({ file: diagram.path, message: `Diagram body is empty` });
      return { valid: false, errors, method: `structural` };
    }

    // Check for valid diagram type declaration
    const validTypes = [
      /^graph\s+(TD|TB|BT|RL|LR)/m,
      /^flowchart\s+(TD|TB|BT|RL|LR)/m,
      /^sequenceDiagram/m,
      /^classDiagram/m,
      /^erDiagram/m,
      /^stateDiagram/m,
      /^stateDiagram-v2/m,
      /^gantt/m,
      /^pie/m,
      /^gitgraph/m,
      /^journey/m,
      /^mindmap/m,
      /^timeline/m,
      /^C4Context/m,
      /^C4Container/m,
      /^C4Component/m,
      /^C4Deployment/m,
      /^%%\{init:/m,    // Mermaid config directive (valid start)
      /^---\s*\n/m,     // YAML frontmatter (valid start)
    ];

    const hasValidType = validTypes.some((pattern) => pattern.test(content));
    if (!hasValidType) {
      const firstLine = content.split(`\n`)[0]?.trim() ?? ``;
      errors.push({
        file: diagram.path,
        line: 1,
        message: `Invalid or missing diagram type declaration. First line: "${firstLine}". Expected one of: graph, flowchart, sequenceDiagram, classDiagram, erDiagram, C4Context, C4Container, C4Component, etc.`,
      });
    }

    // Check balanced braces, brackets, parentheses
    const bracketErrors = this.checkBalancedDelimiters(content, diagram.path);
    errors.push(...bracketErrors);

    // Check for content after the type declaration (not just a header with nothing)
    const lines = content.split(`\n`).filter((l) => l.trim().length > 0 && !l.trim().startsWith(`%%`));
    if (lines.length < 2) {
      errors.push({
        file: diagram.path,
        message: `Diagram has no content after the type declaration`,
      });
    }

    return { valid: errors.length === 0, errors, method: `structural` };
  }

  private validatePlantUmlStructural(diagram: DiagramFile): SyntaxValidationResult {
    const content = diagram.content.trim();
    const errors: SyntaxError[] = [];

    if (!content) {
      errors.push({ file: diagram.path, message: `Diagram body is empty` });
      return { valid: false, errors, method: `structural` };
    }

    // Must have @startuml and @enduml
    if (!content.includes(`@startuml`)) {
      errors.push({ file: diagram.path, line: 1, message: `Missing @startuml declaration` });
    }
    if (!content.includes(`@enduml`)) {
      const lastLine = content.split(`\n`).length;
      errors.push({ file: diagram.path, line: lastLine, message: `Missing @enduml declaration` });
    }

    // @startuml must come before @enduml
    const startIdx = content.indexOf(`@startuml`);
    const endIdx = content.indexOf(`@enduml`);
    if (startIdx >= 0 && endIdx >= 0 && startIdx > endIdx) {
      errors.push({ file: diagram.path, message: `@enduml appears before @startuml` });
    }

    // Content between @startuml and @enduml should be non-empty
    if (startIdx >= 0 && endIdx >= 0) {
      const body = content.substring(startIdx + `@startuml`.length, endIdx).trim();
      if (!body) {
        errors.push({ file: diagram.path, message: `No content between @startuml and @enduml` });
      }
    }

    // Check balanced braces
    const bracketErrors = this.checkBalancedDelimiters(content, diagram.path);
    errors.push(...bracketErrors);

    return { valid: errors.length === 0, errors, method: `structural` };
  }

  private validateD2Structural(diagram: DiagramFile): SyntaxValidationResult {
    const content = diagram.content.trim();
    const errors: SyntaxError[] = [];

    if (!content) {
      errors.push({ file: diagram.path, message: `Diagram body is empty` });
      return { valid: false, errors, method: `structural` };
    }

    // Check balanced braces (D2 uses {} for nesting)
    const bracketErrors = this.checkBalancedDelimiters(content, diagram.path);
    errors.push(...bracketErrors);

    // Check for at least one connection or shape
    const hasConnection = /->|<-|--|<->/.test(content);
    const hasShape = /:\s*\S/.test(content);
    const hasBlock = /\{/.test(content);
    if (!hasConnection && !hasShape && !hasBlock) {
      errors.push({
        file: diagram.path,
        message: `No connections (->, <-, --), shapes, or blocks found in D2 diagram`,
      });
    }

    return { valid: errors.length === 0, errors, method: `structural` };
  }

  private checkBalancedDelimiters(content: string, filePath: string): SyntaxError[] {
    const errors: SyntaxError[] = [];
    const stack: { char: string; line: number }[] = [];
    const pairs: Record<string, string> = { '{': '}', '[': ']', '(': ')' };
    const closers = new Set(Object.values(pairs));

    // Strip strings and comments to avoid false positives
    const stripped = content
      .replace(/"[^"]*"/g, `""`)
      .replace(/'[^']*'/g, `''`)
      .replace(/%%.*$/gm, ``)     // Mermaid comments
      .replace(/'.*$/gm, ``)       // PlantUML single-line comments
      .replace(/\/\/.*$/gm, ``)    // D2 comments
      .replace(/\/\*[\s\S]*?\*\//g, ``);  // Block comments

    const lines = stripped.split(`\n`);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      for (const char of line) {
        if (pairs[char]) {
          stack.push({ char, line: i + 1 });
        } else if (closers.has(char)) {
          const expected = stack.pop();
          if (!expected) {
            errors.push({ file: filePath, line: i + 1, message: `Unexpected closing '${char}' with no matching opener` });
          } else if (pairs[expected.char] !== char) {
            errors.push({
              file: filePath,
              line: i + 1,
              message: `Mismatched delimiter: expected '${pairs[expected.char]}' to close '${expected.char}' from line ${expected.line}, but found '${char}'`,
            });
          }
        }
      }
    }

    for (const unclosed of stack) {
      errors.push({
        file: filePath,
        line: unclosed.line,
        message: `Unclosed '${unclosed.char}' opened on line ${unclosed.line}`,
      });
    }

    return errors;
  }
}
