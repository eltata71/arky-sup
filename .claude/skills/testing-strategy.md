# Testing Strategy

Define a testing strategy for a feature or module in this project.

## Usage
Tell me what to test (e.g. "testing strategy for geminiService", "how to test the auth flow", "test plan for the LMS progress tracking").

## Process

1. **Read the target file(s)** to understand what needs to be tested

2. **Identify test categories applicable to this module:**

### Unit Tests (pure functions, services)
- Best for: `services/geminiService.ts`, `services/firestoreService.ts`, `services/trainingService.ts`, utility functions
- Framework: **Vitest** (compatible with Vite, no config needed beyond `vite.config.ts`)
- Mock: Firebase SDK calls with `vi.mock('firebase/firestore')`, Gemini SDK with `vi.mock('@google/genai')`

### Component Tests (React components)
- Best for: complex UI logic, conditional rendering, form validation
- Framework: **Vitest + @testing-library/react**
- Mock: context providers with test wrappers

### Integration Tests (context + service)
- Best for: verifying AppContext actions correctly call firestoreService and update state
- Approach: mount context with mocked Firebase, dispatch action, assert state change

### E2E Tests (critical user flows)
- Best for: login → create project → generate artifact → save
- Framework: **Playwright** (works well with Vite dev server)

3. **Output a concrete test plan:**
   - List of test cases (Given / When / Then format)
   - Setup required (mocks, fixtures, test data)
   - Suggested file location (e.g. `src/__tests__/geminiService.test.ts`)
   - Vitest setup snippet if none exists yet

4. **If requested, write the test file**

Note: No test runner is currently configured. To add Vitest: `npm install -D vitest @testing-library/react @testing-library/jest-dom`.
