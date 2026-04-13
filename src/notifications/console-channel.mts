import type { Logger } from 'winston';
import type { INotificationChannel } from '../interfaces/i-notifier.mts';

export class ConsoleChannel implements INotificationChannel {

  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  async send(message: string): Promise<void> {
    this.logger.info(`[Notification] ${message}`);
  }
}
