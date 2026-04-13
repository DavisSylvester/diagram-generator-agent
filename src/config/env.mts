import { z } from 'zod';
import type { Logger } from 'winston';

const LlmProvider = z.enum([`ollama`, `openai`, `anthropic`]);

const envSchema = z.object({
  LLM_PROVIDER: LlmProvider.default(`ollama`),

  // Ollama
  OLLAMA_HOST: z.string().default(`http://localhost:11434`),
  OLLAMA_API_KEY: z.string().optional(),

  // OpenAI
  OPENAI_API_KEY: z.string().optional(),

  // Anthropic
  ANTHROPIC_API_KEY: z.string().optional(),

  // Pipeline
  MAX_FIX_ITERATIONS: z.coerce.number().int().min(1).max(20).default(5),
  MAX_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(4),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(10_000).max(3_600_000).default(1_800_000),
  WORKSPACE_DIR: z.string().default(`.workspace`),

  // Cost
  TASK_COST_LIMIT: z.coerce.number().min(0.01).default(3.00),

  // Notifications
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  NOTIFICATION_INTERVAL_MS: z.coerce.number().int().min(60_000).max(3_600_000).default(300_000),

  // Tracing
  LANGSMITH_TRACING: z.string().optional(),
  LANGSMITH_API_KEY: z.string().optional(),
  LANGSMITH_PROJECT: z.string().default(`diagram-generator-agent`),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function loadEnv(logger: Logger): EnvConfig {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      logger.error(`Env validation failed`, {
        field: issue.path.join(`.`),
        message: issue.message,
      });
    }
    process.exit(1);
  }

  const config = parsed.data;

  // Validate provider-specific keys
  if (config.LLM_PROVIDER === `openai` && !config.OPENAI_API_KEY) {
    logger.error(`OPENAI_API_KEY is required when LLM_PROVIDER=openai`);
    process.exit(1);
  }

  if (config.LLM_PROVIDER === `anthropic` && !config.ANTHROPIC_API_KEY) {
    logger.error(`ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic`);
    process.exit(1);
  }

  return config;
}
