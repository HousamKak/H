import { useState } from 'react';
import { useProjects, useAgents, useTasks, useQueue, useEvents, useTerminal, useBlackboard, useGraphs, useCosts, useTraces, useSession } from './hooks.js';
import { api } from './api.js';
import { Header } from './components/Header.js';
import { Sidebar } from './components/Sidebar.js';
import { SessionBar } from './components/SessionBar.js';
import { Dashboard } from './components/Dashboard.js';
import { Terminal } from './components/Terminal.js';
import { AgentsView } from './components/AgentsView.js';
import { TasksView } from './components/TasksView.js';
import { EventLog } from './components/EventLog.js';
import { TaskGraphView } from './components/TaskGraphView.js';
import { BlackboardView } from './components/BlackboardView.js';
import { CostDashboard } from './components/CostDashboard.js';
import { TraceView } from './components/TraceView.js';

export function App() {
  const [activeView, setActiveView] = useState('dashboard');
  const { session, sessionProjects, refresh: refreshSession } = useSession();
  const { projects } = useProjects();

  // Current project: first session project, or first project overall
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>();
  const currentProjectId = selectedProjectId ?? sessionProjects[0]?.id ?? projects[0]?.id;
  const currentProject = [...sessionProjects, ...projects].find(p => p.id === currentProjectId);

  const { agents, refresh: refreshAgents } = useAgents(currentProjectId);
  const { tasks } = useTasks(currentProjectId);
  const queue = useQueue(currentProjectId);
  const events = useEvents();
  const { lines, sendCommand } = useTerminal();
  const { entries: blackboardEntries, refresh: refreshBlackboard } = useBlackboard(currentProjectId);
  const { graphs } = useGraphs(currentProjectId);
  const { records: costRecords, summary: costSummary } = useCosts(currentProjectId);
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>();
  const { spans } = useTraces(selectedAgentId);

  const workingCount = agents.filter((a) => a.status === 'working').length;

  const handleResolveEntry = async (id: string) => {
    await api.blackboard.resolve(id);
    refreshBlackboard();
  };

  const renderView = () => {
    switch (activeView) {
      case 'dashboard':
        return <Dashboard agents={agents} tasks={tasks} queue={queue} costSummary={costSummary} />;
      case 'terminal':
        return <Terminal lines={lines} onSend={sendCommand} events={events} />;
      case 'agents':
        return <AgentsView agents={agents} projectId={currentProjectId} onRefresh={refreshAgents} />;
      case 'tasks':
        return <TasksView tasks={tasks} />;
      case 'graph':
        return <TaskGraphView graphs={graphs} />;
      case 'blackboard':
        return <BlackboardView entries={blackboardEntries} onResolve={handleResolveEntry} />;
      case 'costs':
        return <CostDashboard records={costRecords} summary={costSummary} />;
      case 'traces':
        return (
          <div>
            <div style={{ padding: '16px', borderBottom: '1px solid var(--border)' }}>
              <label style={{ fontFamily: 'VT323, monospace', color: 'var(--text-dim)', marginRight: 8 }}>AGENT:</label>
              <select
                value={selectedAgentId ?? ''}
                onChange={(e) => setSelectedAgentId(e.target.value || undefined)}
                style={{
                  background: 'var(--bg-input)', color: 'var(--text)', border: '1px solid var(--border)',
                  fontFamily: 'JetBrains Mono, monospace', fontSize: '13px', padding: '4px 8px',
                }}
              >
                <option value="">Select agent...</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.definitionRole} ({a.id.slice(0, 8)})</option>
                ))}
              </select>
            </div>
            <TraceView spans={spans} title={selectedAgentId ? `Traces: ${selectedAgentId.slice(0, 8)}` : undefined} />
          </div>
        );
      case 'events':
        return <EventLog events={events} />;
      default:
        return <Dashboard agents={agents} tasks={tasks} queue={queue} costSummary={costSummary} />;
    }
  };

  return (
    <>
      <div className="crt-overlay" />
      <div className="app-layout">
        <Header agentCount={agents.length} workingCount={workingCount} costSummary={costSummary} />
        <SessionBar
          session={session}
          sessionProjects={sessionProjects}
          currentProjectId={currentProjectId}
          onProjectSelect={setSelectedProjectId}
          onRefresh={refreshSession}
        />
        <Sidebar
          activeView={activeView}
          onViewChange={setActiveView}
          projectName={currentProject?.name}
          sessionProjects={sessionProjects}
        />
        <main className="main-content" style={activeView === 'terminal' ? { padding: 0, display: 'flex', flexDirection: 'column' } : undefined}>
          {renderView()}
        </main>
      </div>
    </>
  );
}
