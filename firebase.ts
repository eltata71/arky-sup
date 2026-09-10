import { initializeApp, getApps, getApp, FirebaseApp } from "firebase/app";
import { connectFirestoreEmulator, getFirestore, Firestore } from "firebase/firestore";
import { connectAuthEmulator, getAuth, Auth } from "firebase/auth";
import { shouldUseFirebaseEmulators } from "./lib/firebaseEmulatorPolicy";

// Configuration loaded from environment variables (VITE_* prefix required by Vite)
export const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

/**
 * True when Firebase init produced live `db` + `auth` services. When false,
 * downstream consumers must show degraded mode and block critical remote writes
 * instead of pretending localStorage is persistence. This is intentionally loose so a missing
 * `.env.local` (e.g. on a fresh Vercel preview, or in a Safari private
 * window) never crashes the React mount and traps the user on the static
 * "Inicializando aplicación resiliente" shell.
 */
let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;

const hasMinimalConfig = Boolean(
    firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId,
);

if (!hasMinimalConfig) {
    console.warn(
        "[firebase] Skipping Firebase init: missing VITE_FIREBASE_* env vars. " +
        "The app will run in explicit degraded mode without remote persistence. Set the env vars " +
        "in .env.local (or in Vercel project settings) to enable Firestore/Auth.",
    );
} else {
    try {
        if (getApps().length === 0) {
            app = initializeApp(firebaseConfig);
            console.log("Firebase App initialized successfully.");
        } else {
            app = getApp();
            console.log("Using existing Firebase App instance.");
        }

        db = getFirestore(app);
        console.log("Firestore Service initialized.");

        auth = getAuth(app);
        console.log("Auth Service initialized.");

        const hostname = typeof window === 'undefined' ? 'localhost' : window.location.hostname;
        if (shouldUseFirebaseEmulators(import.meta.env, hostname)) {
            connectFirestoreEmulator(db, '127.0.0.1', 8080);
            connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
            console.info('[firebase] Connected to isolated Auth and Firestore emulators.');
        }

    } catch (error) {
        // Hard guarantee: never throw out of this module. A throw here would
        // kill `import './firebase'` at module-evaluation time, which kills
        // `index.tsx`, which leaves the static "Inicializando..." shell in
        // `index.html` visible forever. Logging plus the `isFirebaseAvailable`
        // flag is enough; the rest of the app already handles transient
        // Firestore failures by falling back to localStorage.
        console.error(
            "[firebase] Initialisation failed. The app will run in degraded mode.",
            error,
        );
    }
}

/**
 * True only when all three services came up. Derived rather than assigned:
 * a mutable exported flag can disagree with the handles it is supposed to
 * describe, and every consumer here uses it to decide whether `db`/`auth`
 * can be touched at all.
 */
export const isFirebaseAvailable = Boolean(app && db && auth);

// `db`/`auth` may be `null` in degraded mode. Existing typed consumers were
// asserting non-null implicitly, so we keep the public type as the live
// service for compatibility. Critical write paths must call
// `assertFirebaseAvailable()` from services/persistence before reporting success.
export { db as db, auth as auth };
export type { Firestore, Auth };
