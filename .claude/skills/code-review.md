# Code Review

Review recent code changes in this project with a focus on correctness, security, and maintainability.

## Steps

1. **Get the diff to review:**
   ```
   !git diff HEAD~1 --stat
   !git diff HEAD~1
   ```
   If no recent commit, use staged changes:
   ```
   !git diff --staged
   ```

2. **For each changed file, check:**
   - **Correctness**: Does the logic match the intent? Edge cases handled?
   - **TypeScript**: No `any` types, proper interface definitions, strict mode compliance
   - **React patterns**: No missing deps in useEffect, no state mutations, proper key props
   - **Security**: No API keys hardcoded, no XSS risks (dangerouslySetInnerHTML), no SQL/NoSQL injection via Firestore queries
   - **Service layer**: Firebase/Gemini calls go through `services/`, not directly in components
   - **Performance**: No unnecessary re-renders, expensive computations memoized, no blocking the main thread
   - **Error handling**: Async operations wrapped in try/catch, user-facing errors communicated clearly

3. **Format the review as:**
   - Summary of changes
   - Issues found (Critical / Warning / Suggestion), each with file:line reference
   - What was done well
   - Recommended next steps
