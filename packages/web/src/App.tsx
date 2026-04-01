import { useState } from 'react';
import { useProjects, useAgents, useTasks, useQueue, useEvents, useTerminal } from './hooks.js';
import { Header } from './components/Header.js';
import { Sidebar } from './components/Sidebar.js';
import { Dashboard } from './components/Dashboard.js';
import { Terminal } from './components/Terminal.js';
import { AgentsView } from './components/AgentsView.js';
import { TasksView } from './components/TasksView.js';
import { EventLog } from './components/EventLog.js';

export function App() {
  const [activeView, setActiveView] = useState('dashboard');
  const { projects } = useProjects();
  const currentProject = projects[0]; // Use first project for now
  const { agents, refresh: refreshAgents } = useAgents(currentProject?.id);
  const { tasks } = useTasks(currentProject?.id);
  const queue = useQueue(currentProject?.id);
  const events = useEvents();
  const { lines, sendCommand } = useTerminal();

  const workingCount = agents.filter((a) => a.status === 'working').length;

  const renderView = () => {
    switch (activeView) {
      case 'dashboard':
        return <Dashboard agents={agents} tasks={tasks} queue={queue} />;
      case 'terminal':
        return <Terminal lines={lines} onSend={sendCommand} events={events} />;
      case 'agents':
        return <AgentsView agents={agents} projectId={currentProject?.id} onRefresh={refreshAgents} />;
      case 'tasks':
        return <TasksView tasks={tasks} />;
      case 'events':
        return <EventLog events={events} />;
      default:
        return <Dashboard agents={agents} tasks={tasks} queue={queue} />;
    }
  };

  return (
    <>
      <div className="crt-overlay" />
      <div className="app-layout">
        <Header agentCount={agents.length} workingCount={workingCount} />
        <Sidebar
          activeView={activeView}
          onViewChange={setActiveView}
          projectName={currentProject?.name}
        />
        <main className="main-content" style={activeView === 'terminal' ? { padding: 0, display: 'flex', flexDirection: 'column' } : undefined}>
          {renderView()}
        </main>
      </div>
    </>
  );
}
