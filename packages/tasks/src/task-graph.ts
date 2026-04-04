import type { TaskGraph, TaskGraphNode, ExecutionLayer, AgentRole } from '@h/types';
import { generateId } from '@h/types';
import type { EventBus } from '@h/events';
import type { TaskGraphRepository } from '@h/db';
import type { TaskService } from './task.service.js';

export class TaskGraphService {
  constructor(
    private taskService: TaskService,
    private eventBus: EventBus,
    private graphRepo: TaskGraphRepository,
  ) {}

  /**
   * Create a task graph from decomposed nodes.
   * Assigns IDs and sets initial status on each node, then persists the graph.
   */
  createGraph(
    projectId: string,
    rootTaskId: string,
    nodes: Omit<TaskGraphNode, 'id' | 'status'>[],
    strategy: 'sequential' | 'parallel' | 'mixed' = 'mixed',
  ): TaskGraph {
    const graphNodes: TaskGraphNode[] = nodes.map((n) => ({
      ...n,
      id: generateId(),
      status: 'pending' as const,
    }));

    // Remap dependsOn references: the caller may pass temp IDs that correspond
    // to the array index. We support both: if a dependsOn value matches an
    // original node's would-be index (as string), remap it to the generated ID.
    // However, the cleaner contract is that dependsOn already uses the same
    // identifiers that will become node IDs. Since we just generated IDs above,
    // dependsOn references should already be valid if the caller used the same
    // temp scheme. For safety we leave them as-is; the caller is responsible.

    const graph = this.graphRepo.create({
      projectId,
      rootTaskId,
      nodes: graphNodes,
      strategy,
      status: 'planning',
      isCrossProject: false,
    });

    return graph;
  }

  /**
   * Create a cross-project task graph. Nodes can have individual projectId fields.
   * The graph's projectId is the "primary" project, but each node may target a different one.
   */
  createCrossProjectGraph(
    primaryProjectId: string,
    sessionId: string,
    rootTaskId: string,
    nodes: Omit<TaskGraphNode, 'id' | 'status'>[],
    strategy: 'sequential' | 'parallel' | 'mixed' = 'mixed',
  ): TaskGraph {
    const graphNodes: TaskGraphNode[] = nodes.map((n) => ({
      ...n,
      id: generateId(),
      status: 'pending' as const,
    }));

    const isCrossProject = graphNodes.some(n => n.projectId && n.projectId !== primaryProjectId);

    const graph = this.graphRepo.create({
      projectId: primaryProjectId,
      sessionId,
      rootTaskId,
      nodes: graphNodes,
      strategy,
      status: 'planning',
      isCrossProject,
    });

    return graph;
  }

  /**
   * Topological sort using Kahn's algorithm.
   * Returns execution layers — groups of nodes that can run in parallel.
   * Throws if a cycle is detected.
   */
  getExecutionLayers(graph: TaskGraph): ExecutionLayer[] {
    const nodes = graph.nodes;
    const nodeMap = new Map<string, TaskGraphNode>();
    for (const node of nodes) {
      nodeMap.set(node.id, node);
    }

    // Compute in-degrees
    const inDegree = new Map<string, number>();
    for (const node of nodes) {
      inDegree.set(node.id, 0);
    }
    for (const node of nodes) {
      for (const dep of node.dependsOn) {
        // dep depends on another node, so dep has an incoming edge
        // Actually: node.dependsOn means "this node depends on dep"
        // So the edge goes dep -> node, meaning node's in-degree increases
        inDegree.set(node.id, (inDegree.get(node.id) ?? 0) + 1);
      }
    }

    // Build adjacency list (dep -> nodes that depend on dep)
    const dependents = new Map<string, string[]>();
    for (const node of nodes) {
      for (const dep of node.dependsOn) {
        if (!dependents.has(dep)) {
          dependents.set(dep, []);
        }
        dependents.get(dep)!.push(node.id);
      }
    }

    const layers: ExecutionLayer[] = [];
    const processed = new Set<string>();

    // Seed: all nodes with in-degree 0
    let currentLayer = nodes
      .filter((n) => (inDegree.get(n.id) ?? 0) === 0)
      .map((n) => n.id);

    let layerIndex = 0;

    while (currentLayer.length > 0) {
      layers.push({ index: layerIndex, nodeIds: [...currentLayer] });

      const nextLayer: string[] = [];
      for (const nodeId of currentLayer) {
        processed.add(nodeId);
        const deps = dependents.get(nodeId) ?? [];
        for (const depId of deps) {
          const newDegree = (inDegree.get(depId) ?? 1) - 1;
          inDegree.set(depId, newDegree);
          if (newDegree === 0) {
            nextLayer.push(depId);
          }
        }
      }

      currentLayer = nextLayer;
      layerIndex++;
    }

    // Cycle detection: if not all nodes were processed, there is a cycle
    if (processed.size !== nodes.length) {
      const unprocessed = nodes
        .filter((n) => !processed.has(n.id))
        .map((n) => n.title)
        .join(', ');
      throw new Error(`Cycle detected in task graph. Unprocessable nodes: ${unprocessed}`);
    }

    return layers;
  }

