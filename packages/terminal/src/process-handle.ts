import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';

export interface ProcessHandleOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  maxOutputLines?: number;
}

/**
 * Wraps child_process.spawn with event-based I/O and rolling output buffer.
 */
export class ProcessHandle extends EventEmitter {
  private process: ChildProcess | null = null;
  private outputBuffer: string[] = [];
  private maxOutputLines: number;
  private _exited = false;
  private _exitCode: number | null = null;
  private options: ProcessHandleOptions;

  constructor(options: ProcessHandleOptions) {
    super();
    this.options = options;
    this.maxOutputLines = options.maxOutputLines ?? 1000;
  }

  get pid(): number | undefined {
    return this.process?.pid;
  }

  get exited(): boolean {
    return this._exited;
  }

  get exitCode(): number | null {
    return this._exitCode;
  }

  start(): void {
    const isWindows = process.platform === 'win32';
    const env = { ...process.env, ...this.options.env };

    this.process = spawn(this.options.command, this.options.args ?? [], {
      cwd: this.options.cwd,
      env,
      shell: isWindows,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      this.appendOutput(text);
      this.emit('stdout', text);
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      this.appendOutput(text);
      this.emit('stderr', text);
    });

    this.process.on('exit', (code, signal) => {
      this._exited = true;
      this._exitCode = code;
      this.emit('exit', code, signal);
    });

    this.process.on('error', (err) => {
      this._exited = true;
      this.emit('error', err);
    });
  }

  write(data: string): void {
    if (this.process?.stdin?.writable) {
      this.process.stdin.write(data);
    }
  }

  async kill(signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
    if (!this.process || this._exited) return;

    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        // Force kill after 5s
        try { this.process?.kill('SIGKILL'); } catch {}
        resolve();
      }, 5000);

      this.process!.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });

      try {
        this.process!.kill(signal);
      } catch {
        clearTimeout(timeout);
        resolve();
      }
    });
  }

  getRecentOutput(lines?: number): string[] {
    if (!lines) return [...this.outputBuffer];
    return this.outputBuffer.slice(-lines);
  }

  private appendOutput(text: string): void {
    const newLines = text.split('\n');
    for (const line of newLines) {
      if (line.length > 0) {
        this.outputBuffer.push(line);
      }
    }
    // Trim to max
    if (this.outputBuffer.length > this.maxOutputLines) {
      this.outputBuffer = this.outputBuffer.slice(-this.maxOutputLines);
    }
  }
}
