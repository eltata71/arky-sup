# Incident Response

Structured guide for responding to a production incident in the Arky 10 application.

## Usage
Describe the incident (e.g. "users can't log in", "AI generation is failing", "data not saving").

## Response Protocol

### 1. Triage (first 5 minutes)
- **Severity**: How many users affected? Is core functionality broken?
- **Scope**: Which feature/page/service is impacted?
- **Start time**: When did it start? Any recent deploy?

Check recent deployments:
```
!git log --oneline -10
```

### 2. Identify the failure domain

| Symptom | Likely cause | Where to look |
|---|---|---|
| Auth broken | Firebase Auth outage or config | Firebase Console → Auth, Authorized Domains |
| Data not loading/saving | Firestore outage or rules change | Firebase Console → Firestore, Rules |
| AI generation failing | Gemini API key expired/quota | `geminiService.ts` retry logic, API dashboard |
| Blank page / JS crash | Build regression | Vercel → Deployments → Runtime Logs |
| Specific feature broken | Recent code change | `git log` + `git diff` |

### 3. Investigate
Read the relevant service file for the broken area and trace the call path from the component down.

### 4. Mitigate
- **Rollback** to last known good Vercel deployment if a deploy caused it
- **Hot-fix** if a specific function is identified
- **Disable feature** via a conditional if a full fix takes time

### 5. Resolve & Document
- Confirm fix is deployed and verified
- Note: what broke, root cause, fix applied, how to prevent recurrence
