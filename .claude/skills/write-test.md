# Write Test

Generate a Vitest test for a target file in the Arky 10 codebase. Use when the user asks to "write a test for X", "add coverage for Y", or "test the behaviour of Z". Vitest is already configured — no setup needed.

## Usage

Tell the skill which file to test (e.g. "write a test for `services/firestoreService.ts#getProject`", "add a component test for `components/AddArtifactModal.tsx`").

## Process

1. **Read the target file** and any types it depends on. Never write a test based on guessed behaviour.

2. **Pick the test category:**

   | Target | Category | Framework pieces |
   |---|---|---|
   | `services/*.ts` | Unit | `vitest` + `vi.mock('firebase/firestore')` / `vi.mock('@google/genai')` |
   | `hooks/*.ts` | Unit | `vitest` + `@testing-library/react` `renderHook` |
   | `components/*.tsx` or `pages/*.tsx` | Component | `vitest` + `@testing-library/react` + `jsdom` |
   | Context + service interaction | Integration | Mount the context with a mocked service, dispatch actions, assert state |

3. **Place the test file:**
   - If other tests already exist, match their location convention.
   - Otherwise, prefer adjacent placement: `foo.ts` → `foo.test.ts` in the same directory.

4. **Write the test file** following this template:

   ```ts
   import { describe, it, expect, vi, beforeEach } from 'vitest';

   // 1. Mock external SDKs BEFORE importing the module under test
   vi.mock('firebase/firestore', () => ({
     getDoc: vi.fn(),
     setDoc: vi.fn(),
     // ...only mock what this test needs
   }));

   // 2. Import AFTER the mocks
   import { someFunction } from './target';

   describe('someFunction', () => {
     beforeEach(() => {
       vi.clearAllMocks();
     });

     it('Given <precondition>, When <action>, Then <expected>', async () => {
       // arrange
       // act
       // assert
     });
   });
   ```

   For component tests, prefer `render` + `screen.getByRole` / `findByText`. Avoid `getByTestId` unless no semantic query works.

5. **Run and report:**
   ```
   !npm run test:ci
   ```
   Report pass/fail. If failing, diagnose by reading the test output — do not re-run blindly.

## Rules

- Never call real Firebase / Gemini — always mock.
- Keep one behaviour per `it(...)` block.
- Do not add `any` types inside test files (TypeScript strict applies here too).
- Prefer `toHaveBeenCalledWith` + explicit arguments over loose assertions.
- If the target file has side effects at import time, move them behind a factory so they can be mocked or stubbed.
