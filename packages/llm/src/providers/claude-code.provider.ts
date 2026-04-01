import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import type { LLMProvider, GenerateParams, GenerateResult } from '../types.js';

export class ClaudeCodeProvider implements LLMProvider {
  name = 'Claude Code CLI';
  type = 'claude-code' as const;
  private timeoutMs: number;

  constructor(options?: { timeoutMs?: number }) {
    this.timeoutMs = options?.timeoutMs ?? 120_000;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const result = await this.execCli(['--version']);
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  async generate(params: GenerateParams): Promise<GenerateResult> {
    const systemMessage = params.messages.find((m) => m.role === 'system');
    const lastUserMessage = [...params.messages].reverse().find((m) => m.role === 'user');

    const prompt = lastUserMessage?.content ?? '';
    const args = ['--print', '--output-format', 'text'];

    if (systemMessage) {
      args.push('--system-prompt', systemMessage.content);
    }

    const result = await this.execCli(args, prompt);

    return {
      content: stripAnsi(result.stdout.trim()),
      model: 'claude-code-cli',
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      finishReason: result.exitCode === 0 ? 'end_turn' : 'unknown',
    };
  }

  private execCli(args: string[], stdin?: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const cmd = platform() === 'win32' ? 'claude.cmd' : 'claude';
      const child = spawn(cmd, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: platform() === 'win32',
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => { stdout += data.toString(); });
      child.stderr.on('data', (data) => { stderr += data.toString(); });

      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`Claude Code CLI timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: code ?? 1 });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });

      if (stdin) {
        child.stdin.write(stdin);
        child.stdin.end();
      }
    });
  }
}

function stripAnsi(text: string): string {
  return text.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}
