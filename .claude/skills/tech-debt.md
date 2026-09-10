# Tech Debt Audit

Identify and prioritize technical debt in the Arky 10 codebase.

## Steps

1. **Run static checks:**
   ```
   !npm run lint 2>&1 | grep -E "error|warning" | head -40
   ```
   ```
   !git log --oneline -20
   ```

2. **Scan for known debt signals:**
   ```
   !grep -r "TODO\|FIXME\|HACK\|XXX\|any\b" --include="*.ts" --include="*.tsx" -n /home/user/arkypro-1.0/services/ /home/user/arkypro-1.0/context/ /home/user/arkypro-1.0/components/ 2>/dev/null | grep -v "node_modules" | head -50
   ```

3. **Check known incomplete areas from CLAUDE.md:**
   - `components/ReviewArchitectureModal.tsx` — empty placeholder
   - No test runner configured (no Vitest/Jest)
   - No ESLint or Prettier configured
   - No CI/CD pipelines (no `.github/workflows/`)
   - Some `.cjs` utility scripts may be out of date

4. **Assess AppContext size** — it's ~33k lines and contains all translations:
   ```
   !wc -l /home/user/arkypro-1.0/context/AppContext.tsx
   ```

5. **Output a prioritized debt backlog:**

| Priority | Item | File(s) | Effort | Impact |
|---|---|---|---|---|
| High | ... | ... | S/M/L | Why it matters |
| Medium | ... | ... | S/M/L | ... |
| Low | ... | ... | S/M/L | ... |

Include recommended remediation steps for the top 3 items.
