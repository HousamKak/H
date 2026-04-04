import { useState, useEffect, useCallback } from 'react';
import { api, type Session, type Project } from '../api.js';

interface Props {
  currentSession: Session | null;
  onRefresh: () => void;
}

export function SessionView({ currentSession, onRefresh }: Props) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessionProjects, setSessionProjects] = useState<Project[]>([]);
  const [showAddProject, setShowAddProject] = useState(false);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [showStartSession, setShowStartSession] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectPath, setNewProjectPath] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [newSessionName, setNewSessionName] = useState('');
  const [newSessionFocus, setNewSessionFocus] = useState('');

  const refresh = useCallback(() => {
    api.sessions.list().then(setSessions).catch(() => {});
    api.projects.list().then(setProjects).catch(() => {});
    api.sessions.projects().then(setSessionProjects).catch(() => setSessionProjects([]));
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const handleCreateProject = async () => {
    if (!newProjectName.trim() || !newProjectPath.trim()) return;
    await api.projects.create({
      name: newProjectName.trim(),
      path: newProjectPath.trim(),
      description: newProjectDesc.trim() || undefined,
    });
    setNewProjectName('');
    setNewProjectPath('');
    setNewProjectDesc('');
    setShowCreateProject(false);
    refresh();
  };

  const handleAddProject = async () => {
    if (!selectedProjectId) return;
    await api.sessions.addProject(selectedProjectId);
    setSelectedProjectId('');
    setShowAddProject(false);
    refresh();
    onRefresh();
  };

  const handleRemoveProject = async (projectId: string) => {
    await api.sessions.removeProject(projectId);
    refresh();
    onRefresh();
  };

  const handleStartSession = async () => {
    if (!newSessionName.trim()) return;
    await api.sessions.start({
      name: newSessionName.trim(),
      focusDescription: newSessionFocus.trim() || undefined,
    });
    setNewSessionName('');
    setNewSessionFocus('');
    setShowStartSession(false);
    refresh();
    onRefresh();
  };

  const handleResume = async (sessionId: string) => {
    await api.sessions.resume(sessionId);
    refresh();
    onRefresh();
  };

  const pausedSessions = sessions.filter(s => s.status === 'paused');
  const completedSessions = sessions.filter(s => s.status === 'completed' || s.status === 'abandoned');
  const availableProjects = projects.filter(p => !sessionProjects.some(sp => sp.id === p.id));

  const inputStyle: React.CSSProperties = {
    background: '#0d1f0d', border: '1px solid #1a3a1a', color: '#33ff33',
    padding: '6px 10px', fontFamily: 'JetBrains Mono, monospace', fontSize: 12, width: '100%',
  };
  const btnStyle: React.CSSProperties = {
    background: '#1a3a1a', color: '#33ff33', border: 'none',
    padding: '6px 16px', cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', fontSize: 11,
  };
  const btnDimStyle: React.CSSProperties = { ...btnStyle, background: 'none', color: '#666' };

  return (
    <div style={{ padding: 16, overflow: 'auto' }}>

      {/* No session — start one */}
      {!currentSession && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontFamily: 'Press Start 2P, monospace', fontSize: 12, color: 'var(--green)', marginBottom: 16 }}>
            GET STARTED
          </h2>
          {showStartSession ? (
            <div style={{ border: '1px solid var(--green)', padding: 16, display: 'grid', gap: 10, maxWidth: 500 }}>
              <input value={newSessionName} onChange={e => setNewSessionName(e.target.value)} placeholder="Session name..." style={inputStyle} autoFocus />
              <input value={newSessionFocus} onChange={e => setNewSessionFocus(e.target.value)} placeholder="Focus / goal (optional)..." style={inputStyle} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={handleStartSession} style={btnStyle}>START SESSION</button>
                <button onClick={() => setShowStartSession(false)} style={btnDimStyle}>cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowStartSession(true)} style={{ ...btnStyle, fontSize: 13, padding: '10px 24px' }}>
              + NEW SESSION
            </button>
          )}
        </div>
      )}

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

            {/* Session Projects */}
            <div style={{ marginTop: 16 }}>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--text-dim)', marginBottom: 8 }}>
                PROJECTS IN SESSION ({sessionProjects.length})
              </div>
              {sessionProjects.map(p => (
                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #1a3a1a' }}>
                  <div>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, color: '#33ff33' }}>{p.name}</span>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#555', marginLeft: 8 }}>{p.path}</span>
                  </div>
                  <button onClick={() => handleRemoveProject(p.id)} style={{ ...btnDimStyle, fontSize: 10, color: '#aa3333' }}>remove</button>
                </div>
              ))}

              {/* Add existing project */}
              <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {showAddProject ? (
                  <>
                    <select value={selectedProjectId} onChange={e => setSelectedProjectId(e.target.value)} style={{ ...inputStyle, width: 'auto', flex: 1 }}>
                      <option value="">Select project...</option>
                      {availableProjects.map(p => <option key={p.id} value={p.id}>{p.name} — {p.path}</option>)}
                    </select>
                    <button onClick={handleAddProject} style={btnStyle}>ADD</button>
                    <button onClick={() => setShowAddProject(false)} style={btnDimStyle}>cancel</button>
                  </>
                ) : (
                  <button onClick={() => setShowAddProject(true)} style={btnStyle}>+ ADD EXISTING PROJECT</button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Register New Project */}
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ fontFamily: 'Press Start 2P, monospace', fontSize: 11, color: '#33ccff', marginBottom: 12 }}>
          REGISTER PROJECT
        </h3>
        {showCreateProject ? (
          <div style={{ border: '1px solid #33ccff', padding: 16, display: 'grid', gap: 10, maxWidth: 500 }}>
            <input value={newProjectName} onChange={e => setNewProjectName(e.target.value)} placeholder="Project name..." style={inputStyle} autoFocus />
            <input value={newProjectPath} onChange={e => setNewProjectPath(e.target.value)} placeholder="Absolute path (e.g. D:/dev/myapp)..." style={inputStyle} />
            <input value={newProjectDesc} onChange={e => setNewProjectDesc(e.target.value)} placeholder="Description (optional)..." style={inputStyle} />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={handleCreateProject} style={{ ...btnStyle, color: '#33ccff', background: '#0d1f2f' }}>CREATE PROJECT</button>
              <button onClick={() => setShowCreateProject(false)} style={btnDimStyle}>cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowCreateProject(true)} style={{ ...btnStyle, color: '#33ccff', background: '#0d1f2f' }}>
            + NEW PROJECT
          </button>
        )}

        {/* Existing projects list */}
        {projects.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--text-dim)', marginBottom: 6 }}>
              ALL REGISTERED PROJECTS ({projects.length})
            </div>
            {projects.map(p => (
              <div key={p.id} style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--text-dim)', padding: '4px 0' }}>
                {p.name} — <span style={{ color: '#555' }}>{p.path}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Paused Sessions */}
      {pausedSessions.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h3 style={{ fontFamily: 'Press Start 2P, monospace', fontSize: 11, color: '#aa8800', marginBottom: 12 }}>
            PAUSED ({pausedSessions.length})
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
                <button onClick={() => handleResume(s.id)} style={{ background: '#332200', color: '#aa8800', border: '1px solid #aa8800', padding: '6px 16px', cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
                  RESUME
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* History */}
      {completedSessions.length > 0 && (
        <div>
          <h3 style={{ fontFamily: 'Press Start 2P, monospace', fontSize: 11, color: 'var(--text-dim)', marginBottom: 12 }}>
            HISTORY ({completedSessions.length})
          </h3>
          {completedSessions.map(s => (
            <div key={s.id} style={{ border: '1px solid var(--border)', padding: 10, marginBottom: 6 }}>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--text-dim)' }}>
                {s.name ?? s.id.slice(0, 12)}
              </span>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#555', marginLeft: 12 }}>
                [{s.status}] {new Date(s.startedAt).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
