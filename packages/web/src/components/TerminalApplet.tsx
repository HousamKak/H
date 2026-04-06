import { useState } from 'react';
import { api, type Applet, type Session, type Project, type TerminalAppletConfig, type ShellType } from '../api.js';
import { XTermPanel } from './XTermPanel.js';

interface Props {
  applet: Applet;
  sessions: Session[];
  allProjects: Project[];
  onUpdate: (applet: Applet) => void;
  onClose: () => void;
}

const SHELL_COMMANDS: Record<ShellType, { command: string; args: string[] }> = {
  cmd: { command: 'cmd.exe', args: [] },
  powershell: { command: 'powershell.exe', args: [] },
  pwsh: { command: 'pwsh.exe', args: [] },
  bash: { command: 'bash', args: [] },
  'git-bash': { command: 'C:/Program Files/Git/bin/bash.exe', args: [] },
  wsl: { command: 'wsl.exe', args: [] },
};

const isWindows = typeof navigator !== 'undefined' && navigator.platform.toLowerCase().includes('win');
const DEFAULT_SHELL: ShellType = isWindows ? 'powershell' : 'bash';

export function TerminalApplet({ applet, sessions, allProjects, onUpdate, onClose }: Props) {
  const cfg = applet.config as TerminalAppletConfig;
  const [terminalId, setTerminalId] = useState<string | undefined>(cfg.terminalId);
  const [status, setStatus] = useState<'idle' | 'spawning' | 'running' | 'exited' | 'error'>(
    cfg.terminalId ? 'running' : 'idle',
  );
  const [error, setError] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(!cfg.terminalId);

  const session = sessions.find(s => s.id === cfg.sessionId);

  const handleSpawn = async () => {
    setStatus('spawning');
    setError(null);
    try {
      let command: string;
      let args: string[] = [];
      let backendType = 'shell';

      if (cfg.kind === 'shell') {
        const shell = SHELL_COMMANDS[cfg.shellType ?? DEFAULT_SHELL];
        command = shell.command;
        args = shell.args;
      } else if (cfg.kind === 'claude') {
        command = 'claude';
        args = [];
      } else if (cfg.kind === 'super_claude') {
        command = 'claude';
        args = ['--dangerously-skip-permissions'];
      } else if (cfg.kind === 'dev_server') {
        command = cfg.command ?? 'pnpm';
        args = cfg.args ?? ['dev'];
        backendType = 'dev_server';
      } else {
        setError('Unknown kind');
        setStatus('error');
        return;
      }

      const project = allProjects.find(p => p.id === cfg.projectId);
      const cwd = cfg.cwd ?? project?.path;
      if (!cwd) {
        setError('No cwd set');
        setStatus('error');
        return;
      }

      const terminal = await api.terminals.spawn({
        sessionId: cfg.sessionId,
        projectId: cfg.projectId,
        name: applet.title ?? `${cfg.kind}-${Date.now()}`,
        type: backendType,
        command,
        args,
        cwd,
      });

      setTerminalId(terminal.id);
      setStatus('running');
      setConfigOpen(false);
      onUpdate({ ...applet, config: { ...cfg, terminalId: terminal.id, command, args } });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  };

  const handleKill = async () => {
    if (!terminalId) return;
    try {
      await api.terminals.kill(terminalId);
    } catch {}
    setStatus('exited');
    setTerminalId(undefined);
    onUpdate({ ...applet, config: { ...cfg, terminalId: undefined } });
  };

  const updateConfig = (patch: Partial<TerminalAppletConfig>) => {
    onUpdate({ ...applet, config: { ...cfg, ...patch } });
  };

  const kindLabel: Record<string, string> = {
    shell: 'SHELL',
    claude: 'CLAUDE',
    super_claude: 'SUPER',
    dev_server: 'DEV',
    attach: 'ATTACH',
  };
  const label = kindLabel[cfg.kind] ?? cfg.kind.toUpperCase();

  const headerStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '6px 10px',
    background: '#0a1a0a',
    borderBottom: '1px solid #1a3a1a',
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 11,
    flexShrink: 0,
  };

  const btnStyle: React.CSSProperties = {
    background: '#1a3a1a',
    color: '#33ff33',
    border: 'none',
    padding: '3px 10px',
    cursor: 'pointer',
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 10,
  };

  const selectStyle: React.CSSProperties = {
    background: '#0d1f0d',
    border: '1px solid #1a3a1a',
    color: '#33ff33',
    padding: '2px 6px',
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 10,
    outline: 'none',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0a0f0a' }}>
      <div style={headerStyle}>
        <span style={{ color: '#33ff33', fontWeight: 'bold' }}>[{label}]</span>
        <span style={{ color: status === 'running' ? '#33ff33' : status === 'error' ? '#ff3333' : '#666' }}>
          {status}
        </span>
        {session && <span style={{ color: '#33ccff' }}>{session.name ?? session.id.slice(0, 8)}</span>}
        <button onClick={() => setConfigOpen(!configOpen)} style={{ ...btnStyle, marginLeft: 'auto' }}>
          {configOpen ? 'HIDE' : 'CFG'}
        </button>
        {status === 'running' && <button onClick={handleKill} style={{ ...btnStyle, color: '#aa3333', background: 'transparent', border: '1px solid #aa3333' }}>KILL</button>}
        <button onClick={onClose} style={{ background: 'none', color: '#666', border: 'none', cursor: 'pointer', fontSize: 12, padding: '0 4px' }}>x</button>
      </div>

      {configOpen && (
        <div style={{ padding: 10, background: '#0d1f0d', borderBottom: '1px solid #1a3a1a', display: 'grid', gap: 6, fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ color: '#666', minWidth: 60 }}>kind:</label>
            <select value={cfg.kind} onChange={e => updateConfig({ kind: e.target.value as any })} style={selectStyle} disabled={status === 'running'}>
              <option value="shell">shell</option>
              <option value="claude">claude</option>
              <option value="super_claude">super claude</option>
              <option value="dev_server">dev server</option>
            </select>
          </div>
          {cfg.kind === 'shell' && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <label style={{ color: '#666', minWidth: 60 }}>shell:</label>
              <select value={cfg.shellType ?? DEFAULT_SHELL} onChange={e => updateConfig({ shellType: e.target.value as ShellType })} style={selectStyle} disabled={status === 'running'}>
                <option value="cmd">cmd.exe</option>
                <option value="powershell">PowerShell</option>
                <option value="pwsh">pwsh (PS 7+)</option>
                <option value="bash">bash</option>
                <option value="git-bash">Git Bash</option>
                <option value="wsl">WSL</option>
              </select>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ color: '#666', minWidth: 60 }}>session:</label>
            <select value={cfg.sessionId} onChange={e => updateConfig({ sessionId: e.target.value })} style={{ ...selectStyle, flex: 1 }} disabled={status === 'running'}>
              {sessions.map(s => <option key={s.id} value={s.id}>{s.name ?? s.id.slice(0, 8)}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ color: '#666', minWidth: 60 }}>project:</label>
            <select value={cfg.projectId} onChange={e => {
              const p = allProjects.find(pr => pr.id === e.target.value);
              updateConfig({ projectId: e.target.value, cwd: p?.path });
            }} style={{ ...selectStyle, flex: 1 }} disabled={status === 'running'}>
              {allProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          {cfg.kind === 'dev_server' && (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <label style={{ color: '#666', minWidth: 60 }}>command:</label>
                <input value={cfg.command ?? ''} onChange={e => updateConfig({ command: e.target.value })} placeholder="pnpm" style={{ ...selectStyle, flex: 1 }} disabled={status === 'running'} />
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <label style={{ color: '#666', minWidth: 60 }}>args:</label>
                <input value={(cfg.args ?? []).join(' ')} onChange={e => updateConfig({ args: e.target.value.split(/\s+/).filter(Boolean) })} placeholder="dev" style={{ ...selectStyle, flex: 1 }} disabled={status === 'running'} />
              </div>
            </>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ color: '#666', minWidth: 60 }}>cwd:</label>
            <input value={cfg.cwd ?? ''} onChange={e => updateConfig({ cwd: e.target.value })} placeholder="working dir" style={{ ...selectStyle, flex: 1 }} disabled={status === 'running'} />
          </div>
          {status !== 'running' && (
            <button onClick={handleSpawn} style={{ ...btnStyle, padding: '6px 12px', fontSize: 11, marginTop: 4 }}>
              {status === 'spawning' ? 'SPAWNING...' : 'SPAWN'}
            </button>
          )}
          {error && <div style={{ color: '#ff3333', fontSize: 10 }}>{error}</div>}
        </div>
      )}

      <div style={{ flex: 1, position: 'relative' }}>
        {terminalId ? (
          <XTermPanel key={terminalId} mode="websocket" terminalId={terminalId} />
        ) : (
          <div style={{ padding: 20, color: '#666', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>
            {status === 'idle' && 'Configure and click SPAWN to start.'}
            {status === 'spawning' && 'Spawning process...'}
            {status === 'exited' && 'Process exited. Configure to spawn a new one.'}
            {status === 'error' && `Error: ${error ?? 'unknown'}`}
          </div>
        )}
      </div>
    </div>
  );
}
