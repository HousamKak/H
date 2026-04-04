import type { Terminal, SpawnTerminalInput, TerminalStatus } from '@h/types';
import type { EventBus } from '@h/events';
import { TerminalRepository } from '@h/db';
import { ProcessHandle } from './process-handle.js';
import { OutputParser, type ClaudeCodeEvent } from './output-parser.js';

export type TerminalOutputHandler = (chunk: string, stream: 'stdout' | 'stderr') => void;
export type TerminalExitHandler = (exitCode: number | null) => void;

interface ManagedTerminal {
  terminal: Terminal;
  handle: ProcessHandle;
  parser?: OutputParser;
  eventHandlers: Array<(event: ClaudeCodeEvent) => void>;
  outputHandlers: Set<TerminalOutputHandler>;
  exitHandlers: Set<TerminalExitHandler>;
}

export class TerminalManager {
  private terminals: Map<string, ManagedTerminal> = new Map();
  private terminalRepo: TerminalRepository;

  constructor(private eventBus: EventBus) {
    this.terminalRepo = new TerminalRepository();
  }

  /**
   * Spawn a generic terminal/process.
   */
  async spawn(input: SpawnTerminalInput): Promise<Terminal> {
    const terminal = this.terminalRepo.create(input);

    const handle = new ProcessHandle({
      command: input.command,
      args: input.args,
      cwd: input.cwd,
      env: input.env,
    });

    const managed: ManagedTerminal = { terminal, handle, eventHandlers: [], outputHandlers: new Set(), exitHandlers: new Set() };
    this.terminals.set(terminal.id, managed);

    this.wireHandleEvents(managed);
    handle.start();

    // Update with PID
    if (handle.pid) {
      this.terminalRepo.updateStatus(terminal.id, 'running', { pid: handle.pid });
      managed.terminal = { ...terminal, status: 'running', pid: handle.pid };
    }

    await this.eventBus.emit('terminal.spawned', {
      terminalId: terminal.id,
      type: terminal.type,
      command: input.command,
      pid: handle.pid,
    }, {
      source: 'terminal-manager',
      sessionId: input.sessionId,
      projectId: input.projectId,
    });

    return managed.terminal;
  }

  /**
   * Spawn Claude Code in automated mode with stream-json output.
   */
  async spawnClaudeCode(input: SpawnTerminalInput & {
    prompt: string;
    mcpConfigPath?: string;
  }): Promise<Terminal> {
    const args = [
      '-p', input.prompt,
      '--output-format', 'stream-json',
    ];
    if (input.mcpConfigPath) {
      args.push('--mcp-config', input.mcpConfigPath);
    }

    const terminal = this.terminalRepo.create({
      ...input,
      command: 'claude',
      args,
      type: 'claude_code_automated',
    });

    const handle = new ProcessHandle({
      command: 'claude',
      args,
      cwd: input.cwd,
      env: input.env,
    });

    const parser = new OutputParser();
    const managed: ManagedTerminal = { terminal, handle, parser, eventHandlers: [], outputHandlers: new Set(), exitHandlers: new Set() };
    this.terminals.set(terminal.id, managed);

    // Wire stream-json parsing
    handle.on('stdout', (data: string) => {
      const events = parser.feed(data);
      for (const event of events) {
        for (const handler of managed.eventHandlers) {
          handler(event);
        }
        this.eventBus.emit('claude_code.output', {
          terminalId: terminal.id,
          event,
        }, {
          source: 'terminal-manager',
          sessionId: input.sessionId,
          projectId: input.projectId,
          agentId: input.agentId,
        });
      }
    });

    this.wireHandleEvents(managed);
    handle.start();

    if (handle.pid) {
      this.terminalRepo.updateStatus(terminal.id, 'running', { pid: handle.pid });
      managed.terminal = { ...terminal, status: 'running', pid: handle.pid };
    }

    await this.eventBus.emit('claude_code.spawned', {
      terminalId: terminal.id,
      agentId: input.agentId,
      pid: handle.pid,
    }, {
      source: 'terminal-manager',
      sessionId: input.sessionId,
      projectId: input.projectId,
      agentId: input.agentId,
    });

    return managed.terminal;
  }

  /**
   * Write to a terminal's stdin.
   */
  write(terminalId: string, data: string): void {
    const managed = this.terminals.get(terminalId);
    if (managed) managed.handle.write(data);
  }

