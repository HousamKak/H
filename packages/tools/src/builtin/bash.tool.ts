import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import type { ToolDefinition, ToolExecutionResult } from '@h/types';
import type { ToolHandler } from '../tool-executor.js';

export const bashExecuteDefinition: ToolDefinition = {
  name: 'bash_execute',
  description: 'Execute a shell command and return stdout/stderr',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to execute' },
      timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' },
    },
    required: ['command'],
  },
  source: 'builtin',
  isEnabled: true,
};

export const bashExecuteHandler: ToolHandler = async (args, context): Promise<ToolExecutionResult> => {
  const command = args.command as string;
  const timeout = (args.timeout as number) ?? 30_000;
  const cwd = context.workingDirectory ?? process.cwd();

  return new Promise((resolve) => {
    const isWin = platform() === 'win32';
    const shell = isWin ? 'cmd' : 'bash';
    const shellArgs = isWin ? ['/c', command] : ['-c', command];

    const child = spawn(shell, shellArgs, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    const timer = setTimeout(() => {
      child.kill();
      resolve({
        success: false,
        output: { stdout, stderr },
        error: `Command timed out after ${timeout}ms`,
        durationMs: timeout,
      });
    }, timeout);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        success: code === 0,
        output: { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code },
        error: code !== 0 ? `Exit code ${code}: ${stderr.trim()}` : undefined,
        durationMs: 0,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        success: false,
        output: null,
        error: err.message,
        durationMs: 0,
      });
    });
  });
};
