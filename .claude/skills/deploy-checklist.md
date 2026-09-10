# Deploy Checklist

Pre-deployment checklist for the Arky 10 React/TypeScript/Firebase/Vite SaaS application (Vercel deployment).

## Run automatically:

```
!npm run build 2>&1 | tail -20
!npm run lint 2>&1 | tail -20
!git status --short
!git log --oneline -5
```

## Checklist

### Code Quality
- [ ] `npm run lint` (TypeScript compile) passes with zero errors
- [ ] `npm run build` produces a clean `dist/` with no warnings
- [ ] No `console.log` / `debugger` left in production paths
- [ ] No hardcoded API keys or secrets in source files

### Environment Variables (Vercel)
Confirm all `VITE_*` variables are set in Vercel Dashboard → Settings → Environment Variables:
- [ ] `VITE_GEMINI_API_KEY`
- [ ] `VITE_FIREBASE_API_KEY`
- [ ] `VITE_FIREBASE_AUTH_DOMAIN`
- [ ] `VITE_FIREBASE_PROJECT_ID`
- [ ] `VITE_FIREBASE_STORAGE_BUCKET`
- [ ] `VITE_FIREBASE_MESSAGING_SENDER_ID`
- [ ] `VITE_FIREBASE_APP_ID`
- [ ] `VITE_FIREBASE_MEASUREMENT_ID`

### Firebase
- [ ] Vercel production domain added to Firebase Console → Authentication → Authorized Domains
- [ ] Firestore security rules reviewed (no open `allow read, write: if true;`)
- [ ] Firebase indexes up to date for any new queries

### Git
- [ ] Working on the correct branch (not main/master with unreviewed changes)
- [ ] All intended changes committed and pushed
- [ ] No merge conflicts

### Smoke Test Plan (post-deploy)
- [ ] Login flow works (email/password + Google OAuth)
- [ ] New project creation runs through GuidedCreationModal
- [ ] Gemini AI generation works for at least one artifact type
- [ ] LMS Training Center loads and displays courses
- [ ] Settings page saves theme/language changes

Report which items need attention before proceeding.
