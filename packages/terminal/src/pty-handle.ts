import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

// node-pty is a CJS native module; load via createRequire so this ESM module
// can consume it, and defer the require so packages that never spawn PTYs
// (tests, tooling) don't crash at import time if the native binding is missing.
//
// When esbuild bundles this into CJS (h-backend.cjs), import.meta.url is
// undefined — fall back to __filename which IS defined in CJS context.
const nodeRequire = createRequire(
  typeof __filename !== 'undefined' ? __filename : import.meta.url
);

type NodePty = {
  spawn: (file: string, args: string[] | string, options: {
    name?: string; cols?: number; rows?: number; cwd?: string; env?: Record<string, string | undefined>;
  }) => IPty;
};

type IPty = {
  pid: number;
  onData: (cb: (data: string) => void) => void;
  onExit: (cb: (e: { exitCode: number; signal?: number }) => void) => void;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: (signal?: string) => void;
};

let ptyModule: NodePty | null = null;
function loadPty(): NodePty {
  if (ptyModule) return ptyModule;
  ptyModule = nodeRequire('@homebridge/node-pty-prebuilt-multiarch') as NodePty;
  return ptyModule;
}

export interface PtyHandleOptions {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
  maxOutputLines?: number;
}

/**
 * Wraps node-pty with event-based I/O. Mirrors ProcessHandle's event surface
 * (stdout/exit/error) so TerminalManager can swap between pipe-based and
 * PTY-based terminals without caring which it got.
 *
 * Differences from ProcessHandle:
 *  - No separate stderr; PTY merges stdout+stderr by design. All output is
 *    emitted as 'stdout'.
 *  - resize(cols, rows) is meaningful (pipe version would no-op).
 *  - write() accepts raw bytes/strings including control sequences; the
 *    terminal emulator handles echo, line editing, prompts, etc. natively.
 */
export class PtyHandle extends EventEmitter {
  private pty: IPty | null = null;
  private outputBuffer: string[] = [];
  private maxOutputLines: number;
  private _exited = false;
  private _exitCode: number | null = null;
  private options: PtyHandleOptions;

  constructor(options: PtyHandleOptions) {
    super();
    this.options = options;
    this.maxOutputLines = options.maxOutputLines ?? 1000;
  }

  get pid(): number | undefined { return this.pty?.pid; }
  get exited(): boolean { return this._exited; }
  get exitCode(): number | null { return this._exitCode; }

  start(): void {
    const pty = loadPty();
    const env: Record<string, string | undefined> = { ...process.env, ...this.options.env };
    // Give the shell something sane to advertise — xterm.js is compatible with xterm-256color.
    env.TERM = env.TERM ?? 'xterm-256color';

    // On Windows, node-pty can't spawn .cmd/.bat scripts directly (e.g. `claude`
    // is installed as `claude.cmd`). Wrap through cmd.exe /c so Windows resolves
    // the command via PATHEXT the same way a shell would.
    let command = this.options.command;
    let args = this.options.args ?? [];
    if (process.platform === 'win32' && !command.match(/\.(exe|com)$/i)) {
      args = ['/c', command, ...args];
      command = 'cmd.exe';
    }

    this.pty = pty.spawn(
      command,
      args,
      {
        name: 'xterm-256color',
        cols: this.options.cols ?? 80,
        rows: this.options.rows ?? 24,
        cwd: this.options.cwd,
        env,
      },
    );

    this.pty.onData((data: string) => {
      this.appendOutput(data);
      this.emit('stdout', data);
    });

    this.pty.onExit(({ exitCode }) => {
      this._exited = true;
      this._exitCode = exitCode;
      this.emit('exit', exitCode, null);
    });
  }

  write(data: string): void {
    if (this.pty && !this._exited) {
      try { this.pty.write(data); } catch { /* pty closed */ }
    }
  }

  resize(cols: number, rows: number): void {
    if (this.pty && !this._exited && cols > 0 && rows > 0) {
      try { this.pty.resize(cols, rows); } catch { /* pty closed */ }
    }
  }

  async kill(_signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
    if (!this.pty || this._exited) return;
    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => resolve(), 5000);
      this.once('exit', () => { clearTimeout(timeout); resolve(); });
      try { this.pty!.kill(); } catch { clearTimeout(timeout); resolve(); }
    });
  }

  getRecentOutput(lines?: number): string[] {
    if (!lines) return [...this.outputBuffer];
    return this.outputBuffer.slice(-lines);
  }

  private appendOutput(text: string): void {
    for (const line of text.split('\n')) {
      if (line.length > 0) this.outputBuffer.push(line);
    }
    if (this.outputBuffer.length > this.maxOutputLines) {
      this.outputBuffer = this.outputBuffer.slice(-this.maxOutputLines);
    }
  }
}
