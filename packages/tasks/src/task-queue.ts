import type { Task, AgentRole } from '@h/types';
import type { TaskService } from './task.service.js';

export class TaskQueue {
  private taskService: TaskService;

  constructor(taskService: TaskService) {
    this.taskService = taskService;
  }

  getNextTask(role: AgentRole, projectId?: string): Task | undefined {
    const ready = this.taskService.findPendingReady();
    const eligible = ready.filter((t) => {
      if (t.requiredRole !== role) return false;
      if (projectId && t.projectId !== projectId) return false;
      return true;
    });
    return eligible[0]; // Already sorted by priority in the repository
  }

  getPendingCount(projectId?: string): number {
    const tasks = this.taskService.findAll({ status: 'pending' });
    if (projectId) return tasks.filter((t) => t.projectId === projectId).length;
    return tasks.length;
  }

  getInProgressCount(projectId?: string): number {
    const tasks = this.taskService.findAll({ status: 'in_progress' });
    if (projectId) return tasks.filter((t) => t.projectId === projectId).length;
    return tasks.length;
  }

  getQueueSnapshot(projectId?: string): {
    pending: number;
    assigned: number;
    inProgress: number;
    review: number;
    completed: number;
    failed: number;
    blocked: number;
  } {
    const all = projectId
      ? this.taskService.findAll({ projectId })
      : this.taskService.findAll();

    return {
      pending: all.filter((t) => t.status === 'pending').length,
      assigned: all.filter((t) => t.status === 'assigned').length,
      inProgress: all.filter((t) => t.status === 'in_progress').length,
      review: all.filter((t) => t.status === 'review').length,
      completed: all.filter((t) => t.status === 'completed').length,
      failed: all.filter((t) => t.status === 'failed').length,
      blocked: all.filter((t) => t.status === 'blocked').length,
    };
  }
}
