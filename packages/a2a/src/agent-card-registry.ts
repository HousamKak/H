import type { AgentCard, RegisterAgentCardInput, AgentCardStatus, DiscoverAgentsFilter } from '@h/types';
import type { EventBus } from '@h/events';
import { A2ARepository } from '@h/db';

/**
 * Manages agent discovery cards — each agent registers on spawn,
 * unregisters on termination, and updates status when busy/idle.
 */
export class AgentCardRegistry {
  private repo: A2ARepository;

  constructor(private eventBus: EventBus) {
    this.repo = new A2ARepository();
  }

  async register(input: RegisterAgentCardInput): Promise<AgentCard> {
    const card = this.repo.upsertCard(input);

    await this.eventBus.emit('a2a.agent.registered', {
      agentId: card.agentId,
      name: card.name,
      capabilities: card.capabilities,
      projectId: card.projectId,
    }, {
      source: 'a2a-registry',
      sessionId: card.sessionId,
      projectId: card.projectId,
      agentId: card.agentId,
    });

    return card;
  }

  async unregister(agentId: string): Promise<void> {
    const card = this.repo.findCard(agentId);
    this.repo.deleteCard(agentId);

    if (card) {
      await this.eventBus.emit('a2a.agent.unregistered', {
        agentId,
        name: card.name,
      }, {
        source: 'a2a-registry',
        sessionId: card.sessionId,
        projectId: card.projectId,
        agentId,
      });
    }
  }

  discover(filter: DiscoverAgentsFilter): AgentCard[] {
    return this.repo.discover(filter);
  }

  findCard(agentId: string): AgentCard | undefined {
    return this.repo.findCard(agentId);
  }

  updateStatus(agentId: string, status: AgentCardStatus): void {
    this.repo.updateCardStatus(agentId, status);
  }
}
