import { AsyncLocalStorage } from 'node:async_hooks';

// The MCP request's cancellation signal, carried to every upstream fetch a tool call makes
// without threading a parameter through the product clients and every tool handler.
const requestSignal = new AsyncLocalStorage<AbortSignal>();

/** Runs fn with signal as the current MCP request's cancellation signal. */
export function withRequestSignal<T>(signal: AbortSignal | undefined, fn: () => T): T {
  return signal ? requestSignal.run(signal, fn) : fn();
}

/** The cancellation signal of the MCP request being handled, if any. */
export function currentRequestSignal(): AbortSignal | undefined {
  return requestSignal.getStore();
}
