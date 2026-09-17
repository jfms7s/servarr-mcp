export interface ArrApiErrorOptions {
  product: string;
  method: string;
  path: string;
  status?: number;
  detail: string;
}

export class ArrApiError extends Error {
  readonly product: string;
  readonly method: string;
  readonly path: string;
  readonly status?: number;
  readonly detail: string;

  constructor(options: ArrApiErrorOptions) {
    const { product, method, path, status, detail } = options;
    const message =
      status === undefined
        ? `Cannot reach ${product} for ${method} ${path}: ${detail}`
        : `${product} returned ${status} for ${method} ${path}: ${detail}`;
    super(message);
    this.name = 'ArrApiError';
    this.product = product;
    this.method = method;
    this.path = path;
    this.status = status;
    this.detail = detail;
  }
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
