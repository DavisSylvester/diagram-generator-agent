import { describe, expect, it } from 'bun:test';
import { parseArgs } from '../src/cli/parse-args.mts';

describe(`parseArgs`, () => {
  it(`should parse --prd flag`, () => {
    const result = parseArgs([`node`, `index.mts`, `--prd`, `./my-prd.md`]);
    expect(result.command.kind).toBe(`run`);
    if (result.command.kind === `run`) {
      expect(result.command.prdPath).toBe(`./my-prd.md`);
    }
  });

  it(`should parse --resume flag`, () => {
    const result = parseArgs([`node`, `index.mts`, `--resume`, `abc-123`]);
    expect(result.command.kind).toBe(`resume`);
    if (result.command.kind === `resume`) {
      expect(result.command.runId).toBe(`abc-123`);
    }
  });

  it(`should parse --list-runs flag`, () => {
    const result = parseArgs([`node`, `index.mts`, `--list-runs`]);
    expect(result.command.kind).toBe(`list-runs`);
  });

  it(`should parse --status flag`, () => {
    const result = parseArgs([`node`, `index.mts`, `--status`, `run-456`]);
    expect(result.command.kind).toBe(`status`);
    if (result.command.kind === `status`) {
      expect(result.command.runId).toBe(`run-456`);
    }
  });

  it(`should parse --iterations flag`, () => {
    const result = parseArgs([`node`, `index.mts`, `--prd`, `prd.md`, `--iterations`, `10`]);
    expect(result.iterations).toBe(10);
  });

  it(`should parse --concurrency flag`, () => {
    const result = parseArgs([`node`, `index.mts`, `--prd`, `prd.md`, `--concurrency`, `2`]);
    expect(result.concurrency).toBe(2);
  });

  it(`should parse --format flag`, () => {
    const result = parseArgs([`node`, `index.mts`, `--prd`, `prd.md`, `--format`, `plantuml`]);
    expect(result.outputFormat).toBe(`plantuml`);
  });

  it(`should parse --no-docs flag`, () => {
    const result = parseArgs([`node`, `index.mts`, `--prd`, `prd.md`, `--no-docs`]);
    expect(result.noDocs).toBe(true);
  });

  it(`should parse --no-validate flag`, () => {
    const result = parseArgs([`node`, `index.mts`, `--prd`, `prd.md`, `--no-validate`]);
    expect(result.noValidate).toBe(true);
  });

  it(`should parse legacy positional args`, () => {
    const result = parseArgs([`node`, `index.mts`, `./prd.md`]);
    expect(result.command.kind).toBe(`run`);
    if (result.command.kind === `run`) {
      expect(result.command.prdPath).toBe(`./prd.md`);
    }
  });

  it(`should default to help when no args`, () => {
    const result = parseArgs([`node`, `index.mts`]);
    expect(result.command.kind).toBe(`help`);
  });
});
