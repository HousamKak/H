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

    // Build a single prompt from the full conversation (excluding system)
    const conversationMessages = params.messages.filter((m) => m.role !== 'system');
    const prompt = conversationMessages.map((m) => {
      const role = m.role === 'assistant' ? 'Assistant' : 'Human';
      return `${role}: ${m.content}`;
    }).join('\n\n') + '\n\nAssistant:';

    const args = ['--print', '--output-format', 'json'];

    if (systemMessage) {
      args.push('--system-prompt', systemMessage.content);
    }

    const result = await this.execCli(args, prompt);

    // Parse the JSON envelope from Claude Code CLI
    let content: string;
    let usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

    try {
      const envelope = JSON.parse(result.stdout);
      content = envelope.result ?? result.stdout.trim();
      if (envelope.usage) {
        usage = {
          inputTokens: envelope.usage.input_tokens ?? 0,
          outputTokens: envelope.usage.output_tokens ?? 0,
          totalTokens: (envelope.usage.input_tokens ?? 0) + (envelope.usage.output_tokens ?? 0),
        };
      }
    } catch {
      content = stripAnsi(result.stdout.trim());
    }

    return {
      content,
      model: 'claude-code-cli',
      usage,
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
