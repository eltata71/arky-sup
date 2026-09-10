# Add LMS Course

Create a new LMS course end-to-end: Firestore document, lesson structure, integration with the catalog, and a test read. Use when the user wants to "add a course", "create a training", "seed an LMS entry", or similar.

## Usage

Ask for (or infer from the request):
- Course title, subtitle/description
- Target audience (role: `student` / `teacher` / all)
- Number and shape of lessons (video, text, quiz, interactive…)
- Whether the course should be AI-generated (use the LMS methods on `geminiService`) or hand-authored

## Process

1. **Read the LMS data model** before writing anything:
   - `types/lms.ts` — Course, Lesson, UserProgress, LessonType (union)
   - `services/trainingService.ts` — `saveCourse`, `updateCourse`, `getCourses`, etc.
   - `services/geminiService.ts` — AI LMS helpers (`generateCourseSyllabus`, `generateRoleCatalog`, `generateLessonTabContent`)
   - `context/LMSContext.tsx` — how the catalog refreshes after a write
   - `pages/LMS/LMSCatalog.tsx` — how courses are rendered and filtered

2. **Assemble the course object** following the `Course` interface exactly:
   - Required metadata: `title`, `description`, `id` (UUID), `lessons: Lesson[]`, `createdAt`, `updatedAt`, `authorId`.
   - Validate each lesson against the `Lesson` type (`type`, `content`, `durationMinutes` if relevant, quiz questions if applicable).
   - For AI-generated content, call `geminiService.generateCourseSyllabus(topic, courseContext, settings)` and validate the returned shape before writing.

3. **Persist via the service layer:**
   ```ts
   await createCourse(course);   // in services/trainingService.ts
   ```
   Never call `addDoc` / `setDoc` directly from a component or page.

4. **Verify it shows up:**
   - Open `/training/catalog` in the dev server — the new course must appear.
   - Click through to `/training/course/:id` and confirm the lessons render in `LessonModal`.
   - Enroll as the current user and confirm progress is written to `lms_progress`.

5. **Role check:**
   - Only `teacher`, `admin`, `superadmin` can create or edit a course. Confirm the caller's role before attempting the write (the service should already enforce this; if it does not, surface it).

## Checklist

- [ ] `types/lms.ts` supports every field used.
- [ ] Course written via `createCourse` (not a direct Firestore call).
- [ ] `LMSContext` refreshes after the write.
- [ ] Course visible in `/training/catalog`.
- [ ] Lessons render in `LessonModal`.
- [ ] Enrolling writes to `lms_progress`.
- [ ] Role enforcement verified.

## Rules

- If adding a new `LessonType`, update the union in `types/lms.ts` first, then add the render branch in `LessonModal.tsx` — never add UI for a type the model doesn't know about.
- Do not cross-write: progress → `lms_progress`, notes → `lms_notes`, learning context → `lms_context`.
- Delegate complex AI course generation to the `lms-curator` sub-agent.
