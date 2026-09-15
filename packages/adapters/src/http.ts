export class UpstreamError extends Error {
  constructor(
    readonly service: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

export async function postJson<T>(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  fetcher: typeof fetch,
): Promise<T> {
  const response = await fetcher(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new UpstreamError(new URL(url).hostname, response.status, detail || response.statusText);
  }
  return response.json() as Promise<T>;
}
