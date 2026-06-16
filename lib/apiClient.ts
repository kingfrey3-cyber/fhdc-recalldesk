function cleanErrorText(text: string) {
  return String(text || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 700);
}

function friendlyError(text: string, status?: number) {
  const raw = String(text || '');
  const clean = cleanErrorText(raw);
  if (raw.includes('520') || clean.toLowerCase().includes('bad gateway') || raw.includes('<!DOCTYPE')) {
    return 'Supabase rejected or timed out during a large save. Try again after applying the operational upload patch, and upload in smaller batches first.';
  }
  return clean || `Request failed${status ? ` with status ${status}` : ''}.`;
}

export async function parseJsonResponse(res: Response) {
  const contentType = res.headers.get('content-type') || '';
  const text = await res.text();

  if (!contentType.includes('application/json')) {
    throw new Error(
      `Server returned ${res.status} ${res.statusText || ''} instead of JSON. ` + friendlyError(text, res.status)
    );
  }

  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error('The server returned invalid JSON. Check the VS Code terminal for the real API error.');
  }

  if (!res.ok) {
    throw new Error(friendlyError(data?.error || data?.message || `Request failed with status ${res.status}`, res.status));
  }

  return data;
}

export async function fetchJson(input: RequestInfo | URL, init?: RequestInit) {
  const res = await fetch(input, init);
  return parseJsonResponse(res);
}
