import type { Task } from '../api.js';

interface Props {
  tasks: Task[];
}

const STATUS_ICON: Record<string, string> = {
  completed: '[x]',
  in_progress: '[~]',
  pending: '[ ]',
  failed: '[!]',
  blocked: '[#]',
  assigned: '[>]',
  review: '[?]',
  cancelled: '[-]',
};

export function TasksView({ tasks }: Props) {
  const sorted = [...tasks].sort((a, b) => {
    const statusOrder: Record<string, number> = {
      in_progress: 0, assigned: 1, pending: 2, review: 3, blocked: 4, completed: 5, failed: 6, cancelled: 7,
    };
    const sa = statusOrder[a.status] ?? 5;
    const sb = statusOrder[b.status] ?? 5;
    if (sa !== sb) return sa - sb;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return (
    <div>
      <div className="panel">
        <div className="panel-header">
          <span>ALL TASKS</span>
          <span style={{ color: 'var(--text-dim)' }}>{tasks.length} TOTAL</span>
        </div>
        <div className="panel-body">
          {sorted.length === 0 ? (
            <div style={{ color: 'var(--text-dim)' }}>No tasks. Use /task &lt;description&gt; in terminal.</div>
          ) : (
            <div className="task-list">
              <div className="task-row" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '8px', marginBottom: '4px' }}>
                <span style={{ color: 'var(--text-dim)', fontSize: '12px' }}>STATUS</span>
                <span style={{ color: 'var(--text-dim)', fontSize: '12px' }}>TITLE</span>
                <span style={{ color: 'var(--text-dim)', fontSize: '12px' }}>ROLE</span>
                <span style={{ color: 'var(--text-dim)', fontSize: '12px', textAlign: 'right' }}>PRI</span>
              </div>
              {sorted.map((task) => (
                <div key={task.id} className="task-row">
                  <span className={`task-status ${task.status}`}>
                    {STATUS_ICON[task.status] ?? '[ ]'} {task.status === 'in_progress' ? 'ACTIVE' : task.status.toUpperCase()}
                  </span>
                  <span className="task-title" title={task.description}>
                    {task.title}
                  </span>
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

      {/* Completed task details */}
      {sorted.filter(t => t.result).length > 0 && (
        <div className="panel">
          <div className="panel-header">
            <span>COMPLETED RESULTS</span>
          </div>
          <div className="panel-body">
            {sorted.filter(t => t.result).map((task) => (
              <div key={task.id} style={{ marginBottom: '12px', padding: '8px', border: '1px solid var(--border)', background: 'var(--bg-raised)' }}>
                <div style={{ color: task.result!.success ? 'var(--green)' : 'var(--red)', fontSize: '14px' }}>
                  {task.result!.success ? '[OK]' : '[FAIL]'} {task.title}
                </div>
                <div style={{ color: 'var(--text)', marginTop: '4px', fontSize: '16px' }}>
                  {task.result!.summary}
                </div>
                {task.result!.filesChanged && task.result!.filesChanged.length > 0 && (
                  <div style={{ color: 'var(--cyan-dim)', marginTop: '4px', fontSize: '14px' }}>
                    Files: {task.result!.filesChanged.join(', ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
