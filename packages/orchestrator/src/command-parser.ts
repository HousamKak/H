export interface ParsedCommand {
  type: string;
  args: Record<string, any>;
  raw: string;
}

export class CommandParser {
  parse(input: string): ParsedCommand {
    const trimmed = input.trim();

    // Slash commands
    if (trimmed.startsWith('/')) {
      return this.parseSlashCommand(trimmed);
    }

    // Free-text (will be handled as a task or LLM query)
    return { type: 'freetext', args: { text: trimmed }, raw: trimmed };
  }

  private parseSlashCommand(input: string): ParsedCommand {
    const parts = input.substring(1).split(/\s+/);
    const command = parts[0].toLowerCase();
    const rest = parts.slice(1).join(' ');

    switch (command) {
      case 'status':
        return { type: 'status', args: {}, raw: input };

      case 'projects':
        return { type: 'projects', args: {}, raw: input };

      case 'project':
        return { type: 'project', args: { name: rest || undefined }, raw: input };

      case 'task':
        return { type: 'task', args: this.parseTaskArgs(rest), raw: input };

      case 'agents':
        return { type: 'agents', args: {}, raw: input };

      case 'spawn':
        return { type: 'spawn', args: { role: parts[1] ?? 'coder' }, raw: input };

      case 'stop':
        return { type: 'stop', args: { agentId: parts[1] }, raw: input };

      case 'ask':
        return { type: 'ask', args: { question: rest }, raw: input };

      case 'review':
        return { type: 'review', args: {}, raw: input };

      case 'memory':
        return { type: 'memory', args: { query: rest }, raw: input };

      case 'logs':
        return { type: 'logs', args: { agentId: parts[1], count: parseInt(parts[2]) || 20 }, raw: input };

      case 'help':
        return { type: 'help', args: {}, raw: input };

      default:
        return { type: 'unknown', args: { command, rest }, raw: input };
    }
  }

  private parseTaskArgs(text: string): Record<string, any> {
    const args: Record<string, any> = { title: text, description: text };

    // Parse priority flag: --priority high, -p critical
    const priorityMatch = text.match(/(?:--priority|-p)\s+(critical|high|medium|low)/i);
    if (priorityMatch) {
      args.priority = priorityMatch[1].toLowerCase();
      args.title = text.replace(priorityMatch[0], '').trim();
      args.description = args.title;
    }

    // Parse role flag: --role coder, -r reviewer
    const roleMatch = text.match(/(?:--role|-r)\s+(coder|reviewer|researcher|architect)/i);
    if (roleMatch) {
      args.role = roleMatch[1].toLowerCase();
      args.title = (args.title as string).replace(roleMatch[0], '').trim();
      args.description = args.title;
    }

    return args;
  }
}
