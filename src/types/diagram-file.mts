import type { DiagramType } from './task.mts';

export type DiagramFormat = `mermaid` | `plantuml` | `svg` | `d2`;

export interface DiagramFile {
  readonly path: string;
  readonly content: string;
  readonly diagramType: DiagramType;
  readonly format: DiagramFormat;
  readonly title: string;
}
