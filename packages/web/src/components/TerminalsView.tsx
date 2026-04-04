import { useState, useEffect, useCallback } from 'react';
import { api, type TerminalInfo } from '../api.js';
import { XTermPanel } from './XTermPanel.js';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

interface Props {
  sessionId?: string;
  projectId?: string;
}

interface InteractiveTerminal {
  id: string;
  name: string;
  command: string;
  args: string[];
  cwd: string;
  ptyId?: string;
}

export function TerminalsView({ sessionId, projectId }: Props) {
  const [terminals, setTerminals] = useState<TerminalInfo[]>([]);
  const [interactiveTerms, setInteractiveTerms] = useState<InteractiveTerminal[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | undefined>();
  const [showSpawnForm, setShowSpawnForm] = useState(false);
  const [spawnCwd, setSpawnCwd] = useState('');

  const refresh = useCallback(() => {
    if (!sessionId) return;
    api.terminals.list(sessionId, projectId).then(setTerminals).catch(() => {});
  }, [sessionId, projectId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  const handleSpawnShell = () => {
    if (!spawnCwd.trim()) return;
    const id = `interactive-${Date.now()}`;
    const isWindows = navigator.platform.toLowerCase().includes('win');
    const term: InteractiveTerminal = {
      id,
      name: `shell-${interactiveTerms.length + 1}`,
      command: isWindows ? 'cmd.exe' : 'bash',
      args: [],
      cwd: spawnCwd.trim(),
    };
    setInteractiveTerms(prev => [...prev, term]);
    setActiveTabId(id);
    setShowSpawnForm(false);
    setSpawnCwd('');
  };

  const handleSpawnClaude = () => {
    if (!spawnCwd.trim()) return;
    const id = `interactive-${Date.now()}`;
    const term: InteractiveTerminal = {
      id,
      name: `claude-${interactiveTerms.length + 1}`,
      command: 'claude',
      args: [],
      cwd: spawnCwd.trim(),
    };
    setInteractiveTerms(prev => [...prev, term]);
    setActiveTabId(id);
    setShowSpawnForm(false);
    setSpawnCwd('');
  };

  const handleCloseTab = (id: string) => {
    setInteractiveTerms(prev => prev.filter(t => t.id !== id));
    if (activeTabId === id) {
      setActiveTabId(interactiveTerms[0]?.id);
    }
  };

  if (!sessionId) {
    return (
      <div style={{ padding: 24, color: 'var(--text-dim)', fontFamily: 'VT323, monospace' }}>
        No active session. Start a session to use terminals.
      </div>
    );
  }

  const activeInteractive = interactiveTerms.find(t => t.id === activeTabId);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 0,
        borderBottom: '1px solid var(--border)', background: '#050a05',
        padding: '0 8px', minHeight: 32, flexShrink: 0,
      }}>
        {interactiveTerms.map(t => (
          <div
            key={t.id}
            onClick={() => setActiveTabId(t.id)}
            style={{
              padding: '4px 12px',
              background: t.id === activeTabId ? '#0d1f0d' : 'transparent',
              borderBottom: t.id === activeTabId ? '2px solid #33ff33' : '2px solid transparent',
              color: t.id === activeTabId ? '#33ff33' : '#1a6a1a',
              cursor: 'pointer',
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 11,
              display: 'flex', alignItems: 'center', gap: 8,
            }}
          >
            <span>{t.name}</span>
            <span
              onClick={(e) => { e.stopPropagation(); handleCloseTab(t.id); }}
              style={{ color: '#666', cursor: 'pointer', fontSize: 10 }}
            >x</span>
          </div>
        ))}

        {/* Spawn buttons */}
        {isTauri ? (
          showSpawnForm ? (
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginLeft: 8 }}>
              <input
                value={spawnCwd}
                onChange={e => setSpawnCwd(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSpawnShell()}
                placeholder="working directory..."
                style={{ background: '#0d1f0d', border: '1px solid #1a3a1a', color: '#33ff33', padding: '2px 6px', fontFamily: 'JetBrains Mono, monospace', fontSize: 10, width: 180 }}
                autoFocus
              />
              <button onClick={handleSpawnShell} style={{ background: '#1a3a1a', color: '#33ff33', border: 'none', padding: '2px 8px', cursor: 'pointer', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}>SHELL</button>
              <button onClick={handleSpawnClaude} style={{ background: '#1a3a1a', color: '#33ccff', border: 'none', padding: '2px 8px', cursor: 'pointer', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}>CLAUDE</button>
              <button onClick={() => setShowSpawnForm(false)} style={{ background: 'none', color: '#666', border: 'none', cursor: 'pointer', fontSize: 10 }}>x</button>
            </div>
          ) : (
            <button
              onClick={() => setShowSpawnForm(true)}
              style={{ background: 'none', color: '#1a6a1a', border: 'none', cursor: 'pointer', fontSize: 14, marginLeft: 8, fontFamily: 'JetBrains Mono, monospace' }}
            >+</button>
          )
        ) : (
          <span style={{ marginLeft: 8, color: '#666', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}>
            Interactive terminals require desktop app
          </span>
        )}
      </div>

      {/* Terminal content */}
      <div style={{ flex: 1, position: 'relative' }}>
        {activeInteractive ? (
          <XTermPanel
            key={activeInteractive.id}
            command={activeInteractive.command}
            args={activeInteractive.args}
            cwd={activeInteractive.cwd}
            ptyId={activeInteractive.ptyId}
            onSpawned={(id) => {
              setInteractiveTerms(prev => prev.map(t =>
                t.id === activeInteractive.id ? { ...t, ptyId: id } : t
              ));
            }}
          />
        ) : (
          <div style={{ padding: 24 }}>
            <h3 style={{ fontFamily: 'Press Start 2P, monospace', fontSize: 12, color: 'var(--green)', marginBottom: 16 }}>
              MANAGED TERMINALS
            </h3>
            {terminals.length === 0 ? (
              <div style={{ color: 'var(--text-dim)', fontFamily: 'VT323, monospace', fontSize: 18 }}>
                No terminals running. Spawn a Claude Code agent or click + to open a shell.
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 12 }}>
                {terminals.map(t => (
                  <div key={t.id} style={{ border: '1px solid var(--border)', padding: 12, background: 'var(--bg-panel)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: 'var(--green)' }}>{t.name}</span>
                      <span style={{ fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: t.status === 'running' ? '#33ff33' : t.status === 'completed' ? '#888' : '#ff3333' }}>
                        [{t.status}]{t.pid ? ` PID:${t.pid}` : ''}
                      </span>
                    </div>
                    <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--text-dim)' }}>
                      <div>Type: {t.type} | CWD: {t.cwd}</div>
                      {t.agentId && <div>Agent: {t.agentId.slice(0, 8)}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