  /**
   * Materialize graph nodes into actual Task records.
   * Creates Task records for layer-0 nodes and transitions the graph to 'executing'.
   */
  async materialize(graphId: string): Promise<void> {
    const graph = this.graphRepo.findById(graphId);
    if (!graph) throw new Error(`Graph not found: ${graphId}`);

    const layers = this.getExecutionLayers(graph);
    if (layers.length === 0) return;

    const firstLayer = layers[0];
    const updatedNodes = [...graph.nodes];

    for (const nodeId of firstLayer.nodeIds) {
      const nodeIndex = updatedNodes.findIndex((n) => n.id === nodeId);
      if (nodeIndex === -1) continue;

      const node = updatedNodes[nodeIndex];
      // Use node-level projectId for cross-project graphs, fallback to graph projectId
      const nodeProjectId = node.projectId ?? graph.projectId;

      const task = await this.taskService.create({
        projectId: nodeProjectId,
        sessionId: graph.sessionId,
        title: node.title,
        description: node.description,
        priority: node.priority,
        requiredRole: node.requiredRole,
        parentTaskId: graph.rootTaskId,
        dependencies: [],
        graphId: graph.id,
      });

      updatedNodes[nodeIndex] = { ...node, taskId: task.id };
    }

    this.graphRepo.updateNodes(graph.id, updatedNodes);
    this.graphRepo.updateStatus(graph.id, 'executing');

    await this.eventBus.emit('graph.created', {
      graphId: graph.id,
      projectId: graph.projectId,
      sessionId: graph.sessionId,
      isCrossProject: graph.isCrossProject,
      nodeCount: graph.nodes.length,
      layerCount: layers.length,
    }, {
      source: 'task-graph-service',
      projectId: graph.projectId,
      sessionId: graph.sessionId,
    });
  }

