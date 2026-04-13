import type { INotifier, INotificationChannel } from '../interfaces/i-notifier.mts';

export class Notifier implements INotifier {

  private readonly channels: readonly INotificationChannel[];

  constructor(channels: readonly INotificationChannel[]) {
    this.channels = channels;
  }

  async notify(message: string): Promise<void> {
    await Promise.allSettled(this.channels.map((ch) => ch.send(message)));
  }

  async notifyTaskStarted(taskId: string, taskName: string): Promise<void> {
    await this.notify(`▶ Started: ${taskName} (${taskId})`);
  }

  async notifyTaskCompleted(taskId: string, taskName: string): Promise<void> {
    await this.notify(`✅ Completed: ${taskName} (${taskId})`);
  }

  async notifyTaskFailed(taskId: string, taskName: string, error: string): Promise<void> {
    await this.notify(`❌ Failed: ${taskName} (${taskId}) — ${error}`);
  }

  async notifyPipelineComplete(summary: string): Promise<void> {
    await this.notify(`🏁 Pipeline complete — ${summary}`);
  }
}
