/**
 * Minimal, dependency-free syntax highlighter for fenced code blocks inside
 * generated documents (SDD, ADR, API contracts…).
 *
 * Scope is deliberately narrow: comments, strings, keywords and numbers for
 * the languages that actually appear in architecture artifacts. The output
 * uses semantic `tok-*` classes that the document paper styles via Tailwind
 * arbitrary selectors — no external CSS theme required, and the HTML stays
 * compatible with `sanitizeGeneratedHtml` (spans + classes only).
 */

export type HighlightLanguage =
    | 'typescript' | 'javascript' | 'json' | 'yaml' | 'sql' | 'bash'
    | 'python' | 'java' | 'csharp' | 'xml' | 'http' | 'plain';

const LANGUAGE_ALIASES: Record<string, HighlightLanguage> = {
    ts: 'typescript', tsx: 'typescript', typescript: 'typescript',
    js: 'javascript', jsx: 'javascript', javascript: 'javascript', node: 'javascript',
    json: 'json', jsonc: 'json',
    yaml: 'yaml', yml: 'yaml',
    sql: 'sql', tsql: 'sql', plsql: 'sql',
    bash: 'bash', sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash',
    python: 'python', py: 'python',
    java: 'java', kotlin: 'java',
    csharp: 'csharp', cs: 'csharp', 'c#': 'csharp',
    xml: 'xml', html: 'xml', svg: 'xml',
    http: 'http', rest: 'http',
};

const KEYWORDS: Partial<Record<HighlightLanguage, string[]>> = {
    typescript: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'switch', 'case', 'break', 'continue', 'new', 'class', 'interface', 'type', 'enum', 'extends', 'implements', 'import', 'export', 'from', 'default', 'async', 'await', 'try', 'catch', 'finally', 'throw', 'public', 'private', 'protected', 'readonly', 'static', 'this', 'null', 'undefined', 'true', 'false', 'void', 'string', 'number', 'boolean'],
    javascript: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'switch', 'case', 'break', 'continue', 'new', 'class', 'extends', 'import', 'export', 'from', 'default', 'async', 'await', 'try', 'catch', 'finally', 'throw', 'this', 'null', 'undefined', 'true', 'false'],
    sql: ['select', 'from', 'where', 'insert', 'into', 'values', 'update', 'set', 'delete', 'create', 'table', 'alter', 'drop', 'index', 'join', 'inner', 'left', 'right', 'outer', 'on', 'group', 'by', 'order', 'having', 'limit', 'distinct', 'as', 'and', 'or', 'not', 'null', 'primary', 'key', 'foreign', 'references', 'constraint', 'unique', 'varchar', 'int', 'bigint', 'decimal', 'timestamp', 'boolean'],
    bash: ['if', 'then', 'else', 'elif', 'fi', 'for', 'do', 'done', 'while', 'case', 'esac', 'function', 'return', 'export', 'local', 'echo', 'exit', 'set'],
    python: ['def', 'return', 'if', 'elif', 'else', 'for', 'while', 'in', 'not', 'and', 'or', 'class', 'import', 'from', 'as', 'try', 'except', 'finally', 'raise', 'with', 'lambda', 'pass', 'None', 'True', 'False', 'self', 'async', 'await', 'yield'],
    java: ['public', 'private', 'protected', 'class', 'interface', 'enum', 'extends', 'implements', 'static', 'final', 'void', 'new', 'return', 'if', 'else', 'for', 'while', 'switch', 'case', 'break', 'try', 'catch', 'finally', 'throw', 'throws', 'import', 'package', 'this', 'null', 'true', 'false', 'int', 'long', 'double', 'boolean', 'String', 'var', 'record'],
    csharp: ['public', 'private', 'protected', 'internal', 'class', 'interface', 'enum', 'struct', 'static', 'readonly', 'void', 'new', 'return', 'if', 'else', 'for', 'foreach', 'while', 'switch', 'case', 'break', 'try', 'catch', 'finally', 'throw', 'using', 'namespace', 'this', 'null', 'true', 'false', 'int', 'string', 'bool', 'var', 'async', 'await', 'Task'],
    yaml: ['true', 'false', 'null', 'yes', 'no'],
    http: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD', 'HTTP'],
};

export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

export function resolveHighlightLanguage(infostring: string | undefined | null): HighlightLanguage {
    const lang = (infostring ?? '').trim().split(/\s+/)[0].toLowerCase();
    return LANGUAGE_ALIASES[lang] ?? 'plain';
}

interface TokenRule {
    type: 'com' | 'str' | 'num' | 'kw' | 'prop';
    re: RegExp;
}

function rulesFor(lang: HighlightLanguage): TokenRule[] {
    const rules: TokenRule[] = [];
    // Comments first so string/keyword rules never fire inside them.
    if (lang === 'sql') rules.push({ type: 'com', re: /--[^\n]*/g });
    if (lang === 'bash' || lang === 'yaml' || lang === 'python') rules.push({ type: 'com', re: /#[^\n]*/g });
    if (lang === 'typescript' || lang === 'javascript' || lang === 'java' || lang === 'csharp') {
        rules.push({ type: 'com', re: /\/\/[^\n]*|\/\*[\s\S]*?\*\//g });
    }
    if (lang === 'xml') rules.push({ type: 'com', re: /<!--[\s\S]*?-->/g });

    // Strings.
    rules.push({ type: 'str', re: /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g });

    // YAML keys / JSON properties.
    if (lang === 'yaml') rules.push({ type: 'prop', re: /^[ \t]*[\w.-]+(?=\s*:)/gm });

    // Numbers.
    rules.push({ type: 'num', re: /\b\d+(?:\.\d+)?\b/g });

    // Keywords.
    const kws = KEYWORDS[lang];
    if (kws && kws.length > 0) {
        const escaped = kws.map((k) => k.replace(/[#$]/g, '\\$&'));
        const flags = lang === 'sql' ? 'gi' : 'g';
        rules.push({ type: 'kw', re: new RegExp(`\\b(?:${escaped.join('|')})\\b`, flags) });
    }
    return rules;
}

/**
 * Highlight a code block. Returns HTML where matched tokens are wrapped in
 * `<span class="tok-…">` and everything is HTML-escaped. Single pass over
 * the source with non-overlapping matches (earlier rules win).
 */
export function highlightCode(source: string, infostring?: string | null): string {
    const lang = resolveHighlightLanguage(infostring);
    if (lang === 'plain' || source.length === 0 || source.length > 60_000) {
        return escapeHtml(source);
    }

    interface Match { start: number; end: number; type: TokenRule['type'] }
    const matches: Match[] = [];
    for (const rule of rulesFor(lang)) {
        rule.re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = rule.re.exec(source)) !== null) {
            if (m[0].length === 0) { rule.re.lastIndex++; continue; }
            matches.push({ start: m.index, end: m.index + m[0].length, type: rule.type });
        }
    }
    matches.sort((a, b) => a.start - b.start || b.end - a.end);

    const accepted: Match[] = [];
    let lastEnd = 0;
    for (const match of matches) {
        if (match.start < lastEnd) continue;
        accepted.push(match);
        lastEnd = match.end;
    }

    let html = '';
    let cursor = 0;
    for (const match of accepted) {
        html += escapeHtml(source.slice(cursor, match.start));
        html += `<span class="tok-${match.type}">${escapeHtml(source.slice(match.start, match.end))}</span>`;
        cursor = match.end;
    }
    html += escapeHtml(source.slice(cursor));
    return html;
}
