import type { AgentInstance, Task, CostSummary, Session, Project } from '../api.js';
import type { QueueSnapshot } from '../api.js';
import { PixelSprite } from './PixelSprite.js';

interface Props {
  agents: AgentInstance[];
  tasks: Task[];
  queue: QueueSnapshot;
  costSummary?: CostSummary | null;
  session?: Session | null;
  sessionProjects?: Project[];
}

export function Dashboard({ agents, tasks, queue, costSummary, session, sessionProjects }: Props) {
  const recentTasks = [...tasks].sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  ).slice(0, 5);

  return (
    <div>
      {/* Session Info */}
      {session && (
        <div className="panel">
          <div className="panel-header">
            <span>SESSION</span>
            <span style={{ color: 'var(--text-dim)' }}>{session.status}</span>
          </div>
          <div className="panel-body" style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: '14px', color: 'var(--text-dim)' }}>NAME</div>
              <div style={{ fontSize: '18px', color: 'var(--green)' }}>{session.name ?? session.id.slice(0, 12)}</div>
            </div>
            <div>
              <div style={{ fontSize: '14px', color: 'var(--text-dim)' }}>PROJECTS</div>
              <div style={{ fontSize: '18px', color: 'var(--green)' }}>{sessionProjects?.length ?? 0}</div>
            </div>
            <div>
              <div style={{ fontSize: '14px', color: 'var(--text-dim)' }}>STARTED</div>
              <div style={{ fontSize: '14px', color: 'var(--text)' }}>{new Date(session.startedAt).toLocaleString()}</div>
            </div>
            {session.focusDescription && (
              <div>
                <div style={{ fontSize: '14px', color: 'var(--text-dim)' }}>FOCUS</div>
                <div style={{ fontSize: '14px', color: 'var(--text)' }}>{session.focusDescription}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="panel">
        <div className="panel-header">
          <span>SYSTEM STATUS</span>
          <span style={{ color: 'var(--text-dim)' }}>{new Date().toLocaleTimeString()}</span>
        </div>
        <div className="panel-body">
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-label">AGENTS ONLINE</div>
              <div className={`stat-value ${agents.length > 0 ? 'green' : 'amber'}`}>
                {agents.length}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">WORKING</div>
              <div className={`stat-value ${agents.filter(a => a.status === 'working').length > 0 ? 'green' : 'cyan'}`}>
                {agents.filter(a => a.status === 'working').length}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">TASKS PENDING</div>
              <div className={`stat-value ${queue.pending > 0 ? 'amber' : 'green'}`}>
                {queue.pending}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">COMPLETED</div>
              <div className="stat-value green">{queue.completed}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">IN PROGRESS</div>
              <div className={`stat-value ${queue.inProgress > 0 ? 'amber' : 'cyan'}`}>
                {queue.inProgress}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-label">FAILED</div>
              <div className={`stat-value ${queue.failed > 0 ? 'red' : 'green'}`}>
                {queue.failed}
              </div>
            </div>
            {costSummary && (
              <div className="stat-card">
                <div className="stat-label">DAILY COST</div>
                <div className="stat-value amber">
                  ${costSummary.daily.toFixed(4)}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Active Agents */}
      <div className="panel">
        <div className="panel-header">
          <span>ACTIVE AGENTS</span>
          <span style={{ color: 'var(--text-dim)' }}>{agents.length} ONLINE</span>
        </div>
        <div className="panel-body">
          {agents.length === 0 ? (
            <div style={{ color: 'var(--text-dim)', padding: '8px 0' }}>
              No agents spawned. Use terminal: /spawn coder
            </div>
          ) : (
            <div className="agent-grid">
              {agents.map((agent) => (
                <div key={agent.id} className={`agent-card ${agent.status}`}>
                  <PixelSprite role={agent.definitionRole} size={5} />
                  <div className="agent-info">
                    <div className="agent-role">{agent.definitionRole}</div>
                    <div className="agent-id">{agent.id.substring(0, 8)}</div>
                    <div className="agent-status">
                      <span className={`status-badge ${agent.status}`}>
                        {agent.status}
                      </span>
                      {agent.turnCount > 0 && (
                        <span style={{ marginLeft: '8px', fontSize: '14px', color: 'var(--text-dim)' }}>
                          T{agent.turnCount}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent Tasks */}
      <div className="panel">
        <div className="panel-header">
          <span>RECENT TASKS</span>
          <span style={{ color: 'var(--text-dim)' }}>{tasks.length} TOTAL</span>
        </div>
        <div className="panel-body">
          {recentTasks.length === 0 ? (
            <div style={{ color: 'var(--text-dim)', padding: '8px 0' }}>
              No tasks yet. Use terminal: /task &lt;description&gt;
            </div>
          ) : (
            <div className="task-list">
              {recentTasks.map((task) => (
                <div key={task.id} className="task-row">
                  <span className={`task-status ${task.status}`}>
                    {task.status === 'in_progress' ? 'ACTIVE' : task.status.toUpperCase()}
                  </span>
                  <span className="task-title">{task.title}</span>
                  <span className="task-role">{task.requiredRole}</span>
                  <span className={`task-priority ${task.priority}`}>
                    {task.priority.toUpperCase()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
