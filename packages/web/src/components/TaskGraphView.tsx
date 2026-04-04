import { useCallback, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  Position,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Graph, layout, type GraphLabel, type NodeLabel } from '@dagrejs/dagre';
import type { TaskGraph, TaskGraphNode } from '../api.js';

interface TaskGraphViewProps {
  graphs: TaskGraph[];
}

const NODE_WIDTH = 200;
const NODE_HEIGHT = 80;

const statusColors: Record<string, string> = {
  pending: 'var(--text-dim)',
  in_progress: 'var(--amber)',
  completed: 'var(--green)',
  failed: 'var(--red)',
  blocked: 'var(--purple)',
};

const statusBorderColors: Record<string, string> = {
  pending: 'var(--border-bright)',
  in_progress: 'var(--amber-dim)',
  completed: 'var(--green-dim)',
  failed: 'var(--red-dim)',
  blocked: 'var(--purple)',
};

function getLayoutedElements(
  graphNodes: TaskGraphNode[],
): { nodes: Node[]; edges: Edge[] } {
  const g = new Graph<GraphLabel, NodeLabel>();
  g.setGraph({
    rankdir: 'TB',
    nodesep: 60,
    ranksep: 80,
    marginx: 40,
    marginy: 40,
  });
  g.setDefaultNodeLabel(() => ({ width: NODE_WIDTH, height: NODE_HEIGHT }));

  for (const n of graphNodes) {
    g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  const edges: Edge[] = [];
  for (const n of graphNodes) {
    for (const dep of n.dependsOn) {
      const edgeId = `${dep}->${n.id}`;
      g.setEdge(dep, n.id);
      edges.push({
        id: edgeId,
        source: dep,
        target: n.id,
        style: {
          stroke: 'var(--border-bright)',
          strokeWidth: 2,
        },
        animated: graphNodes.find((gn) => gn.id === n.id)?.status === 'in_progress',
      });
    }
  }

  layout(g);

  // Collect unique projectIds for color assignment
  const allProjectIds = [...new Set(graphNodes.map(n => n.projectId).filter(Boolean))] as string[];

  const nodes: Node[] = graphNodes.map((n) => {
    const pos = g.node(n.id);
    return {
      id: n.id,
      position: {
        x: (pos?.x ?? 0) - NODE_WIDTH / 2,
        y: (pos?.y ?? 0) - NODE_HEIGHT / 2,
      },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
      data: {
        graphNode: n,
        projectColor: n.projectId ? getProjectColor(n.projectId, allProjectIds) : undefined,
      },
      type: 'taskNode',
    };
  });

  return { nodes, edges };
}

// Project color palette for cross-project graphs
const projectColors = ['#33ff33', '#33ccff', '#ff9933', '#ff33ff', '#ffff33', '#33ffcc'];

function getProjectColor(projectId: string | undefined, allProjectIds: string[]): string {
  if (!projectId) return 'var(--border)';
  const idx = allProjectIds.indexOf(projectId);
  return idx >= 0 ? projectColors[idx % projectColors.length] : 'var(--border)';
}

function TaskNodeComponent({ data }: { data: { graphNode: TaskGraphNode; projectColor?: string } }) {
  const node = data.graphNode;
  const borderColor = statusBorderColors[node.status] ?? 'var(--border)';
  const statusColor = statusColors[node.status] ?? 'var(--text-dim)';
  const projectColor = data.projectColor;

  return (
    <div
      style={{
        background: 'var(--bg-raised)',
        border: `1px solid ${borderColor}`,
        borderLeft: projectColor ? `3px solid ${projectColor}` : `1px solid ${borderColor}`,
        padding: '8px 12px',
        width: NODE_WIDTH,
        fontFamily: 'var(--font-terminal)',
        color: 'var(--text)',
        fontSize: '14px',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-terminal)',
          fontSize: '16px',
          color: 'var(--text-bright)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          marginBottom: '4px',
        }}
        title={node.title}
      >
        {node.title}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span
          style={{
            fontSize: '12px',
            color: 'var(--cyan-dim)',
            textTransform: 'uppercase',
            letterSpacing: '1px',
          }}
        >
          {node.requiredRole}
        </span>
        <span
          style={{
            fontSize: '12px',
            color: statusColor,
            textTransform: 'uppercase',
            letterSpacing: '1px',
            fontWeight: 'bold',
          }}
        >
          {node.status}
        </span>
      </div>
      {node.projectId && (
        <div style={{ fontSize: '10px', color: projectColor ?? 'var(--text-dim)', marginTop: 4, letterSpacing: '0.5px' }}>
          {node.projectId.slice(0, 12)}
        </div>
      )}
    </div>
  );
}

