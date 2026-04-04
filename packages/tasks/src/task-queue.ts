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

  /**
   * Enhanced task selection using weighted scoring.
   * Considers priority, age, dependency urgency, and task complexity.
   */
  getNextTaskScored(role: AgentRole, projectId?: string): Task | undefined {
    const ready = this.taskService.findPendingReady();
    const candidates = ready
      .filter((t) => t.requiredRole === role)
      .filter((t) => !projectId || t.projectId === projectId);

    if (candidates.length === 0) return undefined;

    const scored = candidates.map((task) => {
      const priorityWeight: Record<string, number> = {
        critical: 100,
        high: 75,
        medium: 50,
        low: 25,
      };
      const ageMinutes =
        (Date.now() - new Date(task.createdAt).getTime()) / 60000;

      const score =
        (priorityWeight[task.priority] ?? 50) * 0.4 +
        Math.min(ageMinutes, 120) * 0.2 +
        this.dependencyUrgency(task) * 0.3 +
        (1 / Math.max(task.description.length / 100, 1)) * 0.1;

      return { task, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.task;
  }

  /**
   * Compute dependency urgency: how many other pending tasks depend on this one.
   * Higher value means this task is blocking more work.
   */
  private dependencyUrgency(task: Task): number {
    const allTasks = this.taskService.findAll();
    const blockedCount = allTasks.filter(
      (t) => t.dependencies.includes(task.id) && t.status === 'pending',
    ).length;
    return Math.min(blockedCount * 20, 100);
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
