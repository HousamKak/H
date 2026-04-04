import type { AgentInstance, AgentDefinition, SpawnAgentInput, AgentStatus } from '@h/types';
import { generateId } from '@h/types';
import { getDatabase } from '../database.js';

export class AgentRepository {
  // ---- Definitions ----

  findAllDefinitions(): AgentDefinition[] {
    const db = getDatabase();
    const rows = db.prepare('SELECT * FROM agent_definitions ORDER BY role').all() as any[];
    return rows.map(toDefinition);
  }

  findDefinition(role: string): AgentDefinition | undefined {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM agent_definitions WHERE role = ?').get(role) as any;
    return row ? toDefinition(row) : undefined;
  }

  upsertDefinition(def: AgentDefinition): void {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO agent_definitions (role, name, description, system_prompt, capabilities_json, llm_provider, model, max_concurrent_tasks, temperature, token_budget, max_turns, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(role) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        system_prompt = excluded.system_prompt,
        capabilities_json = excluded.capabilities_json,
        llm_provider = excluded.llm_provider,
        model = excluded.model,
        max_concurrent_tasks = excluded.max_concurrent_tasks,
        temperature = excluded.temperature,
        token_budget = excluded.token_budget,
        max_turns = excluded.max_turns,
        updated_at = datetime('now')
    `).run(
      def.role, def.name, def.description, def.systemPrompt,
      JSON.stringify(def.capabilities), def.llmProvider, def.model ?? null,
      def.maxConcurrentTasks, def.temperature, def.tokenBudget, def.maxTurns
    );
  }

  // ---- Instances ----

  findAllInstances(filter?: { projectId?: string; status?: AgentStatus }): AgentInstance[] {
    const db = getDatabase();
    let sql = 'SELECT * FROM agent_instances WHERE 1=1';
    const params: unknown[] = [];

    if (filter?.projectId) { sql += ' AND project_id = ?'; params.push(filter.projectId); }
    if (filter?.status) { sql += ' AND status = ?'; params.push(filter.status); }
    sql += ' ORDER BY spawned_at DESC';

    return (db.prepare(sql).all(...params) as any[]).map(toInstance);
  }

  findInstance(id: string): AgentInstance | undefined {
    const db = getDatabase();
    const row = db.prepare('SELECT * FROM agent_instances WHERE id = ?').get(id) as any;
    return row ? toInstance(row) : undefined;
  }

  createInstance(input: SpawnAgentInput, tokenBudget: number): AgentInstance {
    const db = getDatabase();
    const id = generateId();
    const now = new Date().toISOString();
    const runtimeType = input.runtimeType ?? 'internal';

    db.prepare(`
      INSERT INTO agent_instances (id, definition_role, project_id, session_id, runtime_type, status, current_task_id, token_budget, turn_count, spawned_at, last_active_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'spawning', ?, ?, 0, ?, ?, ?, ?)
    `).run(id, input.role, input.projectId, input.sessionId ?? null, runtimeType, input.taskId ?? null, tokenBudget, now, now, now, now);

    return this.findInstance(id)!;
  }

  updateInstanceStatus(id: string, status: AgentStatus, extra?: { currentTaskId?: string | null; errorMessage?: string; turnCount?: number }): void {
    const db = getDatabase();
    const now = new Date().toISOString();
    const sets = ['status = ?', 'last_active_at = ?', 'updated_at = ?'];
    const params: unknown[] = [status, now, now];

    if (extra?.currentTaskId !== undefined) { sets.push('current_task_id = ?'); params.push(extra.currentTaskId); }
    if (extra?.errorMessage !== undefined) { sets.push('error_message = ?'); params.push(extra.errorMessage); }
    if (extra?.turnCount !== undefined) { sets.push('turn_count = ?'); params.push(extra.turnCount); }
    if (status === 'terminated') { sets.push('terminated_at = ?'); params.push(now); }

    params.push(id);
    db.prepare(`UPDATE agent_instances SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  }

  deleteInstance(id: string): boolean {
    const db = getDatabase();
    return db.prepare('DELETE FROM agent_instances WHERE id = ?').run(id).changes > 0;
  }
}

function toDefinition(row: any): AgentDefinition {
  return {
    role: row.role,
    name: row.name,
    description: row.description ?? '',
    systemPrompt: row.system_prompt,
    capabilities: JSON.parse(row.capabilities_json),
    llmProvider: row.llm_provider,
    model: row.model ?? undefined,
    maxConcurrentTasks: row.max_concurrent_tasks,
    temperature: row.temperature,
    tokenBudget: row.token_budget,
    maxTurns: row.max_turns,
  };
}

function toInstance(row: any): AgentInstance {
  return {
    id: row.id,
    definitionRole: row.definition_role,
    projectId: row.project_id,
    sessionId: row.session_id ?? undefined,
    status: row.status,
    runtimeType: row.runtime_type ?? 'internal',
    currentTaskId: row.current_task_id ?? undefined,
    terminalId: row.terminal_id ?? undefined,
    mcpConfigPath: row.mcp_config_path ?? undefined,
    turnCount: row.turn_count,
    tokenBudget: row.token_budget,
    spawnedAt: row.spawned_at,
    lastActiveAt: row.last_active_at,
    terminatedAt: row.terminated_at ?? undefined,
    errorMessage: row.error_message ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
