import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { McpToolContext } from './types.js';
import { registerBlackboardTools } from './tools/blackboard.tools.js';
import { registerTaskTools } from './tools/task.tools.js';
import { registerSessionTools } from './tools/session.tools.js';
import { registerMemoryTools } from './tools/memory.tools.js';
import { registerFileTools } from './tools/file.tools.js';
import { registerA2ATools } from './tools/a2a.tools.js';

export class HMcpServer {
  private server: McpServer;
  private context: McpToolContext;

  constructor(context: McpToolContext) {
    this.context = context;
    this.server = new McpServer({
      name: 'h-orchestrator',
      version: '0.2.0',
    });

    this.registerAllTools();
  }

  private registerAllTools(): void {
    registerBlackboardTools(this.server, this.context);
    registerTaskTools(this.server, this.context);
    registerSessionTools(this.server, this.context);
    registerMemoryTools(this.server, this.context);
    registerFileTools(this.server, this.context);
    registerA2ATools(this.server, this.context);
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}
