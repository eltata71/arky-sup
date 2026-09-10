import {
    collection,
    doc,
    getDocs,
    getDoc,
    setDoc,
    updateDoc,
    deleteDoc,
    query,
    limit,
} from "firebase/firestore";
import { db } from "../../firebase";
import type { AuthRole } from "../../lib/authz";
import { PersistenceError, executeRemoteWrite, isWriteConfirmed, requireDb } from "../persistence";

export interface UserProfile {
    uid: string;
    email: string | null;
    displayName: string | null;
    role: AuthRole;
}

const USERS_COLLECTION = "users";

class UserService {
    async getUserProfile(uid: string): Promise<UserProfile | null> {
        const docRef = doc(requireDb(db), USERS_COLLECTION, uid);
        const docSnap = await getDoc(docRef);
        return docSnap.exists() ? docSnap.data() as UserProfile : null;
    }

    async createUserProfile(profile: UserProfile): Promise<void> {
        const result = await executeRemoteWrite({ operationName: 'createUserProfile', userId: profile.uid }, async () => {
            await setDoc(doc(requireDb(db), USERS_COLLECTION, profile.uid), profile);
        });
        if (!isWriteConfirmed(result)) throw new PersistenceError(result);
    }

    async updateUserRole(uid: string, role: UserProfile['role']): Promise<void> {
        const result = await executeRemoteWrite({ operationName: 'updateUserRole', userId: uid }, async () => {
            await updateDoc(doc(requireDb(db), USERS_COLLECTION, uid), { role });
        });
        if (!isWriteConfirmed(result)) throw new PersistenceError(result);
    }

    async deleteUser(uid: string): Promise<void> {
        const result = await executeRemoteWrite({ operationName: 'deleteUser', userId: uid }, async () => {
            await deleteDoc(doc(requireDb(db), USERS_COLLECTION, uid));
        });
        if (!isWriteConfirmed(result)) throw new PersistenceError(result);
    }

    async getAllUsers(): Promise<UserProfile[]> {
        const querySnapshot = await getDocs(collection(requireDb(db), USERS_COLLECTION));
        return querySnapshot.docs.map(userDoc => userDoc.data() as UserProfile);
    }

    /**
     * Update the signed-in user's own display name.
     *
     * Deliberately narrower than `createUserProfile`: it writes one field, so
     * it cannot become a way to edit a role through a shared code path. The
     * rules refuse a self-write that touches `role` regardless, but a method
     * that cannot express the write is easier to reason about than one that
     * can and is forbidden.
     */
    async updateOwnDisplayName(uid: string, displayName: string): Promise<void> {
        const result = await executeRemoteWrite({ operationName: 'updateOwnDisplayName', userId: uid }, async () => {
            await updateDoc(doc(requireDb(db), USERS_COLLECTION, uid), { displayName });
        });
        if (!isWriteConfirmed(result)) throw new PersistenceError(result);
    }

    /**
     * True when the users collection is empty.
     *
     * Kept for the seeding path only. It no longer grants anything: the
     * "first user becomes superadmin" bootstrap was removed, because an
     * account nobody granted is exactly what this model forbids.
     */
    async isFirstUser(): Promise<boolean> {
        const usersRef = collection(requireDb(db), USERS_COLLECTION);
        const q = query(usersRef, limit(1));
        const snapshot = await getDocs(q);
        return snapshot.empty;
    }
}

export const userService = new UserService();
