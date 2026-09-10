# Standup Summary

Generate a developer standup summary from recent git activity.

## Steps

1. **Gather recent activity:**
   ```
   !git log --since="yesterday" --oneline --author="$(git config user.name)" 2>/dev/null || git log --oneline -10
   ```
   ```
   !git diff HEAD~3 --stat 2>/dev/null
   ```
   ```
   !git status --short
   ```

2. **Format as a standup report:**

```
## Standup — [Today's Date]

### Yesterday (completed)
- [inferred from commit messages]

### Today (planned)
- [inferred from uncommitted changes, open TODOs, or ask user]

### Blockers
- [ask user, or "None identified"]

### Notes
- Branch: [current branch]
- Files in progress: [list from git status]
```

3. **Keep it brief** — each point is one line. Translate commit messages into plain language (e.g. "fix: gemini retry logic" → "Fixed AI generation retry on 503 errors").

If there are no recent commits, ask the user to describe what they worked on.
