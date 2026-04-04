import { useEffect, useState, useCallback, useRef } from 'react';
import { Mosaic, MosaicWindow, type MosaicNode as RMNode } from 'react-mosaic-component';
import 'react-mosaic-component/react-mosaic-component.css';
import { api, type Workspace, type Applet, type Session, type Project } from '../api.js';
import { TerminalApplet } from './TerminalApplet.js';

interface Props {
  sessions: Session[];
  allProjects: Project[];
  focusedSessionId?: string;
  focusedProjectId?: string;
}

function generateId() {
  return `applet-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function WorkspaceView({ sessions, allProjects, focusedSessionId, focusedProjectId }: Props) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load workspace once
  useEffect(() => {
    api.workspace.get().then(setWorkspace).catch(() => {
      setWorkspace({ id: 'default', layout: null, applets: [], updatedAt: new Date().toISOString() });
    });
  }, []);

  // Debounced save
  const saveWorkspace = useCallback((layout: RMNode<string> | null, applets: Applet[]) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api.workspace.update(layout as any, applets).catch(() => {});
    }, 500);
  }, []);

  const addTerminal = useCallback(() => {
    if (!workspace) return;
    const sessionId = focusedSessionId ?? sessions[0]?.id;
    const projectId = focusedProjectId ?? allProjects[0]?.id;
    if (!sessionId || !projectId) {
      alert('Create a session and project first.');
      return;
    }
    const project = allProjects.find(p => p.id === projectId);
    const newApplet: Applet = {
      id: generateId(),
      type: 'terminal',
      title: 'Terminal',
      config: {
        sessionId,
        projectId,
        kind: 'shell',
        cwd: project?.path,
      },
    };

    const newApplets = [...workspace.applets, newApplet];
    let newLayout: RMNode<string> | null;
    if (!workspace.layout) {
      newLayout = newApplet.id;
    } else {
      newLayout = {
        direction: 'row',
        first: workspace.layout as RMNode<string>,
        second: newApplet.id,
        splitPercentage: 60,
      };
    }

    setWorkspace({ ...workspace, layout: newLayout as any, applets: newApplets });
    saveWorkspace(newLayout, newApplets);
  }, [workspace, focusedSessionId, focusedProjectId, sessions, allProjects, saveWorkspace]);

  const removeApplet = useCallback((appletId: string) => {
    if (!workspace) return;
    const newApplets = workspace.applets.filter(a => a.id !== appletId);
    const newLayout = removeFromLayout(workspace.layout as RMNode<string> | null, appletId);
    setWorkspace({ ...workspace, layout: newLayout as any, applets: newApplets });
    saveWorkspace(newLayout, newApplets);
  }, [workspace, saveWorkspace]);

  const updateApplet = useCallback((updated: Applet) => {
    if (!workspace) return;
    const newApplets = workspace.applets.map(a => a.id === updated.id ? updated : a);
    setWorkspace({ ...workspace, applets: newApplets });
    saveWorkspace(workspace.layout as RMNode<string> | null, newApplets);
  }, [workspace, saveWorkspace]);

  const onLayoutChange = useCallback((newLayout: RMNode<string> | null) => {
    if (!workspace) return;
    setWorkspace({ ...workspace, layout: newLayout as any });
    saveWorkspace(newLayout, workspace.applets);
  }, [workspace, saveWorkspace]);

  const resetWorkspace = useCallback(() => {
    if (!confirm('Clear workspace? All applet panels will be closed.')) return;
    const empty: Workspace = { id: 'default', layout: null, applets: [], updatedAt: new Date().toISOString() };
    setWorkspace(empty);
    api.workspace.reset().catch(() => {});
  }, []);

  if (!workspace) {
    return <div style={{ padding: 20, color: '#666' }}>Loading workspace...</div>;
  }

  const hasContent = workspace.applets.length > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#050805' }}>
      {/* Workspace toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
        background: '#0a1a0a', borderBottom: '1px solid #1a3a1a',
        fontFamily: 'JetBrains Mono, monospace', fontSize: 11, flexShrink: 0,
      }}>
        <span style={{ color: '#33ff33', fontWeight: 'bold' }}>WORKSPACE</span>
        <span style={{ color: '#666' }}>{workspace.applets.length} applet{workspace.applets.length !== 1 ? 's' : ''}</span>
        <div style={{ flex: 1 }} />
        <button onClick={addTerminal} style={{ background: '#1a3a1a', color: '#33ff33', border: 'none', padding: '4px 12px', cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
          + TERMINAL
        </button>
        {hasContent && (
          <button onClick={resetWorkspace} style={{ background: 'none', color: '#aa3333', border: '1px solid #aa3333', padding: '3px 10px', cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', fontSize: 10 }}>
            RESET
          </button>
        )}
      </div>

      {/* Mosaic */}
      <div style={{ flex: 1, position: 'relative' }} className="h-mosaic-root">
        {!hasContent ? (
          <div style={{ padding: 40, color: '#555', fontFamily: 'VT323, monospace', fontSize: 18, textAlign: 'center' }}>
            Empty workspace. Click + TERMINAL to add your first applet.
          </div>
        ) : (
          <Mosaic<string>
            value={workspace.layout as RMNode<string> | null}
            onChange={onLayoutChange}
            renderTile={(id) => {
              const applet = workspace.applets.find(a => a.id === id);
              if (!applet) return <div style={{ padding: 20, color: '#666' }}>Applet not found: {id}</div>;
              return (
                <TerminalApplet
                  applet={applet}
                  sessions={sessions}
                  allProjects={allProjects}
                  onUpdate={updateApplet}
                  onClose={() => removeApplet(applet.id)}
                />
              );
            }}
            className="h-mosaic"
          />
        )}
      </div>
    </div>
  );
}

function removeFromLayout(node: RMNode<string> | null, id: string): RMNode<string> | null {
  if (!node) return null;
  if (typeof node === 'string') return node === id ? null : node;
  const first = removeFromLayout(node.first, id);
  const second = removeFromLayout(node.second, id);
  if (first === null && second === null) return null;
  if (first === null) return second;
  if (second === null) return first;
  return { ...node, first, second };
}
