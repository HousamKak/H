import { useState } from 'react';
import { api, type Session, type Project } from '../api.js';

interface SessionBarProps {
  focusedSession: Session | null;
  activeSessions: Session[];
  sessionProjects: Project[];
  currentProjectId?: string;
  onProjectSelect: (id: string) => void;
  onRefresh: () => void;
}

export function SessionBar({ focusedSession, activeSessions, sessionProjects, currentProjectId, onProjectSelect, onRefresh }: SessionBarProps) {
  const [showStartForm, setShowStartForm] = useState(false);
  const [newSessionName, setNewSessionName] = useState('');
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const handleStart = async () => {
    if (!newSessionName.trim() || starting) return;
    setStarting(true);
    setStartError(null);
    try {
      await api.sessions.start({ name: newSessionName.trim() });
      setNewSessionName('');
      setShowStartForm(false);
      onRefresh();
    } catch (err) {
      setStartError(err instanceof Error ? err.message : String(err));
    } finally {
      setStarting(false);
    }
  };

  const handleFocus = async (sessionId: string) => {
    await api.sessions.focus(sessionId);
    onRefresh();
  };

  const handleEnd = async () => {
    if (!focusedSession) return;
    if (!confirm(`End session "${focusedSession.name ?? focusedSession.id.slice(0, 8)}"? This will terminate all its agents.`)) return;
    await api.sessions.end(focusedSession.id);
    onRefresh();
  };

  const barStyle: React.CSSProperties = {
    gridArea: 'session-bar',
    padding: '6px 16px',
    borderBottom: '1px solid #1a3a1a',
    background: '#0a1a0a',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    minHeight: 36,
  };

  const sessionTabStyle = (isFocused: boolean): React.CSSProperties => ({
    padding: '4px 12px',
    background: isFocused ? '#1a3a1a' : 'transparent',
    color: isFocused ? '#33ff33' : '#1a6a1a',
    border: `1px solid ${isFocused ? '#33ff33' : '#1a3a1a'}`,
    cursor: 'pointer',
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 11,
    fontWeight: isFocused ? 'bold' : 'normal',
  });

  return (
    <div style={barStyle}>
      {/* Session tabs */}
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        {activeSessions.map(s => (
          <button
            key={s.id}
            onClick={() => handleFocus(s.id)}
            style={sessionTabStyle(s.id === focusedSession?.id)}
            title={s.focusDescription ?? s.name}
          >
            {s.name ?? s.id.slice(0, 8)}
          </button>
        ))}
        {showStartForm ? (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input
              value={newSessionName}
              onChange={e => setNewSessionName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleStart()}
              placeholder="session name..."
              style={{ background: '#0d1f0d', border: '1px solid #1a3a1a', color: '#33ff33', padding: '3px 8px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, width: 140 }}
              autoFocus
            />
            <button onClick={handleStart} disabled={starting || !newSessionName.trim()} style={{ background: '#1a3a1a', color: '#33ff33', border: 'none', padding: '3px 8px', cursor: starting || !newSessionName.trim() ? 'not-allowed' : 'pointer', opacity: starting || !newSessionName.trim() ? 0.5 : 1, fontFamily: 'JetBrains Mono, monospace', fontSize: 10 }}>{starting ? '...' : 'OK'}</button>
            <button onClick={() => { setShowStartForm(false); setStartError(null); }} style={{ background: 'none', color: '#666', border: 'none', cursor: 'pointer', fontSize: 10 }}>x</button>
            {startError && <span title={startError} style={{ color: '#ff4444', fontFamily: 'JetBrains Mono, monospace', fontSize: 10, marginLeft: 6, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>! {startError}</span>}
          </div>
        ) : (
          <button
            onClick={() => setShowStartForm(true)}
            title="New session"
            style={{ background: 'none', color: '#1a6a1a', border: '1px dashed #1a3a1a', padding: '3px 10px', cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}
          >+ session</button>
        )}
      </div>

      {/* Separator */}
      {focusedSession && <div style={{ width: 1, height: 20, background: '#1a3a1a', margin: '0 4px' }} />}

      {/* Project tabs for focused session */}
      {focusedSession && (
        <div style={{ display: 'flex', gap: 4, flex: 1 }}>
          {sessionProjects.map(p => (
            <button
              key={p.id}
              onClick={() => onProjectSelect(p.id)}
              style={{
                background: p.id === currentProjectId ? '#0d1f0d' : 'transparent',
                color: p.id === currentProjectId ? '#33ccff' : '#1a4a6a',
                border: `1px solid ${p.id === currentProjectId ? '#33ccff' : '#1a3a4a'}`,
                padding: '3px 10px',
                cursor: 'pointer',
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 10,
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {/* Actions */}
      {focusedSession && (
        <button onClick={handleEnd} title="End focused session" style={{ background: 'none', color: '#aa3333', border: '1px solid #aa3333', padding: '2px 8px', cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', fontSize: 10 }}>END</button>
      )}
    </div>
  );
}
