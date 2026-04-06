import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  NodeResizer,
  useReactFlow,
  useNodesState,
  type Node,
  type NodeChange,
  type NodeTypes,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { api, type Workspace, type Applet, type Session, type Project, type CanvasViewport, type SessionAppletConfig, type TerminalAppletConfig } from '../api.js';
import { TerminalApplet } from './TerminalApplet.js';

interface Props {
  sessions: Session[];
  allProjects: Project[];
  focusedSessionId?: string;
  focusedProjectId?: string;
}

const DEFAULT_SIZE = { width: 420, height: 300 };
const SESSION_SIZE = { width: 900, height: 600 };
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
        position: 'relative',
      }}
    >
      {/* React Flow resize handles — visible only when the node is selected. */}
      <NodeResizer
        isVisible={selected}
        minWidth={280}
        minHeight={160}
        lineStyle={{ borderColor: '#33ff33' }}
        handleStyle={{ background: '#33ff33', width: 8, height: 8, border: 'none', borderRadius: 0 }}
      />
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
      {/* nodrag/nowheel/nopan: React Flow classes that tell its handlers to leave this subtree alone,
          so xterm can focus its hidden textarea and the terminal can scroll its own buffer.
          stopPropagation: extra safety — even if React Flow's listeners see the event, don't let
          them act on it (prevents focus-stealing and selection changes). */}
      <div
        className="nodrag nowheel nopan"
        style={{ flex: 1, minHeight: 0 }}
        onPointerDown={e => e.stopPropagation()}
        onMouseDown={e => e.stopPropagation()}
        onWheel={e => e.stopPropagation()}
      >
        <TerminalApplet
          applet={applet}
          sessions={sessions}
          allProjects={allProjects}
          onUpdate={onUpdate}
          onClose={() => onClose(applet.id)}
        />
      </div>
    </div>
  );
}

// Session group node — visual container for terminals belonging to a session
interface SessionNodeData extends Record<string, unknown> {
  applet: Applet;
  session?: Session;
  childCount: number;
  onClose: (id: string) => void;
}

function SessionNode({ data, selected }: { data: SessionNodeData; selected: boolean }) {
  const { applet, session, childCount, onClose } = data;
  const cfg = applet.config as SessionAppletConfig;
  const name = cfg.label ?? session?.name ?? session?.id?.slice(0, 8) ?? 'Session';
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: 'rgba(10, 26, 10, 0.4)',
        border: selected ? '2px dashed #33ff33' : '2px dashed #1a3a1a',
        borderRadius: 4,
        position: 'relative',
      }}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={400}
        minHeight={300}
        lineStyle={{ borderColor: '#33ff33' }}
        handleStyle={{ background: '#33ff33', width: 8, height: 8, border: 'none', borderRadius: 0 }}
      />
      <div
        className="applet-drag-handle"
        style={{
          padding: '6px 12px',
          background: selected ? '#1a3a1a' : '#0d1f0d',
          cursor: 'grab',
          borderBottom: '1px solid #1a3a1a',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 11,
          borderRadius: '4px 4px 0 0',
        }}
      >
        <span style={{ color: '#33ccff', fontWeight: 'bold' }}>SESSION</span>
        <span style={{ color: '#33ff33' }}>{name}</span>
        <span style={{ color: '#666' }}>{childCount} terminal{childCount !== 1 ? 's' : ''}</span>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => onClose(applet.id)}
          style={{ background: 'none', color: '#666', border: 'none', cursor: 'pointer', fontSize: 12, padding: '0 4px' }}
        >
          x
        </button>
      </div>
    </div>
  );
}

const nodeTypes: NodeTypes = { applet: AppletNode, session: SessionNode };

