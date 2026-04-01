import type { Task, CreateTaskInput, TaskStatus, TaskResult } from '@h/types';
import { TaskRepository } from '@h/db';
import type { EventBus } from '@h/events';

export class TaskService {
  private repo: TaskRepository;
  private eventBus: EventBus;

  constructor(eventBus: EventBus) {
    this.repo = new TaskRepository();
    this.eventBus = eventBus;
  }

  async create(input: CreateTaskInput): Promise<Task> {
    const task = this.repo.create(input);
    await this.eventBus.emit('task.created', { task }, {
      source: 'task-service',
      projectId: task.projectId,
      taskId: task.id,
    });
    return task;
  }

  findById(id: string): Task | undefined {
    return this.repo.findById(id);
  }

  findAll(filter?: Parameters<TaskRepository['findAll']>[0]): Task[] {
    return this.repo.findAll(filter);
  }

  findPendingReady(): Task[] {
    return this.repo.findPendingWithSatisfiedDependencies();
  }

  async assign(taskId: string, agentId: string): Promise<void> {
    this.repo.updateStatus(taskId, 'assigned', { assignedAgentId: agentId });
    const task = this.repo.findById(taskId);
    await this.eventBus.emit('task.assigned', { taskId, agentId }, {
      source: 'task-service',
      projectId: task?.projectId,
      taskId,
      agentId,
    });
  }

  async start(taskId: string, agentId: string): Promise<void> {
    this.repo.updateStatus(taskId, 'in_progress');
    const task = this.repo.findById(taskId);
    await this.eventBus.emit('task.started', { taskId, agentId }, {
      source: 'task-service',
      projectId: task?.projectId,
      taskId,
      agentId,
    });
  }

  async progress(taskId: string, summary: string, percentComplete?: number): Promise<void> {
    const task = this.repo.findById(taskId);
    await this.eventBus.emit('task.progress', { taskId, summary, percentComplete }, {
      source: 'task-service',
      projectId: task?.projectId,
      taskId,
      agentId: task?.assignedAgentId,
    });
  }

  async complete(taskId: string, result: TaskResult): Promise<void> {
    this.repo.updateStatus(taskId, 'completed', { result });
    const task = this.repo.findById(taskId);
    await this.eventBus.emit('task.completed', { taskId, result }, {
      source: 'task-service',
      projectId: task?.projectId,
      taskId,
      agentId: task?.assignedAgentId,
    });
  }

  async fail(taskId: string, error: string): Promise<void> {
    this.repo.updateStatus(taskId, 'failed', {
      result: { success: false, summary: error, filesChanged: [], linesAdded: 0, linesRemoved: 0, errors: [error] },
    });
    const task = this.repo.findById(taskId);
    await this.eventBus.emit('task.failed', { taskId, error }, {
      source: 'task-service',
      projectId: task?.projectId,
      taskId,
      agentId: task?.assignedAgentId,
    });
  }

  async block(taskId: string, reason: string, blockedBy?: string): Promise<void> {
    this.repo.updateStatus(taskId, 'blocked');
    const task = this.repo.findById(taskId);
    await this.eventBus.emit('task.blocked', { taskId, reason, blockedBy }, {
      source: 'task-service',
      projectId: task?.projectId,
      taskId,
    });
  }

  async cancel(taskId: string): Promise<void> {
    this.repo.updateStatus(taskId, 'cancelled');
    const task = this.repo.findById(taskId);
    await this.eventBus.emit('task.cancelled', { taskId }, {
      source: 'task-service',
      projectId: task?.projectId,
      taskId,
    });
  }
}
