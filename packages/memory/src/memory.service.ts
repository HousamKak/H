import type { MemoryRecord, StoreMemoryInput, RecallMemoryQuery } from '@h/types';
import { MemoryRepository } from '@h/db';
import type { EventBus } from '@h/events';

export class MemoryService {
  private repo: MemoryRepository;
  private eventBus: EventBus;

  constructor(eventBus: EventBus) {
    this.repo = new MemoryRepository();
    this.eventBus = eventBus;
  }

  async store(input: StoreMemoryInput): Promise<MemoryRecord> {
    const record = this.repo.store(input);

    await this.eventBus.emit('memory.stored', { record }, {
      source: 'memory-service',
      projectId: input.projectId,
      agentId: input.agentId,
    });

    return record;
  }

  async recall(query: RecallMemoryQuery): Promise<MemoryRecord[]> {
    const records = this.repo.recall(query);

    // Increment access count for returned records
    for (const record of records) {
      this.repo.incrementAccess(record.id);
    }

    await this.eventBus.emit('memory.recalled', {
      query: JSON.stringify(query),
      resultCount: records.length,
    }, { source: 'memory-service', projectId: query.projectId });

    return records;
  }

  promote(memoryId: string, newExpiresAt?: string): void {
    const record = this.repo.findById(memoryId);
    if (!record) return;

    // Boost importance when promoted
    this.repo.updateImportance(memoryId, Math.min(1.0, record.importance + 0.2));
  }

  decay(factor?: number): void {
    this.repo.decay(factor);
  }

  forget(memoryId: string): boolean {
    return this.repo.forget(memoryId);
  }

  cleanExpired(): number {
    return this.repo.cleanExpired();
  }

  buildContext(query: RecallMemoryQuery): string {
    const records = this.repo.recall(query);

    if (records.length === 0) return '';

    const sections: string[] = ['## Relevant Memory'];
    for (const record of records) {
      this.repo.incrementAccess(record.id);
      sections.push(`- [${record.type}] ${record.content}`);
    }

    return sections.join('\n');
  }
}
