import { useState } from 'react';
import { api, type Session, type Project } from '../api.js';

interface SessionBarProps {
  session: Session | null;
  sessionProjects: Project[];
  currentProjectId?: string;
  onProjectSelect: (id: string) => void;
  onRefresh: () => void;
}

export function SessionBar({ session, sessionProjects, currentProjectId, onProjectSelect, onRefresh }: SessionBarProps) {
  const [showStartForm, setShowStartForm] = useState(false);
  const [newSessionName, setNewSessionName] = useState('');

  const handleStart = async () => {
    if (!newSessionName.trim()) return;
    await api.sessions.start({ name: newSessionName.trim() });
    setNewSessionName('');
    setShowStartForm(false);
    onRefresh();
  };

  const handlePause = async () => {
    await api.sessions.pause();
    onRefresh();
  };

  const handleComplete = async () => {
    await api.sessions.complete();
    onRefresh();
  };

  if (!session) {
    return (
      <div style={{ gridArea: 'session-bar', padding: '8px 16px', borderBottom: '1px solid #1a3a1a', background: '#0a1a0a', display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ color: '#666', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>NO ACTIVE SESSION</span>
        {showStartForm ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              value={newSessionName}
              onChange={e => setNewSessionName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleStart()}
              placeholder="session name..."
              style={{ background: '#0d1f0d', border: '1px solid #1a3a1a', color: '#33ff33', padding: '4px 8px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}
              autoFocus
            />
            <button onClick={handleStart} style={{ background: '#1a3a1a', color: '#33ff33', border: 'none', padding: '4px 12px', cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>START</button>
            <button onClick={() => setShowStartForm(false)} style={{ background: 'none', color: '#666', border: 'none', cursor: 'pointer', fontSize: 11 }}>cancel</button>
          </div>
        ) : (
          <button onClick={() => setShowStartForm(true)} style={{ background: '#1a3a1a', color: '#33ff33', border: 'none', padding: '4px 12px', cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>+ NEW SESSION</button>
        )}
      </div>
    );
  }

  return (
    <div style={{ gridArea: 'session-bar', padding: '8px 16px', borderBottom: '1px solid #1a3a1a', background: '#0a1a0a', display: 'flex', alignItems: 'center', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ color: '#33ff33', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 'bold' }}>
          SESSION: {session.name ?? session.id.slice(0, 8)}
        </span>
        <span style={{ color: '#1a6a1a', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' }}>
          [{session.status}]
        </span>
      </div>

      <div style={{ display: 'flex', gap: 4, flex: 1 }}>
        {sessionProjects.map(p => (
          <button
            key={p.id}
            onClick={() => onProjectSelect(p.id)}
            style={{
              background: p.id === currentProjectId ? '#1a3a1a' : 'transparent',
              color: p.id === currentProjectId ? '#33ff33' : '#1a6a1a',
              border: `1px solid ${p.id === currentProjectId ? '#33ff33' : '#1a3a1a'}`,
              padding: '2px 10px',
              cursor: 'pointer',
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 11,
            }}
          >
            {p.name}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={handlePause} style={{ background: 'none', color: '#aa8800', border: '1px solid #aa8800', padding: '2px 8px', cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', fontSize: 10 }}>PAUSE</button>
        <button onClick={handleComplete} style={{ background: 'none', color: '#666', border: '1px solid #333', padding: '2px 8px', cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', fontSize: 10 }}>END</button>
      </div>
    </div>
  );
}
