export async function* parseSSE(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        yield data;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function openRouterDelta(payload: unknown): string {
  let target = payload;
  if (typeof target === 'string') {
    try {
      target = JSON.parse(target);
    } catch {
      return '';
    }
  }
  if (target && typeof target === 'object') {
    const p = target as { choices?: Array<{ delta?: { content?: string } }> };
    return p.choices?.[0]?.delta?.content ?? '';
  }
  return '';
}
