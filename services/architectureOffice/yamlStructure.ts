/**
 * Minimal structural reader for YAML specification documents.
 *
 * The Office validators used to answer "does this document declare `paths`?"
 * with `content.includes('paths:')`. That matches the string **anywhere** —
 * inside a description, a comment, an example payload, or an unrelated nested
 * key — so a document could pass by mentioning a word it never actually
 * declares, and a genuine document could be judged on prose rather than
 * structure.
 *
 * This reads the indentation tree instead, which is what those questions really
 * mean: *is this a top-level key*, *does this nested path exist*, *what scalar
 * sits at it*.
 *
 * **Scope, honestly stated.** This is not a YAML parser and must not be sold as
 * one. It understands block mappings, comments, quoted scalars, and whether a
 * flow collection is empty — the shape OpenAPI and AsyncAPI documents actually
 * take. It does *not* descend into flow style (`{a: {b: 1}}`), nor handle
 * anchors, aliases, multi-document streams or block scalars' inner content.
 * Anything it cannot read simply does not resolve, so a validator degrades to
 * "not declared" rather than to a false pass.
 *
 * A full parser (`js-yaml`) would be stricter, but it is not a declared
 * dependency of this project and pulling one into the client bundle to answer
 * four structural questions is a poor trade. If the validators ever need real
 * schema validation, that is the moment to add it — and to say so.
 */

export interface YamlNode {
  /** Scalar text when the key holds a value on the same line. */
  value?: string;
  children: Map<string, YamlNode>;
  /**
   * True when the key holds a non-empty inline collection (`{a: 1}`, `[1, 2]`).
   * The reader does not descend into flow style, but it must at least tell
   * `paths: {}` (declared, empty) from `paths: {/claims: …}` (populated) —
   * otherwise a real contract would be reported as having no operations.
   */
  hasInlineEntries?: boolean;
}

const KEY_LINE = /^(\s*)([A-Za-z0-9_$@./-]+|"[^"]*"|'[^']*')\s*:\s*(.*)$/;

/** `{a: 1}` / `[1]` yes; `{}` / `[]` no; anything else is a plain scalar. */
const isNonEmptyFlowCollection = (value: string): boolean => {
  const trimmed = value.trim();
  const isFlow = (trimmed.startsWith('{') && trimmed.endsWith('}'))
    || (trimmed.startsWith('[') && trimmed.endsWith(']'));
  return isFlow && trimmed.slice(1, -1).trim().length > 0;
};

const unquote = (raw: string): string => {
  const trimmed = raw.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
};

/** Strips a trailing `# comment`, leaving quoted `#` alone. */
const stripComment = (value: string): string => {
  let inSingle = false;
  let inDouble = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "'" && !inDouble) inSingle = !inSingle;
    else if (char === '"' && !inSingle) inDouble = !inDouble;
    else if (char === '#' && !inSingle && !inDouble) {
      // Only a `#` preceded by whitespace (or at the start) opens a comment.
      if (index === 0 || /\s/.test(value[index - 1])) return value.slice(0, index);
    }
  }
  return value;
};

/**
 * Builds the mapping tree of a YAML document. Never throws: a line it cannot
 * read is skipped, so a malformed document yields a partial tree rather than
 * an exception in the middle of a quality gate.
 */
export const readYamlStructure = (source: string): YamlNode => {
  const root: YamlNode = { children: new Map() };
  if (typeof source !== 'string' || source.trim().length === 0) return root;

  // Stack of (indent, node) so a key attaches to its nearest shallower parent.
  const stack: { indent: number; node: YamlNode }[] = [{ indent: -1, node: root }];

  for (const rawLine of source.split(/\r?\n/)) {
    const line = stripComment(rawLine);
    if (line.trim().length === 0) continue;
    // Sequence entries carry no mapping key of their own at this level.
    if (/^\s*-\s/.test(line)) continue;

    const match = KEY_LINE.exec(line);
    if (!match) continue;

    const indent = match[1].replace(/\t/g, '  ').length;
    const key = unquote(match[2]);
    const inlineValue = match[3].trim();

    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();

    const parent = stack[stack.length - 1].node;
    const existing = parent.children.get(key);
    const node: YamlNode = existing ?? { children: new Map() };
    if (inlineValue.length > 0) {
      node.value = unquote(inlineValue);
      node.hasInlineEntries = isNonEmptyFlowCollection(inlineValue);
    }
    parent.children.set(key, node);

    stack.push({ indent, node });
  }

  return root;
};

const resolve = (root: YamlNode, path: readonly string[]): YamlNode | undefined => {
  let current: YamlNode | undefined = root;
  for (const key of path) {
    current = current?.children.get(key);
    if (!current) return undefined;
  }
  return current;
};

/** True when the dotted path is declared as a mapping key. */
export const hasYamlPath = (root: YamlNode, path: string): boolean =>
  resolve(root, path.split('.')) !== undefined;

/** Scalar declared at the dotted path, or `undefined` when absent or a mapping. */
export const getYamlScalar = (root: YamlNode, path: string): string | undefined =>
  resolve(root, path.split('.'))?.value;

/** Keys declared at the document root. */
export const yamlTopLevelKeys = (root: YamlNode): string[] => [...root.children.keys()];

/**
 * True when the path resolves to a mapping that declares at least one key —
 * the difference between `paths:` present but empty and an actual API surface.
 */
export const hasYamlEntries = (root: YamlNode, path: string): boolean => {
  const node = resolve(root, path.split('.'));
  if (!node) return false;
  return node.children.size > 0 || node.hasInlineEntries === true;
};