function toNodes(
  applets: Applet[],
  sessions: Session[],
  allProjects: Project[],
  onUpdate: (a: Applet) => void,
  onClose: (id: string) => void,
): Node[] {
  const nodes: Node[] = [];

  // Session nodes must come first (React Flow requirement for parent-child)
  const sessionApplets = applets.filter(a => a.type === 'session');
  const terminalApplets = applets.filter(a => a.type !== 'session');

  for (const a of sessionApplets) {
    const cfg = a.config as SessionAppletConfig;
    const session = sessions.find(s => s.id === cfg.sessionId);
    const childCount = terminalApplets.filter(t => t.parentId === a.id).length;
    const width = a.width ?? SESSION_SIZE.width;
    const height = a.height ?? SESSION_SIZE.height;
    nodes.push({
      id: a.id,
      type: 'session',
      position: a.position ?? { x: 40, y: 40 },
      data: { applet: a, session, childCount, onClose } as SessionNodeData,
      width,
      height,
      style: { width, height },
      dragHandle: '.applet-drag-handle',
    });
  }

  for (let i = 0; i < terminalApplets.length; i++) {
    const a = terminalApplets[i];
    const width = a.width ?? DEFAULT_SIZE.width;
    const height = a.height ?? DEFAULT_SIZE.height;
    const node: Node = {
      id: a.id,
      type: 'applet',
      position: a.position ?? { x: 40 + i * 40, y: 40 + i * 40 },
      data: { applet: a, sessions, allProjects, onUpdate, onClose } as AppletNodeData,
      width,
      height,
      style: { width, height },
      dragHandle: '.applet-drag-handle',
    };
    if (a.parentId) {
      node.parentId = a.parentId;
      // No extent constraint — terminals can be dragged freely within the session.
      // expandParent auto-grows the session if a terminal is near the edge.
      node.expandParent = true;
    }
    nodes.push(node);
  }

  return nodes;
}

