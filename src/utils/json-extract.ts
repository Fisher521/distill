export function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();
  const fence = /^```(?:json|JSON)?\s*\n?([\s\S]*?)\n?```\s*$/;
  const match = trimmed.match(fence);
  if (match && typeof match[1] === 'string') {
    return match[1].trim();
  }
  return trimmed;
}

export function extractJSONObject(raw: string): string | null {
  const start = raw.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];

    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return raw.slice(start, i + 1);
      }
    }
  }

  return null;
}

export function parseRobustJSON<T = unknown>(raw: string): T {
  const stripped = stripCodeFences(raw);
  try {
    return JSON.parse(stripped) as T;
  } catch {
    const extracted = extractJSONObject(stripped);
    if (extracted === null) {
      throw new Error('no JSON object found in input');
    }
    return JSON.parse(extracted) as T;
  }
}
