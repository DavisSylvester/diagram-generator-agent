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
import { PROVIDER_MODEL_MAP, getFallbackTiers } from '../config/models.mts';
import type { LlmProvider, AgentRole } from '../config/models.mts';

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

  // ── LLM Factories (one per provider for cross-provider fallback) ─
  const factories = new Map<LlmProvider, ILlmFactory>();

  // Always create the primary factory
  const provider: LlmProvider = env.LLM_PROVIDER as LlmProvider;

  switch (provider) {
    case `ollama`:
      factories.set(`ollama`, new OllamaFactory(env.OLLAMA_HOST, env.OLLAMA_API_KEY, env.LLM_TIMEOUT_MS));
      break;
    case `openai`:
      factories.set(`openai`, new OpenAIFactory(env.OPENAI_API_KEY!, env.LLM_TIMEOUT_MS));
      break;
    case `anthropic`:
      factories.set(`anthropic`, new AnthropicFactory(env.ANTHROPIC_API_KEY!, env.LLM_TIMEOUT_MS));
      break;
  }

  // Create optional fallback factories if their API keys are available
  if (provider !== `openai` && env.OPENAI_API_KEY) {
    factories.set(`openai`, new OpenAIFactory(env.OPENAI_API_KEY, env.LLM_TIMEOUT_MS));
    logger.info(`Fallback factory registered: openai`);
  }
  if (provider !== `anthropic` && env.ANTHROPIC_API_KEY) {
    factories.set(`anthropic`, new AnthropicFactory(env.ANTHROPIC_API_KEY, env.LLM_TIMEOUT_MS));
    logger.info(`Fallback factory registered: anthropic`);
  }
  if (provider !== `ollama` && env.OLLAMA_HOST) {
    factories.set(`ollama`, new OllamaFactory(env.OLLAMA_HOST, env.OLLAMA_API_KEY, env.LLM_TIMEOUT_MS));
    logger.info(`Fallback factory registered: ollama`);
  }

  const primaryFactory = factories.get(provider)!;
  const models = PROVIDER_MODEL_MAP[provider];

  // ── Agents ─────────────────────────────────────────────────────
  // Build a model chain: primary provider model first, then cross-provider
  // fallback models. Each entry uses the correct factory for its provider
  // so model names always match the API they're sent to.
  const buildChain = (role: AgentRole) => {
    const primaryConfig = models[role];
    const chain: { model: ReturnType<ILlmFactory[`create`]>; name: string }[] = [
      { model: primaryFactory.create(primaryConfig.model, primaryConfig.temperature), name: `${provider}/${primaryConfig.model}` },
    ];

    // Add cross-provider fallback entries
    const fallbackTiers = getFallbackTiers(provider);
    for (const tier of fallbackTiers) {
      const fallbackFactory = factories.get(tier.provider);
      if (fallbackFactory) {
        chain.push({
          model: fallbackFactory.create(tier.model, tier.temperature),
          name: `${tier.provider}/${tier.model}`,
        });
      }
    }

    logger.debug(`Model chain for ${role}`, { models: chain.map((c) => c.name) });
    return chain;
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
