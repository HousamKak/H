import type { HEvent } from '../api.js';

interface Props {
  events: HEvent[];
}

const TYPE_COLOR: Record<string, string> = {
  'system.started': 'var(--green)',
  'system.shutdown': 'var(--red)',
  'agent.spawned': 'var(--cyan)',
  'agent.started': 'var(--green)',
  'agent.idle': 'var(--text-dim)',
  'agent.progress': 'var(--amber)',
  'agent.error': 'var(--red)',
  'agent.terminated': 'var(--red)',
  'task.created': 'var(--cyan)',
  'task.assigned': 'var(--amber)',
  'task.started': 'var(--green)',
  'task.completed': 'var(--green)',
  'task.failed': 'var(--red)',
  'tool.invoked': 'var(--purple)',
  'tool.completed': 'var(--purple)',
  'memory.stored': 'var(--cyan-dim)',
};

export function EventLog({ events }: Props) {
  const reversed = [...events].reverse();

  return (
    <div className="panel">
      <div className="panel-header">
        <span>EVENT LOG</span>
        <span style={{ color: 'var(--text-dim)' }}>LIVE STREAM</span>
      </div>
      <div className="panel-body" style={{ maxHeight: 'calc(100vh - 160px)', overflowY: 'auto' }}>
        {reversed.length === 0 ? (
          <div style={{ color: 'var(--text-dim)' }}>Waiting for events...</div>
        ) : (
          reversed.map((evt) => (
            <div key={evt.id} className="event-entry">
              <span className="event-time">
                {new Date(evt.timestamp).toLocaleTimeString()}
              </span>
              <span
                className="event-type"
                style={{ color: TYPE_COLOR[evt.type] ?? 'var(--text)' }}
              >
                {evt.type}
              </span>
              <span className="event-detail">
                {formatPayload(evt)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function formatPayload(evt: HEvent): string {
  const p = evt.payload;
  if (p.summary) return String(p.summary);
  if (p.message) return String(p.message);
  if (p.content) return String(p.content).substring(0, 80);
  if (p.agent) return `role=${(p.agent as Record<string, string>).definitionRole ?? 'unknown'}`;
  if (p.error) return String(p.error);
  return evt.source;
}
