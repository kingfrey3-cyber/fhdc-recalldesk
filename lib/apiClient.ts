export async function parseJsonResponse(res: Response) {
  const contentType = res.headers.get('content-type') || '';
  const text = await res.text();

  if (!contentType.includes('application/json')) {
    const cleanText = text
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500);

    throw new Error(
      `Server returned ${res.status} ${res.statusText || ''} instead of JSON. ` +
      `${cleanText || 'This usually means an API route crashed before it could respond.'}`
    );
  }

  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error('The server returned invalid JSON. Check the VS Code terminal for the real API error.');
  }

  if (!res.ok) {
    throw new Error(data?.error || `Request failed with status ${res.status}`);
  }

  return data;
}

export async function fetchJson(input: RequestInfo | URL, init?: RequestInit) {
  const res = await fetch(input, init);
  return parseJsonResponse(res);
}
