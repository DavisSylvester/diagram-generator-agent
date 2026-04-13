import { createLogger, format, transports } from 'winston';
import type { Logger } from 'winston';
import type { EnvConfig } from '../config/env.mts';
import type { PipelineConfig, DiagramFormat } from '../types/index.mts';
import type { ILlmFactory } from '../interfaces/i-llm-factory.mts';
import type { INotifier } from '../interfaces/i-notifier.mts';
import { OllamaFactory } from '../llm/ollama-factory.mts';
import { OpenAIFactory } from '../llm/openai-factory.mts';
import { AnthropicFactory } from '../llm/anthropic-factory.mts';
import { CostTracker } from '../llm/cost-tracker.mts';
import { PlanningAgent } from '../agents/planning-agent.mts';
import { DiagramAgent } from '../agents/diagram-agent.mts';
import { ValidationAgent } from '../agents/validation-agent.mts';
import { Workspace } from '../io/workspace.mts';
import { ParallelExecutor } from '../graph/parallel-executor.mts';
import { ConsoleChannel } from '../notifications/console-channel.mts';
import { TelegramChannel } from '../notifications/telegram-channel.mts';
import { Notifier } from '../notifications/notifier.mts';
import { PROVIDER_MODEL_MAP } from '../config/models.mts';

export interface Container {
  readonly logger: Logger;
  readonly primaryFactory: ILlmFactory;
  readonly planningAgent: PlanningAgent;
  readonly diagramAgent: DiagramAgent;
  readonly validationAgent: ValidationAgent;
  readonly costTracker: CostTracker;
  readonly workspace: Workspace;
  readonly executor: ParallelExecutor;
  readonly notifier: INotifier;
  readonly pipelineConfig: PipelineConfig;
}

// Redact secrets from log output
const SECRET_PATTERNS = [/sk-[a-zA-Z0-9]+/g, /sk-ant-[a-zA-Z0-9]+/g, /key-[a-zA-Z0-9]+/g];

function redactSecrets(message: string): string {
  let redacted = message;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, `[REDACTED]`);
  }
  return redacted;
}

export function createContainer(env: EnvConfig, overrides?: Partial<PipelineConfig>): Container {
  // ── Logger ──────────────────────────────────────────────────────
  const logger = createLogger({
    level: `info`,
    format: format.combine(
      format.timestamp(),
      format.printf(({ level, message, timestamp, ...meta }) => {
        const msg = redactSecrets(String(message));
        const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : ``;
        return `${String(timestamp)} [${level.toUpperCase()}] ${msg}${metaStr}`;
      }),
    ),
    transports: [
      new transports.Console({
        format: format.combine(
          format.colorize(),
          format.printf(({ level, message, timestamp }) => {
            const msg = redactSecrets(String(message));
            return `${String(timestamp)} ${level}: ${msg}`;
          }),
        ),
      }),
    ],
  });

  // ── LLM Factory ────────────────────────────────────────────────
  let primaryFactory: ILlmFactory;

  switch (env.LLM_PROVIDER) {
    case `ollama`:
      primaryFactory = new OllamaFactory(env.OLLAMA_HOST, env.OLLAMA_API_KEY, env.LLM_TIMEOUT_MS);
      break;
    case `openai`:
      primaryFactory = new OpenAIFactory(env.OPENAI_API_KEY!, env.LLM_TIMEOUT_MS);
      break;
    case `anthropic`:
      primaryFactory = new AnthropicFactory(env.ANTHROPIC_API_KEY!, env.LLM_TIMEOUT_MS);
      break;
  }

  const provider = env.LLM_PROVIDER;
  const models = PROVIDER_MODEL_MAP[provider]!;

  // ── Agents ─────────────────────────────────────────────────────
  const buildChain = (role: keyof typeof models) => {
    const config = models[role];
    return [{ model: primaryFactory.create(config.model, config.temperature), name: config.model }];
  };

  const planningAgent = new PlanningAgent(logger, buildChain(`planning`), env.LLM_TIMEOUT_MS);
  const diagramAgent = new DiagramAgent(logger, buildChain(`diagram`), env.LLM_TIMEOUT_MS);
  const validationAgent = new ValidationAgent(logger, buildChain(`validation`), env.LLM_TIMEOUT_MS);

  // ── Infrastructure ─────────────────────────────────────────────
  const costTracker = new CostTracker(logger);
  const workspace = new Workspace(env.WORKSPACE_DIR, logger);
  const executor = new ParallelExecutor(logger);

  // ── Notifications ──────────────────────────────────────────────
  const channels = [new ConsoleChannel(logger)];

  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
    channels.push(new TelegramChannel(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, logger) as never);
  }

  const notifier = new Notifier(channels);

  // ── Pipeline Config ────────────────────────────────────────────
  const pipelineConfig: PipelineConfig = {
    maxFixIterations: overrides?.maxFixIterations ?? env.MAX_FIX_ITERATIONS,
    maxConcurrency: overrides?.maxConcurrency ?? env.MAX_CONCURRENCY,
    maxTasks: overrides?.maxTasks ?? 0,
    llmTimeoutMs: env.LLM_TIMEOUT_MS,
    workspaceDir: env.WORKSPACE_DIR,
    taskCostLimit: env.TASK_COST_LIMIT,
    noDocs: overrides?.noDocs ?? false,
    noValidate: overrides?.noValidate ?? false,
  };

  return {
    logger,
    primaryFactory,
    planningAgent,
    diagramAgent,
    validationAgent,
    costTracker,
    workspace,
    executor,
    notifier,
    pipelineConfig,
  };
}
