/**
 * Adaptadores en memoria de los puertos: fakes para pruebas, nada más.
 *
 * No son persistencia ni caché: pierden todo al recargar y ningún código de
 * producción los importa. Su único consumidor son los tests de dominio, que
 * así verifican casos de uso sin Firebase, sin Supabase y sin DOM.
 */
import type { ClockPort, FileStoragePort, RepositoryPort, StoredFile } from './ports';

/** Reloj fijo: avanza solo cuando el test lo dice. */
export class ManualClock implements ClockPort {
  private currentMs: number;

  constructor(startIso = '2026-09-12T00:00:00.000Z') {
    this.currentMs = Date.parse(startIso);
  }

  nowIso(): string {
    return new Date(this.currentMs).toISOString();
  }

  nowMs(): number {
    return this.currentMs;
  }

  advance(ms: number): void {
    this.currentMs += ms;
  }
}

/** Archivos en un mapa: bucket/path → bytes. */
export class MemoryFileStorage implements FileStoragePort {
  private readonly objects = new Map<string, StoredFile>();

  private key(bucket: string, path: string): string {
    return `${bucket}/${path}`;
  }

  async upload(bucket: string, path: string, bytes: Uint8Array, mimeType: string): Promise<StoredFile> {
    const stored: StoredFile = { bucket, path, bytes: bytes.slice(), mimeType };
    this.objects.set(this.key(bucket, path), stored);
    return stored;
  }

  async download(bucket: string, path: string): Promise<Uint8Array> {
    const found = this.objects.get(this.key(bucket, path));
    if (!found) throw new Error(`Objeto no encontrado: ${bucket}/${path}.`);
    return found.bytes.slice();
  }

  async remove(bucket: string, path: string): Promise<void> {
    this.objects.delete(this.key(bucket, path));
  }

  size(): number {
    return this.objects.size;
  }
}

/** Entidades en un mapa por id. Upsert: repetir `write` no duplica. */
export class MemoryRepository<T extends { id: ID }, ID extends string = string>
  implements RepositoryPort<T, ID>
{
  private readonly entities = new Map<ID, T>();

  async read(id: ID): Promise<T | null> {
    return this.entities.get(id) ?? null;
  }

  async write(entity: T & { id: ID }): Promise<void> {
    this.entities.set(entity.id, entity);
  }

  async remove(id: ID): Promise<void> {
    this.entities.delete(id);
  }

  size(): number {
    return this.entities.size;
  }
}
