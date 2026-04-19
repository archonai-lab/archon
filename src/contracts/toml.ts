type TomlScalar = string | boolean | string[];
interface TomlNode {
  [key: string]: TomlScalar | TomlNode;
}

function parseTomlValue(raw: string): TomlScalar {
  const value = raw.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner
      .split(",")
      .map((part) => part.trim())
      .map((part) => part.replace(/^"(.*)"$/, "$1"));
  }
  return value.replace(/^"(.*)"$/, "$1");
}

function ensureObjectPath(root: TomlNode, path: string[]): TomlNode {
  let cursor = root;
  for (const part of path) {
    const next = cursor[part];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      cursor[part] = {};
    }
    cursor = cursor[part] as TomlNode;
  }
  return cursor;
}

export function parseContractToml(input: string): TomlNode {
  const root: TomlNode = {};
  let current: TomlNode = root;

  for (const rawLine of input.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const sectionMatch = /^\[([A-Za-z0-9_.-]+)\]$/.exec(line);
    if (sectionMatch) {
      current = ensureObjectPath(root, sectionMatch[1].split("."));
      continue;
    }

    const keyValueMatch = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(line);
    if (!keyValueMatch) {
      throw new Error(`Unsupported TOML line: ${line}`);
    }

    const [, key, rawValue] = keyValueMatch;
    current[key] = parseTomlValue(rawValue);
  }

  return root;
}
