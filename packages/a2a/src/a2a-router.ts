import type {
  A2AMessage, SendA2AMessageInput, A2AInboxFilter, A2AMessageStatus,
} from '@h/types';
import type { EventBus } from '@h/events';
import { A2ARepository, A2APermissionsRepository } from '@h/db';
import { AgentCardRegistry } from './agent-card-registry.js';

export type A2AMessageHandler = (message: A2AMessage) => void | Promise<void>;

/**
 * Routes A2A messages between agents with 4 routing modes:
 * 1. Direct (toAgentId specified)
 * 2. Capability-based (find best agent by capability)
 * 3. Project broadcast (all agents in a project)
 * 4. Session broadcast (all agents in session)
 */
export class A2ARouter {
  private repo: A2ARepository;
  private permsRepo: A2APermissionsRepository;
  private cardRegistry: AgentCardRegistry;
  private handlers: Map<string, A2AMessageHandler> = new Map();

  constructor(private eventBus: EventBus, cardRegistry: AgentCardRegistry) {
    this.repo = new A2ARepository();
    this.permsRepo = new A2APermissionsRepository();
    this.cardRegistry = cardRegistry;
  }

  /**
   * Send a message with automatic routing.
   */
  async send(
    sessionId: string,
    fromAgentId: string,
    fromProjectId: string,
    input: SendA2AMessageInput,
  ): Promise<A2AMessage> {
    let targetAgentId = input.toAgentId;

    // Capability-based routing
    if (!targetAgentId && input.capability) {
      const cards = this.cardRegistry.discover({
        sessionId,
        capability: input.capability,
      }).filter(c => c.agentId !== fromAgentId);

      // Score: same-project+available > same-project+busy > other+available > other+busy
      const sorted = cards.sort((a, b) => {
        const score = (c: typeof a) =>
          (c.projectId === fromProjectId ? 2 : 0) + (c.status === 'available' ? 1 : 0);
        return score(b) - score(a);
      });

      targetAgentId = sorted[0]?.agentId;
      if (!targetAgentId) {
        throw new Error(`No agent found with capability "${input.capability}"`);
      }
    }

    // Cross-session permission check
    if (targetAgentId) {
      const targetCard = this.cardRegistry.findCard(targetAgentId);
      if (targetCard && targetCard.sessionId !== sessionId) {
        if (!this.permsRepo.canSend(sessionId, targetCard.sessionId)) {
          // Auto-request if not already requested
          this.permsRepo.request(sessionId, targetCard.sessionId, fromAgentId);
          throw new Error(
            `Cross-session A2A denied. Permission requested from session ${targetCard.sessionId.slice(0, 8)} — wait for approval.`,
          );
        }
      }
    }

    const message = this.repo.createMessage(sessionId, fromAgentId, fromProjectId, {
      ...input,
      toAgentId: targetAgentId,
    });

    await this.eventBus.emit('a2a.message.sent', {
      messageId: message.id,
      fromAgentId,
      toAgentId: targetAgentId,
      type: message.type,
      subject: message.subject,
    }, {
      source: 'a2a-router',
      sessionId,
      agentId: fromAgentId,
    });

    // Deliver to real-time handler if registered
    if (targetAgentId) {
      const handler = this.handlers.get(targetAgentId);
      if (handler) {
        try {
          await handler(message);
          this.repo.updateStatus(message.id, 'delivered');
          await this.eventBus.emit('a2a.message.delivered', {
            messageId: message.id,
            toAgentId: targetAgentId,
          }, { source: 'a2a-router', sessionId });
        } catch { /* delivery failure is non-fatal */ }
      }
    }

    return message;
  }

  /**
   * Broadcast to all agents in the session (or a specific project).
   */
  async broadcast(
    sessionId: string,
    fromAgentId: string,
    fromProjectId: string,
    input: Omit<SendA2AMessageInput, 'toAgentId' | 'capability'>,
    toProjectId?: string,
  ): Promise<A2AMessage> {
    const message = this.repo.createMessage(sessionId, fromAgentId, fromProjectId, {
      ...input,
      toProjectId,
      type: input.type ?? 'broadcast' as any,
    });

    await this.eventBus.emit('a2a.message.sent', {
      messageId: message.id,
      fromAgentId,
      toAgentId: null,
      broadcast: true,
      toProjectId,
      type: message.type,
    }, {
      source: 'a2a-router',
      sessionId,
      agentId: fromAgentId,
    });

    // Deliver to all registered handlers (except sender)
    for (const [agentId, handler] of this.handlers) {
      if (agentId === fromAgentId) continue;
      // If project-scoped, only deliver to agents in that project
      if (toProjectId) {
        const card = this.cardRegistry.findCard(agentId);
        if (card && card.projectId !== toProjectId) continue;
      }
      try { await handler(message); } catch {}
    }

    return message;
  }

  /**
   * Register a real-time handler for an agent (called when messages arrive).
   */
  registerHandler(agentId: string, handler: A2AMessageHandler): void {
    this.handlers.set(agentId, handler);
  }

  /**
   * Unregister handler when agent terminates.
   */
  unregisterHandler(agentId: string): void {
    this.handlers.delete(agentId);
  }

  /**
   * Get inbox for an agent (used by MCP tool when handler isn't registered).
   */
  getInbox(agentId: string, filter?: A2AInboxFilter): A2AMessage[] {
    return this.repo.getInbox(agentId, filter);
  }

  /**
   * Acknowledge/mark message as read or processed.
   */
  async acknowledge(messageId: string, status: A2AMessageStatus = 'read'): Promise<void> {
    this.repo.updateStatus(messageId, status);

    await this.eventBus.emit('a2a.message.read', {
      messageId,
      status,
    }, { source: 'a2a-router' });
  }

  /**
   * Count pending messages for an agent (used for piggyback notifications).
   */
  countPending(agentId: string): number {
    return this.repo.countPending(agentId);
  }

  // ---- Cross-session permissions ----

  requestPermission(fromSessionId: string, toSessionId: string, requestedByAgentId?: string) {
    return this.permsRepo.request(fromSessionId, toSessionId, requestedByAgentId);
  }

  grantPermission(id: string): void { this.permsRepo.grant(id); }
  denyPermission(id: string): void { this.permsRepo.deny(id); }
  revokePermission(id: string): void { this.permsRepo.revoke(id); }

  getPendingRequests(toSessionId: string) {
    return this.permsRepo.findPending(toSessionId);
  }

  getAllPermissions(sessionId?: string) {
    return this.permsRepo.findAll({ sessionId });
  }

  canSend(fromSessionId: string, toSessionId: string): boolean {
    return this.permsRepo.canSend(fromSessionId, toSessionId);
  }
}
