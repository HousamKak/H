import { writeFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export interface McpConfigInput {
  agentId: string;
  sessionId: string;
  projectId: string;
  dbPath: string;
  mcpEntryPath: string; // absolute path to stdio-entry.js
}

/**
 * Generates per-agent MCP config JSON files that tell Claude Code
 * to spawn H's MCP server as a stdio subprocess.
 */
export class McpConfigGenerator {
  private configDir: string;

  constructor(baseDir: string = './data/mcp-configs') {
    this.configDir = resolve(baseDir);
    mkdirSync(this.configDir, { recursive: true });
  }

  /**
   * Generate a per-agent MCP config file and return its absolute path.
   */
  generate(input: McpConfigInput): string {
    const configPath = join(this.configDir, `${input.agentId}.json`);

    const config = {
      mcpServers: {
        'h-orchestrator': {
          command: 'node',
          args: [
            input.mcpEntryPath,
            '--agent-id', input.agentId,
            '--session-id', input.sessionId,
            '--project-id', input.projectId,
          ],
          env: {
            H_DB_PATH: resolve(input.dbPath),
          },
        },
      },
    };

    writeFileSync(configPath, JSON.stringify(config, null, 2));
    return configPath;
  }

  /**
   * Clean up a per-agent config file when the agent terminates.
   */
  cleanup(agentId: string): void {
    const configPath = join(this.configDir, `${agentId}.json`);
    try {
      if (existsSync(configPath)) unlinkSync(configPath);
    } catch { /* ignore */ }
  }

  /**
   * Get the path where a config would be generated.
   */
  getConfigPath(agentId: string): string {
    return join(this.configDir, `${agentId}.json`);
  }
}
