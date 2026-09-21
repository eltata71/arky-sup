#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const contractPath = resolve('docs/operacion/despliegue.json');
const metadataPath = resolve(process.env.VERCEL_PROJECT_METADATA_PATH ?? '.vercel/project.json');

let contract;
let metadata;
try {
  contract = JSON.parse(readFileSync(contractPath, 'utf8'));
  metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  console.error(`[deploy-target] ERROR: no se pudo leer el contrato o ${metadataPath}: ${reason}`);
  process.exit(1);
}

const expectedTarget = contract?.vercel;
if (
  typeof expectedTarget?.orgId !== 'string' || expectedTarget.orgId.length === 0
  || typeof expectedTarget?.projectId !== 'string' || expectedTarget.projectId.length === 0
  || typeof expectedTarget?.projectName !== 'string' || expectedTarget.projectName.length === 0
  || typeof expectedTarget?.productionUrl !== 'string' || expectedTarget.productionUrl.length === 0
) {
  console.error('[deploy-target] ERROR: el contrato de producción no tiene una forma válida.');
  process.exit(1);
}

const mismatches = Object.entries({
  orgId: expectedTarget.orgId,
  projectId: expectedTarget.projectId,
  projectName: expectedTarget.projectName,
}).filter(([field, expected]) => metadata[field] !== expected);

if (mismatches.length > 0) {
  console.error('[deploy-target] ERROR: el destino Vercel resuelto no es el contrato de producción.');
  for (const [field, expected] of mismatches) {
    console.error(`[deploy-target] ${field}: esperado ${expected}; recibido ${String(metadata[field])}`);
  }
  console.error('[deploy-target] Revise VERCEL_ORG_ID y VERCEL_PROJECT_ID; no publique hasta corregirlos.');
  process.exit(1);
}

console.log(
  `[deploy-target] OK: ${expectedTarget.projectName} (${expectedTarget.projectId}) → ${expectedTarget.productionUrl}`,
);
