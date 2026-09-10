# System Design

Help design a new feature or system within the Arky 10 architecture.

## Usage
Describe the feature or system you want to design (e.g. "design a notifications system", "how should we add real-time collaboration?").

## Design Process

1. **Clarify requirements**
   - What is the user need being solved?
   - Who uses it (which roles: superadmin, admin, teacher, student)?
   - What is the expected scale / frequency of use?

2. **Read the relevant existing code** to understand the current architecture:
   - Domain types in `types/types.ts` and `types/lms.ts`
   - Related services in `services/`
   - Related context in `context/`
   - Routing in `App.tsx`

3. **Design across all layers:**

   **Data model** (Firestore collections)
   - New collection(s) needed? Fields? Indexes?
   - How does it relate to existing collections (`projects`, `users`, `courses`)?

   **Service layer** (`services/`)
   - New file or extend existing service?
   - CRUD operations needed?
   - Any Gemini AI integration?

   **State management** (`context/`)
   - Extend `AppContext`, `LMSContext`, or new context?
   - What state needs to be globally accessible?

   **UI** (`pages/` and `components/`)
   - New page or modal/panel in existing page?
   - New route in `App.tsx`?

   **Auth & permissions**
   - Which roles can access/modify this feature?

4. **Output a design document** with:
   - Overview (2–3 sentences)
   - Data model (Firestore schema)
   - Service API (function signatures)
   - UI structure (component tree)
   - Open questions / trade-offs
