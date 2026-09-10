# Architecture Analysis

Perform a thorough architectural analysis of this React/TypeScript/Firebase/Vite SaaS project.

## Steps

1. **Read key files** to understand the current structure:
   - `CLAUDE.md` for project overview
   - `App.tsx` for routing
   - `context/AppContext.tsx` for state management
   - `types/types.ts` for domain model
   - `services/` directory for service layer

2. **Assess each architectural dimension:**
   - **Separation of concerns**: Are components, services, context, and types cleanly separated?
   - **State management**: Is AppContext growing too large? Should any state be split?
   - **Service layer**: Are all Firebase/Gemini calls going through services (not directly from components)?
   - **Type safety**: Are `any` types used anywhere? Are interfaces complete?
   - **Routing**: Does `App.tsx` route structure reflect current features?
   - **Bundle size**: Are there large unused imports? Is code splitting in use?
   - **Error boundaries**: Are errors handled gracefully at the component level?

3. **Identify top issues** ranked by impact (high/medium/low)

4. **Propose concrete improvements** with file paths and implementation hints

Focus on actionable recommendations, not generic advice.
