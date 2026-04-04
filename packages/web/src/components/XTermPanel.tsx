import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

interface XTermPanelProps {
  ptyId?: string;
  command?: string;
  args?: string[];
  cwd?: string;
  onSpawned?: (ptyId: string) => void;
  onExit?: (ptyId: string) => void;
}

/**
 * Interactive terminal panel using xterm.js.
 * In Tauri: connects to a real PTY via Tauri commands/events.
 * In browser: shows a placeholder (PTY requires native access).
 */
export function XTermPanel({ ptyId: initialPtyId, command, args, cwd, onSpawned, onExit }: XTermPanelProps) {
  const termRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [ptyId, setPtyId] = useState<string | undefined>(initialPtyId);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!termRef.current) return;

    const term = new XTerm({
      theme: {
        background: '#0a0f0a',
        foreground: '#33ff33',
        cursor: '#33ff33',
        cursorAccent: '#0a0f0a',
        selectionBackground: '#1a3a1a',
        black: '#0a0f0a',
        green: '#33ff33',
        brightGreen: '#66ff66',
        white: '#ccddcc',
        brightWhite: '#eeffee',
      },
      fontFamily: 'JetBrains Mono, Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(termRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    fitRef.current = fitAddon;

    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserver.observe(termRef.current);

    if (!isTauri) {
      term.writeln('\x1b[33m[H] Terminal requires the desktop app (Tauri).\x1b[0m');
      term.writeln('\x1b[90mPTY is not available in browser mode.\x1b[0m');
    }

    return () => {
      resizeObserver.disconnect();
      term.dispose();
      xtermRef.current = null;
      fitRef.current = null;
    };
  }, []);

  // Tauri PTY integration
  useEffect(() => {
    if (!isTauri || !xtermRef.current) return;

    let currentPtyId = ptyId;
    let unlisten: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;

    async function setup() {
      const { invoke } = await import('@tauri-apps/api/core');
      const { listen } = await import('@tauri-apps/api/event');

      // Spawn PTY if no existing ID
      if (!currentPtyId && command) {
        const cols = xtermRef.current?.cols ?? 80;
        const rows = xtermRef.current?.rows ?? 24;
        currentPtyId = await invoke<string>('pty_spawn', {
          command,
          args: args ?? [],
          cwd: cwd ?? '.',
          cols,
          rows,
        });
        setPtyId(currentPtyId);
        onSpawned?.(currentPtyId);
        setConnected(true);
      } else if (currentPtyId) {
        setConnected(true);
      }

      if (!currentPtyId) return;

      // Listen for PTY output
      unlisten = (await listen<{ pty_id: string; data: string }>('pty-output', (event) => {
        if (event.payload.pty_id === currentPtyId) {
          xtermRef.current?.write(event.payload.data);
        }
      })) as unknown as () => void;

      // Listen for PTY exit
      unlistenExit = (await listen<{ pty_id: string }>('pty-exit', (event) => {
        if (event.payload.pty_id === currentPtyId) {
          xtermRef.current?.writeln('\r\n\x1b[90m[Process exited]\x1b[0m');
          setConnected(false);
          onExit?.(currentPtyId!);
        }
      })) as unknown as () => void;

      // Send keystrokes to PTY
      xtermRef.current?.onData(async (data) => {
        if (currentPtyId && connected) {
          await invoke('pty_write', { ptyId: currentPtyId, data });
        }
      });

      // Handle resize
      xtermRef.current?.onResize(async ({ cols, rows }) => {
        if (currentPtyId) {
          await invoke('pty_resize', { ptyId: currentPtyId, cols, rows });
        }
      });
    }

    setup();

    return () => {
      unlisten?.();
      unlistenExit?.();
    };
  }, [isTauri, command, ptyId]);

  return (
    <div style={{ height: '100%', width: '100%', position: 'relative' }}>
      {!connected && ptyId && (
        <div style={{
          position: 'absolute', top: 4, right: 8, zIndex: 10,
          fontSize: 10, fontFamily: 'JetBrains Mono, monospace', color: '#ff3333',
        }}>
          DISCONNECTED
        </div>
      )}
      <div
        ref={termRef}
        style={{ height: '100%', width: '100%' }}
      />
    </div>
  );
}
