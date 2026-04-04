import type { HEvent, EventType, EventHandler, EventFilter, EventMetadata } from '@h/types';
import { generateId } from '@h/types';

type Subscription = {
  id: string;
  filter: EventFilter;
  handler: EventHandler;
};

export class EventBus {
  private subscriptions: Map<string, Subscription> = new Map();
  private history: HEvent[] = [];
  private maxHistorySize: number;
  private persistHandler?: (event: HEvent) => void | Promise<void>;

  constructor(options?: { maxHistorySize?: number }) {
    this.maxHistorySize = options?.maxHistorySize ?? 10000;
  }

  onPersist(handler: (event: HEvent) => void | Promise<void>): void {
    this.persistHandler = handler;
  }

  subscribe(filter: EventFilter, handler: EventHandler): string {
    const id = generateId();
    this.subscriptions.set(id, { id, filter, handler });
    return id;
  }

  on(type: EventType | EventType[], handler: EventHandler): string {
    const types = Array.isArray(type) ? type : [type];
    return this.subscribe({ types }, handler);
  }

  unsubscribe(subscriptionId: string): boolean {
    return this.subscriptions.delete(subscriptionId);
  }

  async emit<T = Record<string, unknown>>(
    type: EventType,
    payload: T,
    context?: {
      sessionId?: string;
      projectId?: string;
      agentId?: string;
      taskId?: string;
      source?: string;
      correlationId?: string;
      causationId?: string;
    }
  ): Promise<HEvent<T>> {
    const event: HEvent<T> = {
      id: generateId(),
      type,
      timestamp: new Date().toISOString(),
      sessionId: context?.sessionId,
      projectId: context?.projectId,
      agentId: context?.agentId,
      taskId: context?.taskId,
      payload,
      metadata: {
        source: context?.source ?? 'system',
        correlationId: context?.correlationId,
        causationId: context?.causationId,
      },
    };

    const asBase = event as unknown as HEvent;

    // Persist first
    if (this.persistHandler) {
      await this.persistHandler(asBase);
    }

    // Add to in-memory history
    this.history.push(asBase);
    if (this.history.length > this.maxHistorySize) {
      this.history = this.history.slice(-Math.floor(this.maxHistorySize * 0.8));
    }

    // Notify subscribers
    const matchingSubscriptions = this.getMatchingSubscriptions(asBase);
    await Promise.allSettled(
      matchingSubscriptions.map((sub) => sub.handler(asBase))
    );

    return event;
  }

  getHistory(filter?: EventFilter & { since?: string; limit?: number }): HEvent[] {
    let events = this.history;

    if (filter?.since) {
      events = events.filter((e) => e.timestamp >= filter.since!);
    }
    if (filter?.types?.length) {
      events = events.filter((e) => filter.types!.includes(e.type));
    }
    if (filter?.sessionId) {
      events = events.filter((e) => e.sessionId === filter.sessionId);
    }
    if (filter?.projectId) {
      events = events.filter((e) => e.projectId === filter.projectId);
    }
    if (filter?.agentId) {
      events = events.filter((e) => e.agentId === filter.agentId);
    }
    if (filter?.taskId) {
      events = events.filter((e) => e.taskId === filter.taskId);
    }
    if (filter?.limit) {
      events = events.slice(-filter.limit);
    }

    return events;
  }

  clear(): void {
    this.subscriptions.clear();
    this.history = [];
  }

  get subscriberCount(): number {
    return this.subscriptions.size;
  }

  private getMatchingSubscriptions(event: HEvent): Subscription[] {
    const matching: Subscription[] = [];
    for (const sub of this.subscriptions.values()) {
      if (this.matchesFilter(event, sub.filter)) {
        matching.push(sub);
      }
    }
    return matching;
  }

  private matchesFilter(event: HEvent, filter: EventFilter): boolean {
    if (filter.types?.length && !filter.types.includes(event.type)) {
      return false;
    }
    if (filter.sessionId && event.sessionId !== filter.sessionId) {
      return false;
    }
    if (filter.projectId && event.projectId !== filter.projectId) {
      return false;
    }
    if (filter.agentId && event.agentId !== filter.agentId) {
      return false;
    }
    if (filter.taskId && event.taskId !== filter.taskId) {
      return false;
    }
    return true;
  }
}
