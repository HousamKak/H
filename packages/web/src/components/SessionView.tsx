import { useState, useEffect, useCallback } from 'react';
import { api, type Session, type Project } from '../api.js';

interface Props {
  currentSession: Session | null;
  onResume: () => void;
}

export function SessionView({ currentSession, onResume }: Props) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [showAddProject, setShowAddProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');

  const refresh = useCallback(() => {
    api.sessions.list().then(setSessions).catch(() => {});
    api.projects.list().then(setProjects).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const handleAddProject = async () => {
    if (!newProjectName.trim()) return;
    const project = projects.find(p => p.name === newProjectName.trim() || p.id === newProjectName.trim());
    if (project) {
      await api.sessions.addProject(project.id);
      setNewProjectName('');
      setShowAddProject(false);
      onResume();
    }
  };

  const handleResume = async (sessionId: string) => {
    await api.sessions.resume(sessionId);
    onResume();
  };

  const activeSessions = sessions.filter(s => s.status === 'active');
  const pausedSessions = sessions.filter(s => s.status === 'paused');
  const completedSessions = sessions.filter(s => s.status === 'completed' || s.status === 'abandoned');

  return (
    <div style={{ padding: 16, overflow: 'auto' }}>
      {/* Current Session */}
      {currentSession && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontFamily: 'Press Start 2P, monospace', fontSize: 12, color: 'var(--green)', marginBottom: 12 }}>
            CURRENT SESSION
          </h2>
          <div style={{ border: '1px solid var(--green)', padding: 16, background: '#0d1f0d' }}>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 16, color: '#33ff33', marginBottom: 8 }}>
              {currentSession.name ?? currentSession.id.slice(0, 12)}
            </div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--text-dim)', display: 'grid', gap: 4 }}>
              <div>Status: {currentSession.status}</div>
              <div>Started: {new Date(currentSession.startedAt).toLocaleString()}</div>
              {currentSession.focusDescription && <div>Focus: {currentSession.focusDescription}</div>}
            </div>

            {/* Add project to session */}
            <div style={{ marginTop: 12 }}>
              {showAddProject ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select
                    value={newProjectName}
                    onChange={e => setNewProjectName(e.target.value)}
                    style={{ background: '#0a1a0a', border: '1px solid #1a3a1a', color: '#33ff33', padding: '4px 8px', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, flex: 1 }}
                  >
                    <option value="">Select project...</option>
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  <button onClick={handleAddProject} style={{ background: '#1a3a1a', color: '#33ff33', border: 'none', padding: '4px 12px', cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>ADD</button>
                  <button onClick={() => setShowAddProject(false)} style={{ background: 'none', color: '#666', border: 'none', cursor: 'pointer', fontSize: 11 }}>cancel</button>
                </div>
              ) : (
                <button onClick={() => setShowAddProject(true)} style={{ background: '#1a3a1a', color: '#33ff33', border: 'none', padding: '4px 12px', cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
                  + ADD PROJECT TO SESSION
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Paused Sessions */}
      {pausedSessions.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ fontFamily: 'Press Start 2P, monospace', fontSize: 11, color: '#aa8800', marginBottom: 12 }}>
            PAUSED SESSIONS ({pausedSessions.length})
          </h3>
          <div style={{ display: 'grid', gap: 8 }}>
            {pausedSessions.map(s => (
              <div key={s.id} style={{ border: '1px solid #aa8800', padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: '#aa8800' }}>
                    {s.name ?? s.id.slice(0, 12)}
                  </div>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: 'var(--text-dim)', marginTop: 4 }}>
                    Paused: {s.pausedAt ? new Date(s.pausedAt).toLocaleString() : 'unknown'}
                  </div>
                </div>
                <button
                  onClick={() => handleResume(s.id)}
                  style={{ background: '#332200', color: '#aa8800', border: '1px solid #aa8800', padding: '4px 12px', cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}
                >
                  RESUME
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Session History */}
      {completedSessions.length > 0 && (
        <div>
          <h3 style={{ fontFamily: 'Press Start 2P, monospace', fontSize: 11, color: 'var(--text-dim)', marginBottom: 12 }}>
            HISTORY ({completedSessions.length})
          </h3>
          <div style={{ display: 'grid', gap: 8 }}>
            {completedSessions.map(s => (
              <div key={s.id} style={{ border: '1px solid var(--border)', padding: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--text-dim)' }}>
                    {s.name ?? s.id.slice(0, 12)}
                  </span>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#666' }}>
                    [{s.status}]
                  </span>
                </div>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#555', marginTop: 4 }}>
                  {new Date(s.startedAt).toLocaleDateString()} — {s.completedAt ? new Date(s.completedAt).toLocaleDateString() : 'ongoing'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
