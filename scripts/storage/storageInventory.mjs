import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_SOURCE_PATHS = Object.freeze([
  'types.ts',
  'vercel.json',
  'package.json',
  'modules.json',
  'App.tsx',
  'index.tsx',
  'api',
  'context',
  'services',
  'components',
  'hooks',
  'lib',
  'pages',
  'src',
  'utils',
  'supabase',
  'scripts',
]);

const TEXT_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.ts', '.tsx', '.json', '.sql', '.md']);
const execFileAsync = promisify(execFile);

const INVENTORY_IMPLEMENTATION_PATH = 'scripts/storage/storageInventory.mjs';
const isTestOrGeneratedEvidence = (path) => /(^|\/)(__tests__|evidencias)(\/|$)|(?:\.test|\.spec)\.[^.]+$/i.test(path);
const isInventoryImplementation = (path) => path === INVENTORY_IMPLEMENTATION_PATH;

const CATEGORY_DEFINITIONS = Object.freeze([
  {
    // Se conserva **después** de retirar Firebase, y a propósito: es la sonda
    // que detectaría una reintroducción. Un inventario que sólo busca lo que
    // ya sabe que hay no encuentra nunca lo que no debería estar.
    id: 'firebase-storage-residual',
    label: 'Residuo de Firebase Storage',
    statusWhenMatched: 'observed',
    pattern: /(?:from\s+['"]firebase\/storage['"]|\bstorageBucket\s*:|\b(?:getStorage|uploadBytes|uploadString|uploadBytesResumable|getDownloadURL|deleteObject)\s*\()/g,
  },
  {
    id: 'supabase-storage-sdk',
    label: 'Supabase Storage usado por el SDK',
    statusWhenMatched: 'observed',
    pattern: /(?:\.storage\.from\s*\(|\bcreateSignedUrl\s*\(|\bcreateSignedUrls\s*\()/g,
  },
  {
    id: 'supabase-storage-schema',
    label: 'Esquema/políticas de Supabase Storage',
    statusWhenMatched: 'observed',
    pattern: /(?:storage\.objects|storage\.buckets|on\s+storage\.objects)/g,
  },
  {
    id: 'persistent-url',
    label: 'URL persistida en un documento de dominio',
    statusWhenMatched: 'observed',
    pattern: /\b(?:url|sourceUrl|documentUrl)\??\s*:\s*string/g,
  },
  {
    id: 'inline-content',
    label: 'Contenido de documento persistido inline',
    statusWhenMatched: 'observed',
    pattern: /\bcontent\??\s*:\s*string/g,
  },
  {
    id: 'embedded-artifact-content',
    label: 'Incrustación dentro de contenido de artefacto',
    statusWhenMatched: 'observed',
    pattern: /(?:artifact\.content|```(?:json|mermaid)|embeddedMermaid)/g,
  },
  {
    id: 'browser-transient-blob',
    label: 'Blob/URL generado solo para descarga del navegador',
    statusWhenMatched: 'observed',
    pattern: /(?:new\s+Blob\s*\(|URL\.createObjectURL\s*\()/g,
  },
  {
    id: 'external-document-provider',
    label: 'Proveedor externo de documentos mencionado',
    statusWhenMatched: 'observed',
    pattern: /(?:SharePoint|Google\s+Drive|\bDrive\b|Confluence|Lucidchart|lucid\.app)/gi,
  },
  {
    id: 'file-storage-port',
    label: 'Puerto abstracto de almacenamiento de archivos',
    statusWhenMatched: 'observed',
    pattern: /(?:\bFileStoragePort\b|\bMemoryFileStorage\b)/g,
  },
]);

const toPath = (value) => (value instanceof URL ? fileURLToPath(value) : resolve(value));

const isTextFile = (path) => TEXT_EXTENSIONS.has(extname(path).toLowerCase());

const listSourceFiles = async (root, sourcePaths) => {
  const { stdout } = await execFileAsync('git', ['-C', root, 'ls-files', '-z', '--', ...sourcePaths], { maxBuffer: 10 * 1024 * 1024 });
  return stdout
    .split('\0')
    .filter(Boolean)
    .filter((path) => isTextFile(path) && !isTestOrGeneratedEvidence(path) && !isInventoryImplementation(path))
    .map((path) => join(root, path))
    .sort();
};

const countMatches = (text, pattern) => {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const matcher = new RegExp(pattern.source, flags);
  const matches = [];
  let match;
  while ((match = matcher.exec(text)) !== null) {
    matches.push({ index: match.index, value: match[0] });
    if (match[0] === '') matcher.lastIndex += 1;
  }
  return matches;
};

const lineAt = (text, index) => text.slice(0, index).split('\n').length;

/** Classify one source text without returning the source itself. */
export const classifySourceText = (text) => CATEGORY_DEFINITIONS
  .flatMap((definition) => countMatches(text, definition.pattern).map(() => ({
    id: definition.id,
    label: definition.label,
    status: definition.statusWhenMatched,
  })));

const emptyCategory = (definition) => ({
  id: definition.id,
  label: definition.label,
  status: 'not-observed',
  fileCount: 0,
  matchCount: 0,
  evidence: [],
});

/**
 * Build a PII-safe, source-only inventory. It does not read Firestore,
 * Supabase Storage, environment files, or browser data.
 */
export const buildInventory = async ({
  root = process.cwd(),
  files = DEFAULT_SOURCE_PATHS,
} = {}) => {
  const absoluteRoot = toPath(root);
  const absoluteFiles = await listSourceFiles(absoluteRoot, files);
  const categories = new Map(CATEGORY_DEFINITIONS.map((definition) => [definition.id, emptyCategory(definition)]));

  for (const absoluteFile of absoluteFiles) {
    const text = await readFile(absoluteFile, 'utf8');
    const relativeFile = relative(absoluteRoot, absoluteFile).replaceAll('\\', '/');
    for (const definition of CATEGORY_DEFINITIONS) {
      const matches = countMatches(text, definition.pattern);
      if (matches.length === 0) continue;
      const category = categories.get(definition.id);
      category.status = definition.statusWhenMatched;
      category.fileCount += 1;
      category.matchCount += matches.length;
      for (const match of matches.slice(0, 25 - category.evidence.length)) {
        category.evidence.push({ file: relativeFile, line: lineAt(text, match.index) });
      }
    }
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceFiles: absoluteFiles.map((path) => relative(absoluteRoot, path).replaceAll('\\', '/')),
    categories: [...categories.values()],
  };
};

const statusLabel = (status) => status === 'observed' ? 'observed' : 'not-observed';

export const renderMarkdown = (inventory) => {
  const rows = inventory.categories.map((category) => {
    const evidence = category.evidence.length === 0
      ? '—'
      : category.evidence.slice(0, 5).map((item) => `\`${item.file}:${item.line}\``).join(', ');
    return `| ${category.id} | ${category.label} | ${statusLabel(category.status)} | ${category.fileCount} | ${category.matchCount} | ${evidence} |`;
  }).join('\n');

  return `# Inventario de almacenamiento y documentos — evidencia de código\n\n` +
    `**Generado:** ${inventory.generatedAt}\n` +
    `**Alcance:** ${inventory.sourceFiles.length} archivos de código/configuración versionados; no incluye contenido de usuarios, secretos ni variables de entorno.\n\n` +
    `## Resultado\n\n` +
    `Este informe es un inventario estático y PII-safe. «not-observed» significa que no se encontró el patrón en las fuentes escaneadas; no prueba que un proveedor remoto esté vacío. La consulta de Supabase Storage se documenta por separado con su salida CLI. Firebase se retiró en F9: su categoría se conserva como sonda de regresión, y «not-observed» ahí es el resultado esperado.\n\n` +
    `| Categoría | Descripción | Estado | Archivos | Coincidencias | Evidencia |\n` +
    `|---|---|---:|---:|---:|---|\n` +
    rows + '\n\n' +
    `## Lectura de los hallazgos\n\n` +
    `- Las URLs y el contenido inline son contratos de documentos de iniciativa/artefactos; no son blobs gestionados por Storage.\n` +
    '- Los objetos `Blob` y `URL.createObjectURL` son descargas temporales del navegador; no constituyen persistencia.\n' +
    '- La existencia de `FileStoragePort` define una frontera preparada para F6, pero no demuestra que haya un adaptador de proveedor en producción.\n' +
    `- No se incluyen cuerpos, URLs concretas, identificadores de usuario, correos, claves ni valores de entorno.\n`;
};

const parseArgs = (argv) => {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) continue;
    args.set(value.slice(2), argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[++index] : true);
  }
  return args;
};

const runCli = async () => {
  const args = parseArgs(process.argv.slice(2));
  const root = resolve(String(args.get('root') ?? process.cwd()));
  const outputDir = resolve(String(args.get('output-dir') ?? join(root, 'docs/fase-6/evidencias')));
  const inventory = await buildInventory({ root });
  await mkdir(outputDir, { recursive: true });
  const jsonPath = join(outputDir, 'inventario-storage.json');
  const markdownPath = join(outputDir, 'inventario-storage.md');
  await writeFile(jsonPath, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');
  await writeFile(markdownPath, renderMarkdown(inventory), 'utf8');
  console.log(JSON.stringify({ jsonPath, markdownPath, sourceFiles: inventory.sourceFiles.length }, null, 2));
};

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) await runCli();

export { DEFAULT_SOURCE_PATHS };
