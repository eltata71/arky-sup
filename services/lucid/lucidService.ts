/**
 * Lucidchart REST integration.
 *
 * Architecture:
 *  - Browser calls Lucid's public REST API directly using a bearer access
 *    token.  The token can come from three sources (precedence order):
 *      1. A user-scoped token stored in localStorage under `user_lucid_token`.
 *      2. A global token injected at build time via `VITE_LUCID_API_KEY`.
 *      3. A runtime-provided token passed by the caller.
 *  - When no token is configured we degrade gracefully to the "Copy Mermaid"
 *    flow already in place: the UI keeps working, only the authenticated
 *    features (create document, embed, share) are hidden.
 *  - All endpoints hit `https://api.lucid.co` which is documented to allow
 *    CORS for user-agent OAuth/API-key auth.
 *
 * References:
 *   https://developer.lucid.co/rest-api/v1/  (document, embed, export, share)
 *
 * This file deliberately avoids pulling in heavy SDKs — a tiny fetch wrapper
 * keeps the surface small and testable.
 */

const LUCID_BASE_URL = 'https://api.lucid.co';
const LUCID_VERSION = '1';
const LUCID_EDIT_BASE = 'https://lucid.app/lucidchart/';
const LUCID_DEEPLINK_IMPORT = 'https://lucid.app/lucidchart/new?source=arkypro';

export interface LucidCreateOptions {
    title: string;
    mermaid: string;
    /** Optional folder id inside Lucid (workspace default when absent). */
    folderId?: string;
    /** Product flag, Lucid routes differently for lucidchart vs lucidspark. */
    product?: 'lucidchart' | 'lucidspark';
}

export interface LucidDocumentSummary {
    documentId: string;
    editUrl: string;
    viewUrl?: string;
}

export interface LucidEmbedSession {
    documentId: string;
    embedId: string;
    embedUrl: string;
    sessionToken: string;
    expiresAt: number;
}

export interface LucidShareLink {
    url: string;
    role: 'viewer' | 'editor';
    expiresAt?: number;
}

export interface LucidConfig {
    token: string | null;
    hasToken: boolean;
    source: 'user' | 'global' | 'none';
}

function readTokenFromLocalStorage(): string | null {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem('user_lucid_token');
    return raw && raw.trim().length > 0 ? raw.trim() : null;
}

function readGlobalToken(): string | null {
    const key = (import.meta.env.VITE_LUCID_API_KEY ?? '').trim();
    return key.length > 0 ? key : null;
}

/** Resolve the active Lucid token without side effects. */
export function getLucidConfig(): LucidConfig {
    const user = readTokenFromLocalStorage();
    if (user) return { token: user, hasToken: true, source: 'user' };
    const global = readGlobalToken();
    if (global) return { token: global, hasToken: true, source: 'global' };
    return { token: null, hasToken: false, source: 'none' };
}

export function setUserLucidToken(token: string | null): void {
    if (typeof localStorage === 'undefined') return;
    const clean = (token ?? '').trim();
    if (clean.length === 0) {
        localStorage.removeItem('user_lucid_token');
        return;
    }
    localStorage.setItem('user_lucid_token', clean);
}

class LucidApiError extends Error {
    status: number;
    code?: string;

    constructor(message: string, status: number, code?: string) {
        super(message);
        this.name = 'LucidApiError';
        this.status = status;
        this.code = code;
    }
}

async function lucidFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
    const cfg = getLucidConfig();
    if (!cfg.token) {
        throw new LucidApiError('Missing Lucid API token', 401, 'no_token');
    }

    const headers: Record<string, string> = {
        Authorization: `Bearer ${cfg.token}`,
        'Lucid-Api-Version': LUCID_VERSION,
        Accept: 'application/json',
        ...((init.headers as Record<string, string>) ?? {}),
    };

    const response = await fetch(`${LUCID_BASE_URL}${path}`, { ...init, headers });
    if (!response.ok) {
        let message = `Lucid request failed (${response.status})`;
        let code: string | undefined;
        try {
            const body = await response.json();
            if (body?.message) message = body.message;
            if (body?.code) code = body.code;
        } catch {
            /* ignore JSON parse errors */
        }
        throw new LucidApiError(message, response.status, code);
    }

    if (response.status === 204) return undefined as unknown as T;
    return (await response.json()) as T;
}

/**
 * Import a Mermaid diagram as a Lucid document. Uses Lucid's multipart import
 * endpoint with `application/vnd.lucid.mermaid` content type.
 */
export async function createLucidDocumentFromMermaid(opts: LucidCreateOptions): Promise<LucidDocumentSummary> {
    const body = new FormData();
    const blob = new Blob([opts.mermaid], { type: 'application/vnd.lucid.mermaid' });
    body.append('file', blob, `${opts.title || 'diagram'}.mmd`);
    body.append('title', opts.title || 'Arky 10 Diagram');
    body.append('product', opts.product ?? 'lucidchart');
    if (opts.folderId) body.append('parentFolderId', opts.folderId);

    const result = await lucidFetch<{
        documentId: string;
        editUrl?: string;
        viewUrl?: string;
    }>(`/documents`, {
        method: 'POST',
        body,
    });

    return {
        documentId: result.documentId,
        editUrl: result.editUrl ?? `${LUCID_EDIT_BASE}${result.documentId}/edit`,
        viewUrl: result.viewUrl,
    };
}

/**
 * Creates an embed session token that the LucidchartViewer iframe uses to render
 * the document without re-authenticating the user.
 */
export async function createLucidEmbedSession(documentId: string): Promise<LucidEmbedSession> {
    const result = await lucidFetch<{
        embedId: string;
        embedUrl: string;
        sessionToken: string;
        expiresAt: number;
    }>(`/embeds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            documentId,
            embedAttributes: { canEdit: false, autoFit: true },
        }),
    });

    return { documentId, ...result };
}

/** Creates a shareable link for the document. */
export async function createLucidShareLink(
    documentId: string,
    role: 'viewer' | 'editor' = 'viewer',
): Promise<LucidShareLink> {
    const result = await lucidFetch<{ url: string; role: 'viewer' | 'editor'; expiresAt?: number }>(`/documents/${documentId}/shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
    });
    return result;
}

/** Triggers a PNG export. Returns the blob URL (caller is responsible for revoking). */
export async function exportLucidDocumentAsPNG(documentId: string): Promise<string> {
    const cfg = getLucidConfig();
    if (!cfg.token) throw new LucidApiError('Missing Lucid API token', 401, 'no_token');

    const response = await fetch(`${LUCID_BASE_URL}/documents/${documentId}/export?format=png`, {
        headers: {
            Authorization: `Bearer ${cfg.token}`,
            'Lucid-Api-Version': LUCID_VERSION,
            Accept: 'image/png',
        },
    });
    if (!response.ok) {
        throw new LucidApiError(`Lucid export failed (${response.status})`, response.status);
    }
    const blob = await response.blob();
    return URL.createObjectURL(blob);
}

/** Deep-link fallback when no API token is available. */
export function buildLucidImportDeeplink(): string {
    return LUCID_DEEPLINK_IMPORT;
}

export { LucidApiError };
