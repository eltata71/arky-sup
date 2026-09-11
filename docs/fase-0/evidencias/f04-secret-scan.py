"""Read tracked repository text only; emit locations/types, never matched values."""
import json
import re
import subprocess
from pathlib import Path
root = Path(__file__).resolve().parents[3]
patterns = {
    'Google API key (Firebase public configuration possible)': r'AIza[0-9A-Za-z_-]{35}',
    'OpenRouter key': r'sk-or-v1-[0-9a-f]{64}',
    'Anthropic key': r'sk-ant-[A-Za-z0-9_-]{24,}',
    'OpenAI-style key': r'sk-[A-Za-z0-9]{32,}',
    'Private key marker': r'-----BEGIN [A-Z ]*PRIVATE KEY-----',
    'GitHub token': r'(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})',
    'AWS access key id': r'(?:AKIA|ASIA)[A-Z0-9]{16}',
    'JWT-shaped token': r'eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}',
    'Literal credential assignment candidate': r'''(?i)(?:api[_-]?key|password|client[_-]?secret|access[_-]?token)\s*[=:]\s*['\"][^'\"\r\n]{12,}['\"]''',
}
files = subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).decode().split('\0')
findings = []
scanned = 0
for rel in filter(None, files):
    p = root / rel
    if not p.is_file() or p.is_symlink() or p.stat().st_size > 2_000_000:
        continue
    raw = p.read_bytes()
    if b'\0' in raw:
        continue
    try:
        text = raw.decode('utf-8')
    except UnicodeDecodeError:
        continue
    scanned += 1
    fixture = rel.startswith(('__tests__/', 'e2e/')) or '.test.' in rel or 'fixture' in rel.lower() or rel == 'scripts/seedE2E.mjs'
    example = rel.startswith(('docs/', '.claude/')) or rel.endswith('.example')
    for kind, regex in patterns.items():
        for match in re.finditer(regex, text):
            findings.append({'path': rel, 'line': text.count('\n', 0, match.start()) + 1, 'type': kind,
                             'classification': 'fixture/test' if fixture else 'documentation/example' if example else 'review-required'})
result = {'scope': 'git tracked working-tree text; no history, ignored files, global/profile credentials or network',
          'files_scanned': scanned, 'candidate_count': len(findings), 'findings': findings}
print(json.dumps(result, indent=2, ensure_ascii=False))
