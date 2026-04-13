export interface INotificationChannel {
  send(message: string): Promise<void>;
}

export interface INotifier {
  notify(message: string): Promise<void>;
  notifyTaskStarted(taskId: string, taskName: string): Promise<void>;
  notifyTaskCompleted(taskId: string, taskName: string): Promise<void>;
  notifyTaskFailed(taskId: string, taskName: string, error: string): Promise<void>;
  notifyPipelineComplete(summary: string): Promise<void>;
}
