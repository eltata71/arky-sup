# Documentation

Generate or update documentation for a component, service, hook, or feature.

## Usage
Tell me what to document (e.g. "document the geminiService", "add JSDoc to useLMS hook", "explain how artifact creation works").

## Process

1. **Read the target file(s)** before writing anything
2. **Understand what the code actually does** — do not document assumptions
3. **Choose the right documentation type:**

### For services (`services/*.ts`)
- Add JSDoc to each exported function: purpose, parameters, return value, throws
- Include a module-level comment explaining the service's responsibility and which external system it wraps

### For React components (`components/*.tsx`, `pages/*.tsx`)
- Document the Props interface with a comment per prop
- Add a brief component-level comment: what it renders, when it's used, key behaviours
- Note any important context dependencies

### For hooks (`hooks/*.ts`)
- Document parameters, return value shape, and side effects
- Note which context(s) the hook reads

### For context files (`context/*.tsx`)
- Document the shape of the context value
- Explain which actions mutate state and how

### For types (`types/*.ts`)
- Add comments to interfaces and their fields explaining domain meaning

## Style Rules
- Write for a developer who is new to the codebase
- Be concise — one sentence per prop/param unless it's genuinely complex
- Do NOT invent behaviour that isn't in the code
- Use TypeScript JSDoc format (`/** ... */`)
