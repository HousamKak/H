import type { Project } from '../api.js';

interface Props {
  activeView: string;
  onViewChange: (view: string) => void;
  projectName?: string;
  sessionProjects?: Project[];
}

const NAV_ITEMS = [
  { id: 'dashboard', icon: '>', label: 'DASHBOARD' },
  { id: 'workspace', icon: '[]', label: 'WORKSPACE' },
  { id: 'session', icon: '=', label: 'SESSION' },
  { id: 'terminal', icon: '$', label: 'TERMINAL' },
  { id: 'agents', icon: '@', label: 'AGENTS' },
  { id: 'tasks', icon: '#', label: 'TASKS' },
  { id: 'graph', icon: '%', label: 'TASK GRAPH' },
  { id: 'blackboard', icon: '&', label: 'BLACKBOARD' },
  { id: 'a2a', icon: '*', label: 'A2A MESSAGES' },
  { id: 'terminals', icon: '+', label: 'TERMINALS' },
  { id: 'costs', icon: '!', label: 'COSTS' },
  { id: 'traces', icon: '^', label: 'TRACES' },
  { id: 'events', icon: '~', label: 'EVENT LOG' },
];

export function Sidebar({ activeView, onViewChange, projectName, sessionProjects }: Props) {
  return (
    <nav className="sidebar">
      {projectName && (
        <div className="sidebar-section">
          <div className="sidebar-label">ACTIVE PROJECT</div>
          <div style={{ color: 'var(--green)', fontSize: '16px', padding: '4px 8px' }}>
            {projectName}
          </div>
        </div>
      )}

      {sessionProjects && sessionProjects.length > 1 && (
        <div className="sidebar-section">
          <div className="sidebar-label">SESSION PROJECTS ({sessionProjects.length})</div>
          {sessionProjects.map(p => (
            <div key={p.id} style={{ color: 'var(--text-dim)', fontSize: '13px', padding: '2px 8px' }}>
              {p.name}
            </div>
          ))}
        </div>
      )}

      <div className="sidebar-section" style={{ flex: 1 }}>
        <div className="sidebar-label">NAVIGATE</div>
        {NAV_ITEMS.map((item) => (
          <div
            key={item.id}
            className={`sidebar-item ${activeView === item.id ? 'active' : ''}`}
            onClick={() => onViewChange(item.id)}
          >
            <span className="sidebar-icon">{item.icon}</span>
            <span>{item.label}</span>
          </div>
        ))}
      </div>

      <div className="sidebar-section">
        <div style={{ fontSize: '12px', color: 'var(--text-dim)' }}>
          v0.2.0 // H SYSTEM
        </div>
      </div>
    </nav>
  );
}
