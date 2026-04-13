import type { Logger } from 'winston';
import type { INotificationChannel } from '../interfaces/i-notifier.mts';

export class TelegramChannel implements INotificationChannel {

  private readonly botToken: string;
  private readonly chatId: string;
  private readonly logger: Logger;

  constructor(botToken: string, chatId: string, logger: Logger) {
    this.botToken = botToken;
    this.chatId = chatId;
    this.logger = logger;
  }

  async send(message: string): Promise<void> {
    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
      const response = await fetch(url, {
        method: `POST`,
        headers: { 'Content-Type': `application/json` },
        body: JSON.stringify({
          chat_id: this.chatId,
          text: message,
          parse_mode: `Markdown`,
        }),
      });

      if (!response.ok) {
        this.logger.warn(`Telegram notification failed: ${response.status}`);
      }
    } catch (error) {
      this.logger.warn(`Telegram notification error`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
