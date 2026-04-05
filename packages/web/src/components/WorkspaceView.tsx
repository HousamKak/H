import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useReactFlow,
  useNodesState,
  applyNodeChanges,
  type Node,
  type NodeChange,
  type NodeTypes,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { api, type Workspace, type Applet, type Session, type Project, type CanvasViewport } from '../api.js';
import { TerminalApplet } from './TerminalApplet.js';

interface Props {
  sessions: Session[];
  allProjects: Project[];
  focusedSessionId?: string;
  focusedProjectId?: string;
}

const DEFAULT_SIZE = { width: 420, height: 300 };
const DEFAULT_VIEWPORT: CanvasViewport = { x: 0, y: 0, zoom: 1 };

function generateId() {
  return `applet-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

// Data passed to each React Flow node
interface AppletNodeData extends Record<string, unknown> {
  applet: Applet;
  sessions: Session[];
  allProjects: Project[];
  onUpdate: (applet: Applet) => void;
  onClose: (id: string) => void;
}

// Custom node renderer: wraps TerminalApplet + a drag handle.
// NOTE: we use React Flow's `dragHandle=".applet-drag-handle"` so that clicks
// inside inputs/terminal don't drag the whole node.
function AppletNode({ data, selected }: { data: AppletNodeData; selected: boolean }) {
  const { applet, sessions, allProjects, onUpdate, onClose } = data;
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: '#0a0f0a',
        border: selected ? '1px solid #33ff33' : '1px solid #1a3a1a',
        boxShadow: selected ? '0 0 0 2px rgba(51,255,51,0.25)' : 'none',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        borderRadius: 2,
      }}
    >
      {/* Drag handle strip above TerminalApplet's own header */}
      <div
        className="applet-drag-handle"
        style={{
          height: 6,
          background: selected ? '#1a3a1a' : '#0d1f0d',
          cursor: 'grab',
          borderBottom: '1px solid #1a3a1a',
          flexShrink: 0,
        }}
        title="Drag to move"
      />
      {/* nodrag: React Flow would otherwise swallow pointerdown and prevent xterm from focusing.
          nowheel: let the terminal scroll its own buffer instead of zooming the canvas. */}
      <div className="nodrag nowheel" style={{ flex: 1, minHeight: 0 }}>
        <TerminalApplet
          applet={applet}
          sessions={sessions}
          allProjects={allProjects}
          onUpdate={onUpdate}
          onClose={() => onClose(applet.id)}
        />
      </div>
      {/* Resize grip in bottom-right (manual — NodeResizer shows only when selected but causes layout jumps) */}
      <div
        style={{
          position: 'absolute',
          right: 0,
          bottom: 0,
          width: 14,
          height: 14,
          cursor: 'nwse-resize',
          background: 'linear-gradient(135deg, transparent 50%, #1a3a1a 50%)',
          pointerEvents: 'none', // React Flow handles resize via nodesDraggable; we visually mark it
        }}
      />
    </div>
  );
}

const nodeTypes: NodeTypes = { applet: AppletNode };

function toNodes(
  applets: Applet[],
  sessions: Session[],
  allProjects: Project[],
  onUpdate: (a: Applet) => void,
  onClose: (id: string) => void,
): Node<AppletNodeData>[] {
  return applets.map((a, i) => ({
    id: a.id,
    type: 'applet',
    position: a.position ?? { x: 40 + i * 40, y: 40 + i * 40 },
    data: { applet: a, sessions, allProjects, onUpdate, onClose },
    width: a.width ?? DEFAULT_SIZE.width,
    height: a.height ?? DEFAULT_SIZE.height,
    dragHandle: '.applet-drag-handle',
    style: { width: a.width ?? DEFAULT_SIZE.width, height: a.height ?? DEFAULT_SIZE.height },
  }));
}

function WorkspaceCanvas({ sessions, allProjects, focusedSessionId, focusedProjectId }: Props) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<AppletNodeData>>([]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; flowX: number; flowY: number } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appletsRef = useRef<Applet[]>([]);
  const viewportRef = useRef<CanvasViewport>(DEFAULT_VIEWPORT);
  const { screenToFlowPosition } = useReactFlow();

  // Keep appletsRef current (avoid stale closures in keyboard/context handlers)
  appletsRef.current = workspace?.applets ?? [];

  const scheduleSave = useCallback((applets: Applet[], viewport: CanvasViewport) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api.workspace.update(viewport, applets).catch(() => {});
    }, 400);
  }, []);

  // Load workspace once
  useEffect(() => {
    api.workspace.get().then(ws => {
      setWorkspace(ws);
      viewportRef.current = ws.layout ?? DEFAULT_VIEWPORT;
    }).catch(() => {
      setWorkspace({ id: 'default', layout: null, applets: [], updatedAt: new Date().toISOString() });
    });
  }, []);

  // Mutation helpers (defined before effects that use them)
  const updateApplet = useCallback((updated: Applet) => {
    setWorkspace(ws => {
      if (!ws) return ws;
      const next = { ...ws, applets: ws.applets.map(a => a.id === updated.id ? updated : a) };
      scheduleSave(next.applets, viewportRef.current);
      return next;
    });
  }, [scheduleSave]);

  const removeApplet = useCallback((id: string) => {
    setWorkspace(ws => {
      if (!ws) return ws;
      const next = { ...ws, applets: ws.applets.filter(a => a.id !== id) };
      scheduleSave(next.applets, viewportRef.current);
      return next;
    });
  }, [scheduleSave]);

  // Sync applets → React Flow nodes (preserves positions from stored data)
  useEffect(() => {
    if (!workspace) return;
    setNodes(toNodes(workspace.applets, sessions, allProjects, updateApplet, removeApplet));
  }, [workspace?.applets, sessions, allProjects, updateApplet, removeApplet, setNodes]);

  // Handle node position/dimension changes — persist when drag/resize ends
  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    onNodesChange(changes);

    // Detect drag-end or resize-end → update applet positions/sizes and save
    const hasPositionEnd = changes.some(c => c.type === 'position' && c.dragging === false);
    const hasDimensions = changes.some(c => c.type === 'dimensions');
    if (!hasPositionEnd && !hasDimensions) return;

    setWorkspace(ws => {
      if (!ws) return ws;
      // Read positions/sizes back from the node state
      const posMap = new Map<string, { position: { x: number; y: number }; width?: number; height?: number }>();
      setNodes(currentNodes => {
        for (const n of currentNodes) {
          posMap.set(n.id, {
            position: n.position,
            width: (n.width ?? (n.style as any)?.width) as number | undefined,
            height: (n.height ?? (n.style as any)?.height) as number | undefined,
          });
        }
        return currentNodes;
      });
      const nextApplets = ws.applets.map(a => {
        const p = posMap.get(a.id);
        if (!p) return a;
        return { ...a, position: p.position, width: p.width ?? a.width, height: p.height ?? a.height };
      });
      const next = { ...ws, applets: nextApplets };
      scheduleSave(nextApplets, viewportRef.current);
      return next;
    });
  }, [onNodesChange, setNodes, scheduleSave]);

  // Track viewport (pan/zoom) and persist
  const handleMoveEnd = useCallback((_: unknown, viewport: Viewport) => {
    viewportRef.current = viewport;
    scheduleSave(appletsRef.current, viewport);
  }, [scheduleSave]);

  // Add a new terminal applet at a given canvas position
  const spawnTerminalAt = useCallback((flowX: number, flowY: number) => {
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
      position: { x: flowX, y: flowY },
      width: DEFAULT_SIZE.width,
      height: DEFAULT_SIZE.height,
      config: { sessionId, projectId, kind: 'shell', cwd: project?.path },
    };
    setWorkspace(ws => {
      const base = ws ?? { id: 'default', layout: null, applets: [], updatedAt: new Date().toISOString() };
      const next = { ...base, applets: [...base.applets, newApplet] };
      scheduleSave(next.applets, viewportRef.current);
      return next;
    });
  }, [focusedSessionId, focusedProjectId, sessions, allProjects, scheduleSave]);

  const addTerminalAtCenter = useCallback(() => {
    // Place near the center of the visible viewport
    const vp = viewportRef.current;
    spawnTerminalAt(-vp.x / vp.zoom + 120, -vp.y / vp.zoom + 120);
  }, [spawnTerminalAt]);

  const resetWorkspace = useCallback(() => {
    if (!confirm('Clear workspace? All applet panels will be closed.')) return;
    setWorkspace({ id: 'default', layout: null, applets: [], updatedAt: new Date().toISOString() });
    viewportRef.current = DEFAULT_VIEWPORT;
    api.workspace.reset().catch(() => {});
  }, []);

  // Right-click on empty pane → context menu
  const onPaneContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    const flowPos = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    setContextMenu({ x: event.clientX, y: event.clientY, flowX: flowPos.x, flowY: flowPos.y });
  }, [screenToFlowPosition]);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  // Keyboard shortcuts: T = new terminal at cursor, Delete = remove selected, Esc = close menu
  const mouseRef = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const onMove = (e: MouseEvent) => { mouseRef.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener('mousemove', onMove);
    return () => window.removeEventListener('mousemove', onMove);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Don't hijack keys while typing in inputs
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (e.key === 'Escape') { setContextMenu(null); return; }
      if (e.key.toLowerCase() === 't' && !e.ctrlKey && !e.metaKey) {
        const flow = screenToFlowPosition({ x: mouseRef.current.x, y: mouseRef.current.y });
        spawnTerminalAt(flow.x, flow.y);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [spawnTerminalAt, screenToFlowPosition]);

  const appletCount = workspace?.applets.length ?? 0;
  const defaultViewport = useMemo<Viewport>(() => workspace?.layout ?? DEFAULT_VIEWPORT, [workspace?.layout]);

  if (!workspace) {
    return <div style={{ padding: 20, color: '#666' }}>Loading workspace...</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#050805' }} onClick={closeContextMenu}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
        background: '#0a1a0a', borderBottom: '1px solid #1a3a1a',
        fontFamily: 'JetBrains Mono, monospace', fontSize: 11, flexShrink: 0,
      }}>
        <span style={{ color: '#33ff33', fontWeight: 'bold' }}>CANVAS</span>
        <span style={{ color: '#666' }}>{appletCount} applet{appletCount !== 1 ? 's' : ''}</span>
        <span style={{ color: '#444', marginLeft: 12, fontSize: 10 }}>
          [T] new terminal · right-click for menu · middle-drag or space-drag to pan · Ctrl+scroll to zoom
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={addTerminalAtCenter} title="Add terminal at center of view" style={{ background: '#1a3a1a', color: '#33ff33', border: 'none', padding: '4px 12px', cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
          + TERMINAL
        </button>
        {appletCount > 0 && (
          <button onClick={resetWorkspace} style={{ background: 'none', color: '#aa3333', border: '1px solid #aa3333', padding: '3px 10px', cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', fontSize: 10 }}>
            RESET
          </button>
        )}
      </div>

      {/* Canvas */}
      <div style={{ flex: 1, position: 'relative' }}>
        <ReactFlow<Node<AppletNodeData>>
          nodes={nodes}
          onNodesChange={handleNodesChange}
          nodeTypes={nodeTypes}
          onMoveEnd={handleMoveEnd}
          onPaneContextMenu={onPaneContextMenu}
          defaultViewport={defaultViewport}
          minZoom={0.2}
          maxZoom={2}
          panOnDrag={[1, 2]}
          panOnScroll={false}
          zoomOnScroll={false}
          zoomOnPinch={true}
          selectionOnDrag
          selectNodesOnDrag={false}
          nodesDraggable
          nodesConnectable={false}
          elementsSelectable
          deleteKeyCode={null}
          selectionKeyCode={null}
          multiSelectionKeyCode="Shift"
          proOptions={{ hideAttribution: true }}
          style={{ background: '#050805' }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#1a3a1a" />
          <Controls style={{ background: '#0a1a0a', border: '1px solid #1a3a1a' }} />
          <MiniMap
            style={{ background: '#0a1a0a', border: '1px solid #1a3a1a' }}
            maskColor="rgba(5, 8, 5, 0.85)"
            nodeColor="#1a3a1a"
            nodeStrokeColor="#33ff33"
            pannable
            zoomable
          />
        </ReactFlow>

        {/* Empty state overlay */}
        {appletCount === 0 && (
          <div style={{
            position: 'absolute', top: '40%', left: 0, right: 0,
            pointerEvents: 'none', textAlign: 'center',
            color: '#555', fontFamily: 'VT323, monospace', fontSize: 18,
          }}>
            Empty canvas. Press <span style={{ color: '#33ff33' }}>T</span> to add a terminal, or right-click anywhere.
          </div>
        )}

        {/* Context menu */}
        {contextMenu && (
          <div
            style={{
              position: 'fixed',
              left: contextMenu.x,
              top: contextMenu.y,
              background: '#0a1a0a',
              border: '1px solid #33ff33',
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 11,
              minWidth: 160,
              boxShadow: '0 4px 12px rgba(0,0,0,0.6)',
              zIndex: 1000,
            }}
            onClick={e => e.stopPropagation()}
          >
            <div
              onClick={() => { spawnTerminalAt(contextMenu.flowX, contextMenu.flowY); closeContextMenu(); }}
              style={{ padding: '8px 12px', cursor: 'pointer', color: '#33ff33', borderBottom: '1px solid #1a3a1a' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#1a3a1a')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              + Add Terminal here
            </div>
            <div
              onClick={closeContextMenu}
              style={{ padding: '8px 12px', cursor: 'pointer', color: '#666' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#1a3a1a')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              Close
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function WorkspaceView(props: Props) {
  return (
    <ReactFlowProvider>
      <WorkspaceCanvas {...props} />
    </ReactFlowProvider>
  );
}
