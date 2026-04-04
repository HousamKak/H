/**
 * Parses Claude Code `--output-format stream-json` stdout.
 * Each line is a JSON object with a `type` field.
 * Handles partial line buffering for streaming data.
 */

export interface ClaudeCodeEvent {
  type: 'init' | 'system' | 'assistant' | 'result' | 'tool_use' | 'tool_result' | 'error' | 'usage' | 'unknown';
  data: Record<string, unknown>;
  raw: string;
}

export class OutputParser {
  private buffer = '';

  /**
   * Feed raw data from stdout, returns parsed events.
   * Handles partial lines by buffering incomplete JSON.
   */
  feed(data: string): ClaudeCodeEvent[] {
    this.buffer += data;
    const events: ClaudeCodeEvent[] = [];
    const lines = this.buffer.split('\n');

    // Last element might be incomplete — keep it in buffer
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const parsed = JSON.parse(trimmed);
        events.push(this.classify(parsed, trimmed));
      } catch {
        // Not valid JSON — could be plain text output
        events.push({
          type: 'unknown',
          data: { text: trimmed },
          raw: trimmed,
        });
      }
    }

    return events;
  }

  /**
   * Flush remaining buffer (call when process exits).
   */
  flush(): ClaudeCodeEvent[] {
    const remaining = this.buffer.trim();
    this.buffer = '';
    if (!remaining) return [];

    try {
      const parsed = JSON.parse(remaining);
      return [this.classify(parsed, remaining)];
    } catch {
      return remaining ? [{
        type: 'unknown',
        data: { text: remaining },
        raw: remaining,
      }] : [];
    }
  }

  private classify(parsed: Record<string, unknown>, raw: string): ClaudeCodeEvent {
    const type = parsed.type as string;

    switch (type) {
      case 'system':
        return { type: 'system', data: parsed, raw };
      case 'assistant':
        return { type: 'assistant', data: parsed, raw };
      case 'result':
        return { type: 'result', data: parsed, raw };
      case 'tool_use':
        return { type: 'tool_use', data: parsed, raw };
      case 'tool_result':
        return { type: 'tool_result', data: parsed, raw };
      case 'error':
        return { type: 'error', data: parsed, raw };
      case 'usage':
        return { type: 'usage', data: parsed, raw };
      default:
        // Claude Code may use different event names; classify by content
        if (parsed.role === 'assistant') return { type: 'assistant', data: parsed, raw };
        if (parsed.content && parsed.stop_reason) return { type: 'result', data: parsed, raw };
        if (parsed.input !== undefined && parsed.name) return { type: 'tool_use', data: parsed, raw };
        return { type: 'unknown', data: parsed, raw };
    }
  }
}
