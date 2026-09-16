import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildInventory,
  classifySourceText,
  renderMarkdown,
} from './storageInventory.mjs';

test('distingue la configuración de Firebase Storage de una implementación del SDK', () => {
  const configured = classifySourceText('const config = { storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET };');
  assert.equal(configured.some((item) => item.id === 'firebase-storage-sdk'), false);
  assert.equal(configured.some((item) => item.id === 'firebase-bucket-configured'), true);

  const implemented = classifySourceText("import { getStorage, uploadBytes } from 'firebase/storage';");
  assert.equal(implemented.some((item) => item.id === 'firebase-storage-sdk'), true);
});

test('detecta contratos de URL, contenido incrustado y blobs transitorios', () => {
  const findings = classifySourceText(`
    interface InitiativeDocument { url?: string; content?: string }
    const blob = new Blob([content]);
    const href = URL.createObjectURL(blob);
    const diagram = artifact.content;
  `);
  assert.equal(findings.some((item) => item.id === 'persistent-url'), true);
  assert.equal(findings.some((item) => item.id === 'inline-content'), true);
  assert.equal(findings.some((item) => item.id === 'browser-transient-blob'), true);
  assert.equal(findings.some((item) => item.id === 'embedded-artifact-content'), true);
});

test('no confunde métodos genéricos con Supabase Storage', () => {
  const findings = classifySourceText('const result = document.download(); result.remove();');
  assert.equal(findings.some((item) => item.id === 'supabase-storage-sdk'), false);
});

test('construye un inventario sin incluir el contenido fuente', async () => {
  const inventory = await buildInventory({
    root: new URL('../../', import.meta.url),
    files: [
      'firebase.ts',
      'services/ports/ports.ts',
      'services/businessInitiatives/BusinessInitiativeTypes.ts',
    ],
  });

  assert.equal(inventory.schemaVersion, 1);
  assert.equal(inventory.sourceFiles.length, 3);
  assert.equal(Object.prototype.hasOwnProperty.call(inventory, 'sourceContents'), false);
  assert.ok(inventory.categories.some((category) => category.id === 'firebase-bucket-configured'));
  assert.ok(inventory.categories.some((category) => category.id === 'persistent-url'));
});

test('excluye el generador del inventario completo', async () => {
  const inventory = await buildInventory({ root: new URL('../../', import.meta.url) });
  assert.equal(inventory.sourceFiles.includes('scripts/storage/storageInventory.mjs'), false);
  const portCategory = inventory.categories.find((category) => category.id === 'file-storage-port');
  assert.ok(portCategory);
  assert.equal(portCategory.evidence.some((item) => item.file === 'scripts/storage/storageInventory.mjs'), false);
});

test('renderiza evidencia legible y marca lo que no está verificado', () => {
  const markdown = renderMarkdown({
    schemaVersion: 1,
    generatedAt: '2026-09-15T00:00:00.000Z',
    sourceFiles: ['firebase.ts'],
    categories: [
      {
        id: 'firebase-bucket-configured',
        label: 'Bucket Firebase configurado',
        status: 'observed',
        fileCount: 1,
        matchCount: 1,
        evidence: [{ file: 'firebase.ts', line: 1 }],
      },
    ],
  });
  assert.match(markdown, /Bucket Firebase configurado/);
  assert.match(markdown, /observed/);
  assert.doesNotMatch(markdown, /storageBucket.*=.*[A-Za-z0-9_-]{20,}/);
});
