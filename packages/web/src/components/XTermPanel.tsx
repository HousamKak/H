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
const WS_BASE = isTauri
  ? 'ws://localhost:3100'
  : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}`;

type Mode = 'tauri' | 'websocket';

interface XTermPanelProps {
  mode?: Mode;                  // defaults to 'websocket' (works in browser + Tauri)
  terminalId?: string;          // attach to existing terminal (websocket mode)
  ptyId?: string;               // Tauri PTY id (tauri mode)
  command?: string;             // for Tauri PTY spawn
  args?: string[];
  cwd?: string;
  onSpawned?: (id: string) => void;
  onExit?: (id: string) => void;
}

/**
 * Interactive terminal panel using xterm.js.
 * - websocket mode: connects to /ws/terminals/:id (works in browser)
 * - tauri mode: uses Tauri PTY commands/events (full PTY, desktop only)
 */
export function XTermPanel({ mode = 'websocket', terminalId, ptyId, command, args, cwd, onSpawned, onExit }: XTermPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<string>('');

  // Initialize xterm
  useEffect(() => {
    if (!containerRef.current) return;

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
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    setTimeout(() => fitAddon.fit(), 50);

    xtermRef.current = term;
    fitRef.current = fitAddon;

    const resizeObserver = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch {}
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      term.dispose();
      xtermRef.current = null;
      fitRef.current = null;
    };
  }, []);

  // WebSocket mode
  useEffect(() => {
    if (mode !== 'websocket' || !terminalId || !xtermRef.current) return;

    const term = xtermRef.current;
    term.writeln(`\x1b[90m[H] Connecting to terminal ${terminalId.slice(0, 8)}...\x1b[0m`);

    const ws = new WebSocket(`${WS_BASE}/ws/terminals/${terminalId}`);

    ws.onopen = () => setConnected(true);

    ws.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data);
        if (parsed.type === 'output') {
          term.write(parsed.data);
        } else if (parsed.type === 'exit') {
          term.writeln(`\r\n\x1b[90m[Process exited with code ${parsed.exitCode}]\x1b[0m`);
          setConnected(false);
          setStatus(`exited(${parsed.exitCode})`);
          onExit?.(terminalId);
        } else if (parsed.type === 'error') {
          term.writeln(`\r\n\x1b[31m[Error: ${parsed.error}]\x1b[0m`);
          setStatus('error');
        } else if (parsed.type === 'ready') {
          setStatus('connected');
        }
      } catch { /* ignore */ }
    };

    ws.onerror = () => {
      term.writeln('\r\n\x1b[31m[WebSocket error]\x1b[0m');
      setStatus('error');
    };

    ws.onclose = () => {
      setConnected(false);
      if (status !== 'exited') setStatus('disconnected');
    };

    // Send keystrokes
    const disposeData = term.onData((data) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'stdin', data }));
      }
    });

    return () => {
      disposeData.dispose();
      ws.close();
    };
  }, [mode, terminalId]);

  // Tauri PTY mode (unchanged)
  useEffect(() => {
    if (mode !== 'tauri' || !isTauri || !xtermRef.current) return;

    let currentPtyId = ptyId;
    let unlisten: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;

    async function setup() {
      const { invoke } = await import('@tauri-apps/api/core');
      const { listen } = await import('@tauri-apps/api/event');

      if (!currentPtyId && command) {
        const cols = xtermRef.current?.cols ?? 80;
        const rows = xtermRef.current?.rows ?? 24;
        currentPtyId = await invoke<string>('pty_spawn', {
          command, args: args ?? [], cwd: cwd ?? '.', cols, rows,
        });
        onSpawned?.(currentPtyId);
      }
      if (!currentPtyId) return;
      setConnected(true);

      unlisten = (await listen<{ pty_id: string; data: string }>('pty-output', (event) => {
        if (event.payload.pty_id === currentPtyId) xtermRef.current?.write(event.payload.data);
      })) as unknown as () => void;
      unlistenExit = (await listen<{ pty_id: string }>('pty-exit', (event) => {
        if (event.payload.pty_id === currentPtyId) {
          xtermRef.current?.writeln('\r\n\x1b[90m[Process exited]\x1b[0m');
          setConnected(false);
          onExit?.(currentPtyId!);
        }
      })) as unknown as () => void;

      xtermRef.current?.onData(async (data) => {
        if (currentPtyId && connected) await invoke('pty_write', { ptyId: currentPtyId, data });
      });
      xtermRef.current?.onResize(async ({ cols, rows }) => {
        if (currentPtyId) await invoke('pty_resize', { ptyId: currentPtyId, cols, rows });
      });
    }

    setup();
    return () => { unlisten?.(); unlistenExit?.(); };
  }, [mode, ptyId, command]);

  return (
    <div
      style={{ height: '100%', width: '100%', position: 'relative', background: '#0a0f0a' }}
      onClick={() => xtermRef.current?.focus()}
    >
      {status && (
        <div style={{
          position: 'absolute', top: 2, right: 6, zIndex: 10,
          fontSize: 9, fontFamily: 'JetBrains Mono, monospace',
          color: connected ? '#33ff33' : '#aa3333',
        }}>
          {status}
        </div>
      )}
      <div ref={containerRef} style={{ height: '100%', width: '100%' }} />
    </div>
  );
}
