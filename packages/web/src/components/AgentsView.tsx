import { useState } from 'react';
import type { AgentInstance } from '../api.js';
import { api } from '../api.js';
import { PixelSprite } from './PixelSprite.js';

interface Props {
  agents: AgentInstance[];
  projectId?: string;
  onRefresh: () => void;
}

const ROLES = ['coder', 'reviewer', 'researcher', 'architect', 'foreman'] as const;

export function AgentsView({ agents, projectId, onRefresh }: Props) {
  const [spawning, setSpawning] = useState(false);

  const handleSpawn = async (role: string) => {
    if (!projectId) return;
    setSpawning(true);
    try {
      await api.agents.spawn(role, projectId);
      onRefresh();
    } catch (err) {
      console.error('Spawn failed:', err);
    } finally {
      setSpawning(false);
    }
  };

  const handleStop = async (id: string) => {
    try {
      await api.agents.stop(id);
      onRefresh();
    } catch (err) {
      console.error('Stop failed:', err);
    }
  };

  return (
    <div>
      {/* Spawn panel */}
      <div className="panel">
        <div className="panel-header">
          <span>SPAWN AGENT</span>
        </div>
        <div className="panel-body">
          {!projectId ? (
            <div style={{ color: 'var(--text-dim)' }}>Select a project first.</div>
          ) : (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {ROLES.map((role) => (
                <button
                  key={role}
                  className="btn"
                  onClick={() => handleSpawn(role)}
                  disabled={spawning}
                  style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                  <PixelSprite role={role} size={3} />
                  <span>{role}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Active agents */}
      <div className="panel">
        <div className="panel-header">
          <span>ACTIVE AGENTS</span>
          <span style={{ color: 'var(--text-dim)' }}>{agents.length}</span>
        </div>
        <div className="panel-body">
          {agents.length === 0 ? (
            <div style={{ color: 'var(--text-dim)' }}>No agents online.</div>
          ) : (
            <div className="agent-grid">
              {agents.map((agent) => (
                <div key={agent.id} className={`agent-card ${agent.status}`}>
                  <PixelSprite role={agent.definitionRole} size={5} />
                  <div className="agent-info">
                    <div className="agent-role">{agent.definitionRole}</div>
                    <div className="agent-id">{agent.id}</div>
                    <div className="agent-status">
                      <span className={`status-badge ${agent.status}`}>
                        {agent.status}
                      </span>
                      <span style={{ marginLeft: '8px', fontSize: '14px', color: 'var(--text-dim)' }}>
                        TURN {agent.turnCount}
                      </span>
                    </div>
                    {agent.currentTaskId && (
                      <div style={{ marginTop: '4px', fontSize: '14px', color: 'var(--amber-dim)' }}>
                        TASK: {agent.currentTaskId.substring(0, 12)}...
                      </div>
                    )}
                    {agent.errorMessage && (
                      <div style={{ marginTop: '4px', fontSize: '14px', color: 'var(--red)' }}>
                        {agent.errorMessage}
                      </div>
                    )}
                    <div style={{ marginTop: '8px' }}>
                      <button className="btn btn-danger" onClick={() => handleStop(agent.id)}>
                        TERMINATE
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
