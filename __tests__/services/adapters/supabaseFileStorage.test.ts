/**
 * La coreografía de Storage, y las dos cosas que no puede dejar atrás.
 *
 * Las políticas de los cubos exigen que la ruta *demuestre* de quién es el
 * objeto: `{uid}/{contexto}/{agregado}/{entidad}/v{versión}/{objectId}.{ext}`.
 * El último segmento es el id que **Storage asigna al crear la fila**, así que
 * no se puede conocer antes de subir — de ahí los tres pasos: subir con un
 * nombre provisional, mover al definitivo (que conserva la fila y su id), y
 * registrar.
 *
 * Lo que estas pruebas protegen es lo que pasa cuando el tercero falla: un
 * binario cuyo registro no llegó a `ready` es **ilegible por política**, así que
 * dejarlo sería pagar por un objeto que nadie puede volver a encontrar.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createSupabaseFileStorage,
  extensionFor,
  folderFor,
  type SupabaseStorageClientLike,
} from '../../../services/adapters';

/** El sobre que devuelve cualquiera de estas llamadas. */
type Envelope<T> = { data: T | null; error: unknown };
const ok = <T>(data: T): Envelope<T> => ({ data, error: null });
const ko = (error: unknown): Envelope<never> => ({ data: null, error });

const bucketApi = (overrides: Record<string, unknown> = {}) => ({
  upload: vi.fn(async (): Promise<Envelope<{ id?: string; path?: string }>> => ok({ id: 'object-uuid', path: 'staging' })),
  move: vi.fn(async (): Promise<Envelope<unknown>> => ok({})),
  download: vi.fn(async (): Promise<Envelope<Blob>> => ok(new Blob([new Uint8Array([1, 2, 3])]))),
  remove: vi.fn(async (): Promise<Envelope<unknown>> => ok({})),
  createSignedUrl: vi.fn(async (): Promise<Envelope<{ signedUrl?: string }>> => ok({ signedUrl: 'https://signed' })),
  ...overrides,
});

type Rpc = (name: string, args?: Record<string, unknown>) => Promise<Envelope<unknown>>;

const clientWith = (
  api: ReturnType<typeof bucketApi>,
  rpc: Rpc = async () => ok({ id: 'file-row' }),
): SupabaseStorageClientLike => ({
  storage: { from: vi.fn(() => api) },
  rpc,
} as unknown as SupabaseStorageClientLike);

const bytes = new Uint8Array([1, 2, 3, 4]);
const descriptor = { context: 'initiative' as const, aggregateId: 'init-1', entityId: 'doc-1', version: 1 };

describe('folderFor y extensionFor', () => {
  it('build the path the policy checks, in order', () => {
    expect(folderFor('uid-1', descriptor)).toBe('uid-1/initiative/init-1/doc-1/v1');
  });

  it('maps a known mime type and falls back to bin for anything else', () => {
    expect(extensionFor('application/pdf')).toBe('pdf');
    expect(extensionFor('IMAGE/PNG')).toBe('png');
    expect(extensionFor('application/x-unknown')).toBe('bin');
  });
});

describe('put', () => {
  it('uploads, renames to the id Storage assigned and registers it as ready', async () => {
    const api = bucketApi();
    const rpc = vi.fn<Rpc>(async () => ok({ id: 'file-row' }));
    const storage = createSupabaseFileStorage(clientWith(api, rpc));

    const result = await storage.put('uid-1', descriptor, bytes, 'application/pdf');

    expect(result.path).toBe('uid-1/initiative/init-1/doc-1/v1/object-uuid.pdf');
    expect(result.objectId).toBe('object-uuid');
    // SHA-256 en hexadecimal: el servidor lo revalida, y es lo que permite
    // comprobar que lo que se descarga es lo que se subió.
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);

    const [from, to] = api.move.mock.calls[0] as unknown as [string, string];
    expect(from).toContain('uid-1/initiative/init-1/doc-1/v1/upload-');
    expect(to).toBe(result.path);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(['register_file_object']);
  });

  it('removes the staged object when Storage returns no id', async () => {
    // Sin id no hay forma de nombrar el objeto como la política exige; dejarlo
    // en la ruta provisional sería un binario que nadie puede leer ni encontrar.
    const api = bucketApi({ upload: vi.fn(async (): Promise<Envelope<{ id?: string; path?: string }>> => ok({ path: 'staging' })) });
    const storage = createSupabaseFileStorage(clientWith(api));

    await expect(storage.put('uid-1', descriptor, bytes, 'application/pdf')).rejects.toThrow(/identificador/);
    expect(api.remove).toHaveBeenCalled();
  });

  it('removes the object when the registration is refused', async () => {
    const api = bucketApi();
    const rpc = vi.fn<Rpc>(async () => ko({ code: '42501', message: 'denied' }));
    const storage = createSupabaseFileStorage(clientWith(api, rpc));

    await expect(storage.put('uid-1', descriptor, bytes, 'application/pdf')).rejects.toMatchObject({ code: '42501' });
    expect(api.remove).toHaveBeenCalledWith([`uid-1/initiative/init-1/doc-1/v1/object-uuid.pdf`]);
  });

  it('removes the staged object when the rename fails', async () => {
    const api = bucketApi({ move: vi.fn(async (): Promise<Envelope<unknown>> => ko({ message: 'conflict' })) });
    const storage = createSupabaseFileStorage(clientWith(api));

    await expect(storage.put('uid-1', descriptor, bytes, 'application/pdf')).rejects.toMatchObject({ message: 'conflict' });
    expect(api.remove).toHaveBeenCalled();
  });
});

describe('signedUrl', () => {
  it('asks for a short-lived URL rather than returning a stored one', async () => {
    const api = bucketApi();
    const storage = createSupabaseFileStorage(clientWith(api));

    expect(await storage.signedUrl('initiative-documents', 'a/b')).toBe('https://signed');
    expect(api.createSignedUrl).toHaveBeenCalledWith('a/b', 300);
  });

  it('fails loudly when Storage returns no URL', async () => {
    const api = bucketApi({ createSignedUrl: vi.fn(async (): Promise<Envelope<{ signedUrl?: string }>> => ok({})) });
    const storage = createSupabaseFileStorage(clientWith(api));
    await expect(storage.signedUrl('initiative-documents', 'a/b')).rejects.toThrow(/URL firmada/);
  });
});

describe('download', () => {
  it('returns the bytes, not the Blob', async () => {
    const storage = createSupabaseFileStorage(clientWith(bucketApi()));
    expect(await storage.download('initiative-documents', 'a/b')).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('propagates the failure instead of returning an empty file', async () => {
    const api = bucketApi({ download: vi.fn(async (): Promise<Envelope<Blob>> => ko({ message: 'not found' })) });
    const storage = createSupabaseFileStorage(clientWith(api));
    await expect(storage.download('initiative-documents', 'a/b')).rejects.toMatchObject({ message: 'not found' });
  });
});
