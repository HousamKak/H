import { useState, useEffect } from 'react';
import { api, type Applet, type Session, type Project } from '../api.js';
import { XTermPanel } from './XTermPanel.js';

interface Props {
  applet: Applet;
  sessions: Session[];
  allProjects: Project[];
  onUpdate: (applet: Applet) => void;
  onClose: () => void;
}

export function TerminalApplet({ applet, sessions, allProjects, onUpdate, onClose }: Props) {
  const [terminalId, setTerminalId] = useState<string | undefined>(applet.config.terminalId);
  const [status, setStatus] = useState<'idle' | 'spawning' | 'running' | 'exited' | 'error'>(
    applet.config.terminalId ? 'running' : 'idle',
  );
  const [error, setError] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(!applet.config.terminalId);

  const session = sessions.find(s => s.id === applet.config.sessionId);
  const sessionProjects = allProjects.filter(p => {
    // Will be refined — for now show all projects
    return true;
  });

  const handleSpawn = async () => {
    setStatus('spawning');
    setError(null);
    try {
      const cfg = applet.config;
      let command: string;
      let args: string[] = [];

      if (cfg.kind === 'claude_code') {
        command = 'claude';
        // No args = interactive mode (for future PTY); for now we just use claude CLI
      } else if (cfg.kind === 'shell') {
        const isWindows = navigator.platform.toLowerCase().includes('win');
        command = isWindows ? 'cmd.exe' : 'bash';
      } else if (cfg.kind === 'dev_server') {
        command = cfg.command ?? 'pnpm';
        args = cfg.args ?? ['dev'];
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
        type: cfg.kind === 'claude_code' ? 'claude_code_interactive' : cfg.kind === 'dev_server' ? 'dev_server' : 'shell',
        command,
        args: cfg.args ?? args,
        cwd,
      });

      setTerminalId(terminal.id);
      setStatus('running');
      setConfigOpen(false);
      onUpdate({ ...applet, config: { ...applet.config, terminalId: terminal.id, command, args: cfg.args ?? args } });
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
    onUpdate({ ...applet, config: { ...applet.config, terminalId: undefined } });
  };

  const updateConfig = (patch: Partial<Applet['config']>) => {
    onUpdate({ ...applet, config: { ...applet.config, ...patch } });
  };

  const kindLabel = {
    claude_code: 'CLAUDE',
    shell: 'SHELL',
    dev_server: 'DEV',
    attach: 'ATTACH',
  }[applet.config.kind];

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
        <span style={{ color: '#33ff33', fontWeight: 'bold' }}>[{kindLabel}]</span>
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
            <select value={applet.config.kind} onChange={e => updateConfig({ kind: e.target.value as any })} style={selectStyle} disabled={status === 'running'}>
              <option value="claude_code">claude_code</option>
              <option value="shell">shell</option>
              <option value="dev_server">dev_server</option>
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ color: '#666', minWidth: 60 }}>session:</label>
            <select value={applet.config.sessionId} onChange={e => updateConfig({ sessionId: e.target.value })} style={{ ...selectStyle, flex: 1 }} disabled={status === 'running'}>
              {sessions.map(s => <option key={s.id} value={s.id}>{s.name ?? s.id.slice(0, 8)}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ color: '#666', minWidth: 60 }}>project:</label>
            <select value={applet.config.projectId} onChange={e => {
              const p = allProjects.find(pr => pr.id === e.target.value);
              updateConfig({ projectId: e.target.value, cwd: p?.path });
            }} style={{ ...selectStyle, flex: 1 }} disabled={status === 'running'}>
              {allProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          {applet.config.kind === 'dev_server' && (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <label style={{ color: '#666', minWidth: 60 }}>command:</label>
                <input value={applet.config.command ?? ''} onChange={e => updateConfig({ command: e.target.value })} placeholder="pnpm" style={{ ...selectStyle, flex: 1 }} disabled={status === 'running'} />
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <label style={{ color: '#666', minWidth: 60 }}>args:</label>
                <input value={(applet.config.args ?? []).join(' ')} onChange={e => updateConfig({ args: e.target.value.split(/\s+/).filter(Boolean) })} placeholder="dev" style={{ ...selectStyle, flex: 1 }} disabled={status === 'running'} />
              </div>
            </>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ color: '#666', minWidth: 60 }}>cwd:</label>
            <input value={applet.config.cwd ?? ''} onChange={e => updateConfig({ cwd: e.target.value })} placeholder="working dir" style={{ ...selectStyle, flex: 1 }} disabled={status === 'running'} />
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
