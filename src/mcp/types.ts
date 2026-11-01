import type { z, ZodRawShape } from 'zod';

/**
 * What a tool does to the media stack, declared on every tool so none is added
 * unclassified. MCP clients read the derived annotations to decide what to
 * auto-approve.
 * - read: changes nothing (lists, lookups, release and indexer searches).
 * - write: changes state in a way that adds or can be undone (add, monitor, run a command).
 * - destructive: deletes, or rewrites records and paths (delete, update, bulk edit, grab, import).
 */
export type ToolEffect = 'read' | 'write' | 'destructive';

export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
}

/** Per-call context passed to a tool handler. */
export interface ToolContext {
  /** Fires when the MCP client cancels the call. Upstream fetches already honour it. */
  signal?: AbortSignal;
}

export interface ToolDefinition<Shape extends ZodRawShape = ZodRawShape> {
  name: string;
  description: string;
  effect: ToolEffect;
  inputSchema: Shape;
  handler: (args: z.infer<z.ZodObject<Shape>>, context?: ToolContext) => Promise<unknown>;
}

export function annotationsFor(effect: ToolEffect): ToolAnnotations {
  return { readOnlyHint: effect === 'read', destructiveHint: effect === 'destructive' };
}

export function defineTool<Shape extends ZodRawShape>(
  definition: ToolDefinition<Shape>,
): ToolDefinition {
  return definition as unknown as ToolDefinition;
}
