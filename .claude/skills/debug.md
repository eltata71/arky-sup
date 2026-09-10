# Debug Workflow

Systematically diagnose and fix a bug in this React/TypeScript/Firebase/Vite application.

## Usage
Describe the bug you are seeing, then I will guide the investigation.

## Debugging Protocol

1. **Reproduce & characterize**
   - What is the exact symptom? (error message, wrong UI state, silent failure)
   - Is it consistent or intermittent?
   - Which page/component/action triggers it?

2. **Locate the failure point** — check in order:
   - Browser console errors (ask user to paste if needed)
   - React component rendering (`console.log` state/props at suspect component)
   - Context values (`AppContext`, `AuthContext`, `LMSContext`)
   - Service layer (`services/firestoreService.ts`, `services/geminiService.ts`)
   - Firebase Auth/Firestore network tab

3. **Read relevant source files** based on the failure area:
   - UI bug → read the component file
   - Data not loading → read `firestoreService.ts` and the context that calls it
   - AI response issue → read `geminiService.ts`
   - Auth issue → read `AuthContext.tsx`

4. **Form a hypothesis** → test it by reading code, then propose a minimal fix

5. **Apply the fix** and describe how to verify it is resolved

6. **Check for regressions** — what other code paths might be affected?

Always prefer reading code before guessing. Never assume the bug is in a file you haven't read.
