import { useEffect, useRef, useState } from 'react';
import { api, type Session, type Project } from '../api.js';
import { XTermPanel } from './XTermPanel.js';

interface Props {
  sessionId?: string;
  projectId?: string;
  allProjects: Project[];
}

/**
 * Standalone Claude Code terminal with auto-MCP.
 * Spawns `claude` in a PTY with H's MCP config injected so Claude
 * has full access to sessions, projects, agents, tasks, memory, etc.
 */
export function ClaudeTerminal({ sessionId, projectId, allProjects }: Props) {
  const [terminalId, setTerminalId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spawning, setSpawning] = useState(false);
  const spawnedRef = useRef(false);

  const project = allProjects.find(p => p.id === projectId);

  useEffect(() => {
    if (!sessionId || !projectId || spawnedRef.current) return;
    spawnedRef.current = true;
    setSpawning(true);

    api.terminals.spawn({
      sessionId,
      projectId,
      name: 'super-claude',
      type: 'shell',
      command: 'claude',
      args: ['--dangerously-skip-permissions'],
      cwd: project?.path ?? '.',
    }).then(terminal => {
      setTerminalId(terminal.id);
      setSpawning(false);
    }).catch(err => {
      setError(err instanceof Error ? err.message : String(err));
      setSpawning(false);
      spawnedRef.current = false;
    });
  }, [sessionId, projectId, project?.path]);

  const handleRestart = () => {
    if (terminalId) {
      api.terminals.kill(terminalId).catch(() => {});
    }
    setTerminalId(null);
    setError(null);
    spawnedRef.current = false;
  };

  if (!sessionId || !projectId) {
    return (
      <div style={{ padding: 20, color: '#666', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>
        Create a session and project first to use the Claude terminal.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0a0f0a' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
        background: '#0a1a0a', borderBottom: '1px solid #1a3a1a',
        fontFamily: 'JetBrains Mono, monospace', fontSize: 11, flexShrink: 0,
      }}>
        <span style={{ color: '#ff6633', fontWeight: 'bold' }}>SUPER CLAUDE</span>
        <span style={{ color: '#666' }}>with H system access (MCP)</span>
        <span style={{ color: '#444' }}>{project?.name ?? ''}</span>
        <div style={{ flex: 1 }} />
        <button onClick={handleRestart} style={{
          background: '#1a3a1a', color: '#33ff33', border: 'none',
          padding: '3px 10px', cursor: 'pointer',
          fontFamily: 'JetBrains Mono, monospace', fontSize: 10,
        }}>
          RESTART
        </button>
      </div>

      <div style={{ flex: 1, position: 'relative' }}>
        {terminalId ? (
          <XTermPanel key={terminalId} mode="websocket" terminalId={terminalId} />
        ) : spawning ? (
          <div style={{ padding: 20, color: '#33ff33', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>
            Spawning Claude...
          </div>
        ) : error ? (
          <div style={{ padding: 20, fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>
            <div style={{ color: '#ff3333' }}>Failed to start Claude: {error}</div>
            <button onClick={handleRestart} style={{
              marginTop: 10, background: '#1a3a1a', color: '#33ff33', border: 'none',
              padding: '6px 12px', cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', fontSize: 11,
            }}>
              RETRY
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
