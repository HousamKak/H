import { useState, useEffect, useCallback } from 'react';
import { api, type TerminalInfo } from '../api.js';

interface Props {
  sessionId?: string;
  projectId?: string;
}

export function TerminalsView({ sessionId, projectId }: Props) {
  const [terminals, setTerminals] = useState<TerminalInfo[]>([]);

  const refresh = useCallback(() => {
    if (!sessionId) return;
    api.terminals.list(sessionId, projectId).then(setTerminals).catch(() => {});
  }, [sessionId, projectId]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  if (!sessionId) {
    return (
      <div style={{ padding: 24, color: 'var(--text-dim)', fontFamily: 'VT323, monospace' }}>
        No active session. Start a session to see terminals.
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ fontFamily: 'Press Start 2P, monospace', fontSize: 14, color: 'var(--green)', marginBottom: 16 }}>
        TERMINALS
      </h2>

      {terminals.length === 0 ? (
        <div style={{ color: 'var(--text-dim)', fontFamily: 'VT323, monospace', fontSize: 18 }}>
          No terminals running. Spawn a Claude Code agent to see terminals here.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {terminals.map(t => (
            <div
              key={t.id}
              style={{
                border: '1px solid var(--border)',
                padding: 12,
                background: 'var(--bg-panel)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: 'var(--green)' }}>
                  {t.name}
                </span>
                <span style={{
                  fontSize: 11,
                  fontFamily: 'JetBrains Mono, monospace',
                  color: t.status === 'running' ? '#33ff33' : t.status === 'completed' ? '#888' : '#ff3333',
                }}>
                  [{t.status}]{t.pid ? ` PID:${t.pid}` : ''}
                </span>
              </div>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--text-dim)' }}>
                <div>Type: {t.type}</div>
                <div>CWD: {t.cwd}</div>
                <div>Command: {t.command}</div>
                {t.agentId && <div>Agent: {t.agentId.slice(0, 8)}</div>}
                {t.exitCode !== undefined && t.exitCode !== null && <div>Exit code: {t.exitCode}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
