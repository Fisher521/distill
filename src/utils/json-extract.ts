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

const VALID_ESCAPE_CHARS = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u']);

function nextNonWhitespaceChar(raw: string, start: number): string | null {
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (ch && !/\s/.test(ch)) {
      return ch;
    }
  }
  return null;
}

export function repairJSON(raw: string): string {
  let out = '';
  let inString = false;
  let escape = false;
  let changed = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (!inString) {
      out += ch;
      if (ch === '"') {
        inString = true;
      }
      continue;
    }

    if (escape) {
      out += ch;
      escape = false;
      continue;
    }

    if (ch === '\\') {
      const next = raw[i + 1];
      if (next && VALID_ESCAPE_CHARS.has(next)) {
        out += ch;
        escape = true;
      } else {
        out += '\\\\';
        changed = true;
      }
      continue;
    }

    if (ch === '"') {
      const next = nextNonWhitespaceChar(raw, i + 1);
      if (
        next === null ||
        next === ',' ||
        next === '}' ||
        next === ']' ||
        next === ':'
      ) {
        out += ch;
        inString = false;
      } else {
        out += '\\"';
        changed = true;
      }
      continue;
    }

    if (ch === '\n') {
      out += '\\n';
      changed = true;
      continue;
    }

    if (ch === '\r') {
      out += '\\r';
      changed = true;
      continue;
    }

    if (ch === '\t') {
      out += '\\t';
      changed = true;
      continue;
    }

    out += ch;
  }

  return changed ? out : raw;
}

function parseWithRepair<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    const repaired = repairJSON(raw);
    if (repaired === raw) {
      throw err;
    }
    return JSON.parse(repaired) as T;
  }
}

export function parseRobustJSON<T = unknown>(raw: string): T {
  const stripped = stripCodeFences(raw);
  try {
    return parseWithRepair<T>(stripped);
  } catch {
    const extracted = extractJSONObject(stripped);
    if (extracted === null) {
      throw new Error('no JSON object found in input');
    }
    return parseWithRepair<T>(extracted);
  }
}
