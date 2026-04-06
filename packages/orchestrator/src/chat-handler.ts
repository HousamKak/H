import type { LLMProvider } from '@h/llm';
import type { StatusReporter } from './status-reporter.js';

/**
 * Handles freetext user messages by calling an LLM with current system state
 * as context. The LLM can answer questions about sessions, projects, agents,
 * tasks, and terminals — or suggest actions the user can take.
 */
export class ChatHandler {
  constructor(
    private getProvider: () => LLMProvider,
    private statusReporter: StatusReporter,
  ) {}

  async handle(
    message: string,
    context: { sessionId?: string; projectId?: string },
  ): Promise<string> {
    const provider = this.getProvider();

    // Build a concise snapshot of current system state
    const stateLines: string[] = [];

    try {
      const status = this.statusReporter.getFullStatus(
        context.projectId,
        context.sessionId,
      );
      stateLines.push(status);
    } catch {
      stateLines.push('(unable to fetch system status)');
    }

    const systemPrompt = `You are H, a personal AI coding orchestrator. You help the user manage sessions, projects, agents, tasks, and terminals.

Current system state:
${stateLines.join('\n')}

You can answer questions about the current state, explain what's happening, and suggest actions.

Available slash commands the user can run:
- /status — full system overview
- /projects — list projects
- /project <name> — switch project
- /sessions — list sessions
- /session start <name> — start a new session
- /session end — end focused session
- /task <description> — create a task
- /agents — list active agents
- /spawn <role> — spawn an agent (coder, reviewer, researcher, architect, foreman)
- /stop <agentId> — stop an agent
- /memory — recall project memories
- /help — show all commands

When suggesting actions, tell the user which command to run. Keep responses concise and direct.
If you don't know something, say so — don't make up information not in the state above.`;

    const result = await provider.generate({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message },
      ],
      temperature: 0.3,
      maxTokens: 1024,
    });

    return result.content;
  }
}
