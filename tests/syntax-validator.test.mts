import { describe, expect, it, afterAll } from 'bun:test';
import { rm } from 'node:fs/promises';
import { createLogger, transports } from 'winston';
import { SyntaxValidator } from '../src/verification/syntax-validator.mts';
import type { DiagramFile } from '../src/types/index.mts';

const TMP_DIR = `.workspace-syntax-test`;
const silentLogger = createLogger({ silent: true, transports: [new transports.Console()] });
const validator = new SyntaxValidator(silentLogger, TMP_DIR);

afterAll(async () => {
  await rm(TMP_DIR, { recursive: true, force: true }).catch(() => {});
});

function mermaidDiagram(content: string): DiagramFile {
  return { path: `diagrams/test.mmd`, content, diagramType: `system-context`, format: `mermaid`, title: `Test` };
}

function plantumlDiagram(content: string): DiagramFile {
  return { path: `diagrams/test.puml`, content, diagramType: `system-context`, format: `plantuml`, title: `Test` };
}

function d2Diagram(content: string): DiagramFile {
  return { path: `diagrams/test.d2`, content, diagramType: `system-context`, format: `d2`, title: `Test` };
}

// ── Mermaid structural validation ──────────────────────────────────

describe(`SyntaxValidator — Mermaid`, () => {
  it(`should accept a valid flowchart`, () => {
    const result = validator.validateStructural(mermaidDiagram(`graph TD\n  A[Client] --> B[Server]`));
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it(`should accept a valid sequenceDiagram`, () => {
    const result = validator.validateStructural(mermaidDiagram(
      `sequenceDiagram\n  Client->>API: GET /users\n  API-->>Client: 200 OK`,
    ));
    expect(result.valid).toBe(true);
  });

  it(`should accept a valid erDiagram`, () => {
    const result = validator.validateStructural(mermaidDiagram(
      `erDiagram\n  USER {\n    string id PK\n    string name\n  }`,
    ));
    expect(result.valid).toBe(true);
  });

  it(`should accept a valid classDiagram`, () => {
    const result = validator.validateStructural(mermaidDiagram(
      `classDiagram\n  class UserService {\n    +getUser(id)\n  }`,
    ));
    expect(result.valid).toBe(true);
  });

  it(`should accept C4Context diagrams`, () => {
    const result = validator.validateStructural(mermaidDiagram(
      `C4Context\n  title System Context\n  Person(user, "User")\n  System(api, "API")`,
    ));
    expect(result.valid).toBe(true);
  });

  it(`should accept C4Container diagrams`, () => {
    const result = validator.validateStructural(mermaidDiagram(
      `C4Container\n  Container(api, "API", "Elysia")`,
    ));
    expect(result.valid).toBe(true);
  });

  it(`should reject empty content`, () => {
    const result = validator.validateStructural(mermaidDiagram(``));
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]!.message).toContain(`empty`);
  });

  it(`should reject invalid diagram type`, () => {
    const result = validator.validateStructural(mermaidDiagram(`invalidType\n  A --> B`));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes(`Invalid or missing diagram type`))).toBe(true);
  });

  it(`should reject unbalanced braces`, () => {
    const result = validator.validateStructural(mermaidDiagram(
      `erDiagram\n  USER {\n    string id PK`,
    ));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes(`Unclosed`))).toBe(true);
  });

  it(`should reject unbalanced brackets`, () => {
    const result = validator.validateStructural(mermaidDiagram(
      `graph TD\n  A[Client --> B[Server]`,
    ));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes(`Unclosed`) || e.message.includes(`Mismatched`))).toBe(true);
  });

  it(`should reject diagram with only type declaration and no content`, () => {
    const result = validator.validateStructural(mermaidDiagram(`graph TD`));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes(`no content`))).toBe(true);
  });

  it(`should accept diagrams with Mermaid config directives`, () => {
    const result = validator.validateStructural(mermaidDiagram(
      `%%{init: {"theme": "dark"}}%%\ngraph TD\n  A --> B`,
    ));
    expect(result.valid).toBe(true);
  });

  it(`should not flag balanced delimiters inside strings as errors`, () => {
    const result = validator.validateStructural(mermaidDiagram(
      `graph TD\n  A["Service (main)"] --> B["DB {primary}"]`,
    ));
    expect(result.valid).toBe(true);
  });
});

// ── PlantUML structural validation ─────────────────────────────────

describe(`SyntaxValidator — PlantUML`, () => {
  it(`should accept a valid PlantUML diagram`, () => {
    const result = validator.validateStructural(plantumlDiagram(
      `@startuml\nAlice -> Bob: Hello\n@enduml`,
    ));
    expect(result.valid).toBe(true);
  });

  it(`should reject missing @startuml`, () => {
    const result = validator.validateStructural(plantumlDiagram(`Alice -> Bob\n@enduml`));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes(`@startuml`))).toBe(true);
  });

  it(`should reject missing @enduml`, () => {
    const result = validator.validateStructural(plantumlDiagram(`@startuml\nAlice -> Bob`));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes(`@enduml`))).toBe(true);
  });

  it(`should reject empty body between delimiters`, () => {
    const result = validator.validateStructural(plantumlDiagram(`@startuml\n@enduml`));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes(`No content`))).toBe(true);
  });

  it(`should reject @enduml before @startuml`, () => {
    const result = validator.validateStructural(plantumlDiagram(`@enduml\nAlice -> Bob\n@startuml`));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes(`before`))).toBe(true);
  });
});

// ── D2 structural validation ───────────────────────────────────────

describe(`SyntaxValidator — D2`, () => {
  it(`should accept a valid D2 diagram`, () => {
    const result = validator.validateStructural(d2Diagram(
      `client -> api: HTTPS\napi -> db: TCP`,
    ));
    expect(result.valid).toBe(true);
  });

  it(`should accept D2 with nested blocks`, () => {
    const result = validator.validateStructural(d2Diagram(
      `system: {\n  api -> db\n}`,
    ));
    expect(result.valid).toBe(true);
  });

  it(`should reject empty content`, () => {
    const result = validator.validateStructural(d2Diagram(``));
    expect(result.valid).toBe(false);
  });

  it(`should reject unbalanced braces`, () => {
    const result = validator.validateStructural(d2Diagram(
      `system: {\n  api -> db`,
    ));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes(`Unclosed`))).toBe(true);
  });

  it(`should reject D2 with no connections or shapes`, () => {
    const result = validator.validateStructural(d2Diagram(`just some random text`));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes(`No connections`))).toBe(true);
  });
});

// ── CLI validation (integration) ───────────────────────────────────

describe(`SyntaxValidator — CLI integration`, () => {
  it(`should fall back to structural when CLI is not available`, async () => {
    const result = await validator.validate(mermaidDiagram(`graph TD\n  A --> B`));
    // Either cli or structural — both should pass for valid input
    expect(result.valid).toBe(true);
    expect([`cli`, `structural`]).toContain(result.method);
  });

  it(`should detect syntax errors via validate()`, async () => {
    const result = await validator.validate(mermaidDiagram(``));
    expect(result.valid).toBe(false);
  });
});