const nodeTypes = {
  taskNode: TaskNodeComponent,
};

const flowStyles = {
  background: 'var(--bg)',
};

const minimapStyle = {
  backgroundColor: 'var(--bg-panel)',
  maskColor: 'rgba(0, 0, 0, 0.7)',
};

const controlsStyle = {
  button: {
    backgroundColor: 'var(--bg-raised)',
    color: 'var(--text)',
    border: '1px solid var(--border)',
    borderBottom: 'none',
  },
};

export function TaskGraphView({ graphs }: TaskGraphViewProps) {
  const [selectedGraphId, setSelectedGraphId] = useState<string>(
    graphs.length > 0 ? graphs[0].id : '',
  );

  const selectedGraph = useMemo(
    () => graphs.find((g) => g.id === selectedGraphId),
    [graphs, selectedGraphId],
  );

  const { nodes, edges } = useMemo(() => {
    if (!selectedGraph || selectedGraph.nodes.length === 0) {
      return { nodes: [], edges: [] };
    }
    return getLayoutedElements(selectedGraph.nodes);
  }, [selectedGraph]);

  const onGraphChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setSelectedGraphId(e.target.value);
    },
    [],
  );

  if (graphs.length === 0) {
    return (
      <div className="panel">
        <div className="panel-header">
          <span>TASK GRAPH</span>
        </div>
        <div
          className="panel-body"
          style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '32px' }}
        >
          No task graphs yet.
        </div>
      </div>
    );
  }

  return (
    <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="panel-header">
        <span>TASK GRAPH</span>
        {graphs.length > 1 && (
          <select
            value={selectedGraphId}
            onChange={onGraphChange}
            style={{
              background: 'var(--bg-input)',
              color: 'var(--text)',
              border: '1px solid var(--border-bright)',
              fontFamily: 'var(--font-terminal)',
              fontSize: '14px',
              padding: '2px 8px',
              outline: 'none',
            }}
          >
            {graphs.map((g) => (
              <option key={g.id} value={g.id}>
                {g.strategy} — {g.status} ({g.nodes.length} nodes)
              </option>
            ))}
          </select>
        )}
        {selectedGraph && (
          <span style={{ color: 'var(--text-dim)', fontSize: '12px' }}>
            {selectedGraph.strategy} | {selectedGraph.status}
          </span>
        )}
      </div>
      <div style={{ flex: 1, minHeight: '400px' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          style={flowStyles}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="var(--border)" gap={20} />
          <Controls
            showInteractive={false}
            style={controlsStyle as React.CSSProperties}
          />
          <MiniMap
            style={minimapStyle}
            nodeColor={(node) => {
              const graphNode = (node.data as { graphNode: TaskGraphNode }).graphNode;
              const colorMap: Record<string, string> = {
                pending: '#555555',
                in_progress: '#ffb000',
                completed: '#00ff41',
                failed: '#ff3333',
                blocked: '#b388ff',
              };
              return colorMap[graphNode.status] ?? '#555555';
            }}
          />
        </ReactFlow>
      </div>
    </div>
  );
}