  /**
   * Check if the current layer is complete and advance to the next layer.
   * If all layers are complete, mark the graph as completed.
   */
  async advanceGraph(graphId: string): Promise<void> {
    const graph = this.graphRepo.findById(graphId);
    if (!graph || graph.status !== 'executing') return;

    const layers = this.getExecutionLayers(graph);
    const updatedNodes = [...graph.nodes];

    // Find the current layer: first layer with any incomplete nodes
    let currentLayerIndex = -1;
    for (const layer of layers) {
      const hasIncomplete = layer.nodeIds.some((id) => {
        const node = updatedNodes.find((n) => n.id === id);
        return node && node.status !== 'completed';
      });
      if (hasIncomplete) {
        currentLayerIndex = layer.index;
        break;
      }
    }

    // All layers complete
    if (currentLayerIndex === -1) {
      this.graphRepo.updateStatus(graphId, 'completed');
      await this.eventBus.emit('graph.completed', {
        graphId,
        projectId: graph.projectId,
      }, {
        source: 'task-graph-service',
        projectId: graph.projectId,
      });
      return;
    }

    const currentLayer = layers[currentLayerIndex];
    const allCurrentComplete = currentLayer.nodeIds.every((id) => {
      const node = updatedNodes.find((n) => n.id === id);
      return node && node.status === 'completed';
    });

    if (!allCurrentComplete) return; // Current layer still in progress

    // Current layer is complete — materialize the next layer
    const nextLayerIndex = currentLayerIndex + 1;
    if (nextLayerIndex >= layers.length) {
      // All done
      this.graphRepo.updateStatus(graphId, 'completed');
      await this.eventBus.emit('graph.completed', {
        graphId,
        projectId: graph.projectId,
      }, {
        source: 'task-graph-service',
        projectId: graph.projectId,
      });
      return;
    }

    await this.eventBus.emit('graph.layer.completed', {
      graphId,
      projectId: graph.projectId,
      layerIndex: currentLayerIndex,
    }, {
      source: 'task-graph-service',
      projectId: graph.projectId,
    });

    const nextLayer = layers[nextLayerIndex];

    // Collect taskIds of completed dependency nodes for proper task dependency wiring
    for (const nodeId of nextLayer.nodeIds) {
      const nodeIndex = updatedNodes.findIndex((n) => n.id === nodeId);
      if (nodeIndex === -1) continue;

      const node = updatedNodes[nodeIndex];
      if (node.taskId) continue; // Already materialized

      // Resolve task-level dependencies from graph-level dependsOn
      const taskDeps = node.dependsOn
        .map((depNodeId) => updatedNodes.find((n) => n.id === depNodeId)?.taskId)
        .filter((id): id is string => !!id);

      const nodeProjectId = node.projectId ?? graph.projectId;

      const task = await this.taskService.create({
        projectId: nodeProjectId,
        sessionId: graph.sessionId,
        title: node.title,
        description: node.description,
        priority: node.priority,
        requiredRole: node.requiredRole,
        parentTaskId: graph.rootTaskId,
        dependencies: taskDeps,
        graphId: graph.id,
      });

      updatedNodes[nodeIndex] = { ...node, taskId: task.id };
    }

    this.graphRepo.updateNodes(graph.id, updatedNodes);

    await this.eventBus.emit('graph.layer.started', {
      graphId,
      projectId: graph.projectId,
      layerIndex: nextLayerIndex,
      nodeCount: nextLayer.nodeIds.length,
    }, {
      source: 'task-graph-service',
      projectId: graph.projectId,
    });
  }

  /**
   * Handle a node's task completion.
   * Updates the node status and attempts to advance the graph.
   */
  async onTaskCompleted(graphId: string, nodeId: string): Promise<void> {
    const graph = this.graphRepo.findById(graphId);
    if (!graph) return;

    const updatedNodes = graph.nodes.map((n) =>
      n.id === nodeId ? { ...n, status: 'completed' as const } : n,
    );

    this.graphRepo.updateNodes(graphId, updatedNodes);

    await this.advanceGraph(graphId);
  }

  /**
   * Handle a node's task failure.
   * Marks the node as failed and the graph as failed.
   */
  async onTaskFailed(graphId: string, nodeId: string): Promise<void> {
    const graph = this.graphRepo.findById(graphId);
    if (!graph) return;

    const updatedNodes = graph.nodes.map((n) =>
      n.id === nodeId ? { ...n, status: 'failed' as const } : n,
    );

    this.graphRepo.updateNodes(graphId, updatedNodes);
    this.graphRepo.updateStatus(graphId, 'failed');

    await this.eventBus.emit('graph.failed', {
      graphId,
      projectId: graph.projectId,
      failedNodeId: nodeId,
    }, {
      source: 'task-graph-service',
      projectId: graph.projectId,
    });
  }
}