function WorkspaceCanvas({ sessions, allProjects, focusedSessionId, focusedProjectId }: Props) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<AppletNodeData>>([]);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; flowX: number; flowY: number } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appletsRef = useRef<Applet[]>([]);
  const viewportRef = useRef<CanvasViewport>(DEFAULT_VIEWPORT);
  const { screenToFlowPosition, getNodes } = useReactFlow();

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

  // Handle node position/dimension changes — persist when drag/resize ends.
  // IMPORTANT: only update workspace state when something actually changed,
  // otherwise we create an infinite loop: setWorkspace → new ref → useEffect
  // → setNodes → React Flow remeasures → handleNodesChange → ...
  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    onNodesChange(changes);

    const hasPositionEnd = changes.some(c => c.type === 'position' && c.dragging === false);
    const hasResizeEnd = changes.some(c => c.type === 'dimensions' && (c as any).resizing === false);
    if (!hasPositionEnd && !hasResizeEnd) return;

    // Read current positions/sizes from React Flow's node state
    const posMap = new Map<string, { position: { x: number; y: number }; width?: number; height?: number }>();
    for (const n of getNodes()) {
      const measured = n.measured as { width?: number; height?: number } | undefined;
      const styleAny = n.style as { width?: number; height?: number } | undefined;
      posMap.set(n.id, {
        position: n.position,
        width: (measured?.width ?? n.width ?? styleAny?.width) as number | undefined,
        height: (measured?.height ?? n.height ?? styleAny?.height) as number | undefined,
      });
    }

    setWorkspace(ws => {
      if (!ws) return ws;
      let changed = false;
      const nextApplets = ws.applets.map(a => {
        const p = posMap.get(a.id);
        if (!p) return a;
        const newPos = p.position;
        const newW = p.width ?? a.width;
        const newH = p.height ?? a.height;
        if (
          a.position?.x === newPos.x && a.position?.y === newPos.y &&
          a.width === newW && a.height === newH
        ) {
          return a;
        }
        changed = true;
        return { ...a, position: newPos, width: newW, height: newH };
      });
      if (!changed) return ws; // no-op: break the re-render loop
      scheduleSave(nextApplets, viewportRef.current);
      return { ...ws, applets: nextApplets };
    });
  }, [onNodesChange, getNodes, scheduleSave]);

  // Detect when a terminal is dragged into or out of a session container
  const handleNodeDragStop = useCallback((_event: React.MouseEvent, draggedNode: Node) => {
    // Only care about terminal applets (not sessions)
    if (draggedNode.type !== 'applet') return;

    const allNodes = getNodes();
    const sessionNodes = allNodes.filter(n => n.type === 'session');
    if (sessionNodes.length === 0) return;

    // Get the dragged node's absolute position
    const dragPos = draggedNode.position;
    const dragW = (draggedNode.measured?.width ?? draggedNode.width ?? DEFAULT_SIZE.width) as number;
    const dragH = (draggedNode.measured?.height ?? draggedNode.height ?? DEFAULT_SIZE.height) as number;
    const dragCenterX = dragPos.x + dragW / 2;
    const dragCenterY = dragPos.y + dragH / 2;

    // Find which session the center of this terminal falls inside
    let targetSessionId: string | undefined;
    for (const sn of sessionNodes) {
      const sw = (sn.measured?.width ?? sn.width ?? SESSION_SIZE.width) as number;
      const sh = (sn.measured?.height ?? sn.height ?? SESSION_SIZE.height) as number;
      // If terminal has a parent, its position is relative to parent
      const absDragX = draggedNode.parentId === sn.id ? sn.position.x + dragPos.x : dragPos.x;
      const absDragY = draggedNode.parentId === sn.id ? sn.position.y + dragPos.y : dragPos.y;
      const cx = draggedNode.parentId === sn.id ? sn.position.x + dragCenterX : dragCenterX;
      const cy = draggedNode.parentId === sn.id ? sn.position.y + dragCenterY : dragCenterY;

      if (cx >= sn.position.x && cx <= sn.position.x + sw &&
          cy >= sn.position.y && cy <= sn.position.y + sh) {
        targetSessionId = sn.id;
        break;
      }
    }

    setWorkspace(ws => {
      if (!ws) return ws;
      const applet = ws.applets.find(a => a.id === draggedNode.id);
      if (!applet || applet.type !== 'terminal') return ws;

      const currentParent = applet.parentId;

      if (targetSessionId && currentParent !== targetSessionId) {
        // Moving INTO a session — convert position to relative
        const sn = sessionNodes.find(n => n.id === targetSessionId)!;
        const relX = dragPos.x - sn.position.x;
        const relY = dragPos.y - sn.position.y;
        const updated = { ...applet, parentId: targetSessionId, position: { x: Math.max(10, relX), y: Math.max(40, relY) } };
        const nextApplets = ws.applets.map(a => a.id === applet.id ? updated : a);
        scheduleSave(nextApplets, viewportRef.current);
        return { ...ws, applets: nextApplets };
      } else if (!targetSessionId && currentParent) {
        // Moving OUT of a session — ask first
        if (!confirm('Move this terminal out of the session?')) return ws;
        const sn = sessionNodes.find(n => n.id === currentParent);
        const absX = sn ? sn.position.x + dragPos.x : dragPos.x;
        const absY = sn ? sn.position.y + dragPos.y : dragPos.y;
        const updated = { ...applet, parentId: undefined, position: { x: absX, y: absY } };
        const nextApplets = ws.applets.map(a => a.id === applet.id ? updated : a);
        scheduleSave(nextApplets, viewportRef.current);
        return { ...ws, applets: nextApplets };
      }

      return ws;
    });
  }, [getNodes, scheduleSave]);

  // Track viewport (pan/zoom) and persist
  const handleMoveEnd = useCallback((_: unknown, viewport: Viewport) => {
    viewportRef.current = viewport;
    scheduleSave(appletsRef.current, viewport);
  }, [scheduleSave]);

  // Add a new terminal applet at a given canvas position
  const spawnTerminalAt = useCallback((flowX: number, flowY: number, parentId?: string, kind: 'shell' | 'claude' | 'super_claude' = 'shell') => {
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
      title: kind === 'claude' ? 'Claude' : kind === 'super_claude' ? 'Super Claude' : 'Terminal',
      position: { x: parentId ? 30 : flowX, y: parentId ? 50 : flowY },
      width: DEFAULT_SIZE.width,
      height: DEFAULT_SIZE.height,
      parentId,
      config: { sessionId, projectId, kind, cwd: project?.path } as TerminalAppletConfig,
    };
    setWorkspace(ws => {
      const base = ws ?? { id: 'default', layout: null, applets: [], updatedAt: new Date().toISOString() };
      const next = { ...base, applets: [...base.applets, newApplet] };
      scheduleSave(next.applets, viewportRef.current);
      return next;
    });
  }, [focusedSessionId, focusedProjectId, sessions, allProjects, scheduleSave]);

  // Create a session group at a given canvas position
  const spawnSessionAt = useCallback(async (flowX: number, flowY: number) => {
    try {
      const session = await api.sessions.start({ name: `Session ${Date.now().toString(36)}` });
      const newApplet: Applet = {
        id: generateId(),
        type: 'session',
        title: session.name ?? 'Session',
        position: { x: flowX, y: flowY },
        width: SESSION_SIZE.width,
        height: SESSION_SIZE.height,
        config: { sessionId: session.id, label: session.name } as SessionAppletConfig,
      };
      setWorkspace(ws => {
        const base = ws ?? { id: 'default', layout: null, applets: [], updatedAt: new Date().toISOString() };
        const next = { ...base, applets: [...base.applets, newApplet] };
        scheduleSave(next.applets, viewportRef.current);
        return next;
      });
    } catch (err) {
      alert(`Failed to create session: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [scheduleSave]);

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
        <button onClick={() => { const vp = viewportRef.current; spawnSessionAt(-vp.x / vp.zoom + 80, -vp.y / vp.zoom + 80); }} title="Add session group at center of view" style={{ background: '#1a3a1a', color: '#33ccff', border: 'none', padding: '4px 12px', cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>
          + SESSION
        </button>
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
          onNodeDragStop={handleNodeDragStop}
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
        {contextMenu && (() => {
          const menuItemStyle: React.CSSProperties = {
            padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #1a3a1a',
          };
          const onHover = (e: React.MouseEvent<HTMLDivElement>) => e.currentTarget.style.background = '#1a3a1a';
          const onLeave = (e: React.MouseEvent<HTMLDivElement>) => e.currentTarget.style.background = 'transparent';
          return (
            <div
              style={{
                position: 'fixed',
                left: contextMenu.x,
                top: contextMenu.y,
                background: '#0a1a0a',
                border: '1px solid #33ff33',
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 11,
                minWidth: 200,
                boxShadow: '0 4px 12px rgba(0,0,0,0.6)',
                zIndex: 1000,
              }}
              onClick={e => e.stopPropagation()}
            >
              <div onClick={() => { spawnSessionAt(contextMenu.flowX, contextMenu.flowY); closeContextMenu(); }}
                style={{ ...menuItemStyle, color: '#33ccff' }} onMouseEnter={onHover} onMouseLeave={onLeave}>
                + New Session group
              </div>
              <div onClick={() => { spawnTerminalAt(contextMenu.flowX, contextMenu.flowY); closeContextMenu(); }}
                style={{ ...menuItemStyle, color: '#33ff33' }} onMouseEnter={onHover} onMouseLeave={onLeave}>
                + Add Terminal
              </div>
              <div onClick={() => { spawnTerminalAt(contextMenu.flowX, contextMenu.flowY, undefined, 'claude'); closeContextMenu(); }}
                style={{ ...menuItemStyle, color: '#ffcc33' }} onMouseEnter={onHover} onMouseLeave={onLeave}>
                + Add Claude
              </div>
              <div onClick={() => { spawnTerminalAt(contextMenu.flowX, contextMenu.flowY, undefined, 'super_claude'); closeContextMenu(); }}
                style={{ ...menuItemStyle, color: '#ff6633' }} onMouseEnter={onHover} onMouseLeave={onLeave}>
                + Add Super Claude
              </div>
              <div onClick={closeContextMenu}
                style={{ ...menuItemStyle, color: '#666', borderBottom: 'none' }} onMouseEnter={onHover} onMouseLeave={onLeave}>
                Close
              </div>
            </div>
          );
        })()}
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