  /**
   * Kill a terminal process.
   */
  async kill(terminalId: string): Promise<void> {
    const managed = this.terminals.get(terminalId);
    if (!managed) return;

    await managed.handle.kill();
    this.terminalRepo.updateStatus(terminalId, 'stopped');
    this.terminals.delete(terminalId);
  }

  /**
   * Kill all terminals in a session.
   */
  async killSession(sessionId: string): Promise<void> {
    const toKill: string[] = [];
    for (const [id, managed] of this.terminals) {
      if (managed.terminal.sessionId === sessionId) {
        toKill.push(id);
      }
    }
    await Promise.all(toKill.map(id => this.kill(id)));
  }

  /**
   * Get recent output from a terminal.
   */
  getOutput(terminalId: string, lines?: number): string[] {
    const managed = this.terminals.get(terminalId);
    return managed?.handle.getRecentOutput(lines) ?? [];
  }

  /**
   * Get terminals for a session, optionally filtered by project.
   */
  getTerminals(sessionId: string, projectId?: string): Terminal[] {
    return this.terminalRepo.findBySession(sessionId, projectId);
  }

  /**
   * Get a single terminal by ID.
   */
  getTerminal(terminalId: string): Terminal | undefined {
    return this.terminalRepo.findById(terminalId);
  }

  /**
   * Subscribe to structured Claude Code events for a terminal.
   */
  onClaudeCodeEvent(terminalId: string, handler: (event: ClaudeCodeEvent) => void): void {
    const managed = this.terminals.get(terminalId);
    if (managed) {
      managed.eventHandlers.push(handler);
    }
  }

  /**
   * Subscribe to raw stdout/stderr output from a terminal.
   * Returns an unsubscribe function. Used by WebSocket streaming.
   */
  subscribeOutput(terminalId: string, handler: TerminalOutputHandler): () => void {
    const managed = this.terminals.get(terminalId);
    if (!managed) return () => {};
    managed.outputHandlers.add(handler);
    return () => { managed.outputHandlers.delete(handler); };
  }

  /**
   * Subscribe to terminal exit events.
   */
  subscribeExit(terminalId: string, handler: TerminalExitHandler): () => void {
    const managed = this.terminals.get(terminalId);
    if (!managed) return () => {};
    managed.exitHandlers.add(handler);
    return () => { managed.exitHandlers.delete(handler); };
  }

  /**
   * Check if terminal has a live in-memory process handle (running).
   */
  isActive(terminalId: string): boolean {
    return this.terminals.has(terminalId);
  }

  private wireHandleEvents(managed: ManagedTerminal): void {
    const { terminal, handle, parser } = managed;

    // Forward raw output to all subscribers (for WebSocket streaming)
    handle.on('stdout', (data: string) => {
      for (const handler of managed.outputHandlers) {
        try { handler(data, 'stdout'); } catch {}
      }
    });
    handle.on('stderr', (data: string) => {
      for (const handler of managed.outputHandlers) {
        try { handler(data, 'stderr'); } catch {}
      }
    });

    handle.on('exit', (code: number | null) => {
      // Flush remaining parser buffer
      if (parser) {
        const remaining = parser.flush();
        for (const event of remaining) {
          for (const handler of managed.eventHandlers) {
            handler(event);
          }
        }
      }

      const status: TerminalStatus = code === 0 ? 'completed' : 'crashed';
      this.terminalRepo.updateStatus(terminal.id, status, { exitCode: code ?? undefined });

      // Notify WebSocket subscribers
      for (const handler of managed.exitHandlers) {
        try { handler(code); } catch {}
      }

      this.eventBus.emit('terminal.exited', {
        terminalId: terminal.id,
        exitCode: code,
        status,
      }, {
        source: 'terminal-manager',
        sessionId: terminal.sessionId,
        projectId: terminal.projectId,
        agentId: terminal.agentId,
      });

      this.terminals.delete(terminal.id);
    });

    handle.on('error', (err: Error) => {
      this.terminalRepo.updateStatus(terminal.id, 'crashed');

      this.eventBus.emit('terminal.error', {
        terminalId: terminal.id,
        error: err.message,
      }, {
        source: 'terminal-manager',
        sessionId: terminal.sessionId,
        projectId: terminal.projectId,
        agentId: terminal.agentId,
      });
    });
  }
}
