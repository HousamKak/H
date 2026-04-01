interface Props {
  activeView: string;
  onViewChange: (view: string) => void;
  projectName?: string;
}

const NAV_ITEMS = [
  { id: 'dashboard', icon: '>', label: 'DASHBOARD' },
  { id: 'terminal', icon: '$', label: 'TERMINAL' },
  { id: 'agents', icon: '@', label: 'AGENTS' },
  { id: 'tasks', icon: '#', label: 'TASKS' },
  { id: 'events', icon: '~', label: 'EVENT LOG' },
];

export function Sidebar({ activeView, onViewChange, projectName }: Props) {
  return (
    <nav className="sidebar">
      {projectName && (
        <div className="sidebar-section">
          <div className="sidebar-label">PROJECT</div>
          <div style={{ color: 'var(--green)', fontSize: '16px', padding: '4px 8px' }}>
            {projectName}
          </div>
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
          v0.1.0 // H ASSISTANT
        </div>
      </div>
    </nav>
  );
}
