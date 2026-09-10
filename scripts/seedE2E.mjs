#!/usr/bin/env node

import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';

const PROJECT_ID = 'demo-arky-e2e';
const EMAIL = 'architect@arky.e2e';
const PASSWORD = 'Arky-E2E-Only-2026!';
const AUTH_URL = 'http://127.0.0.1:9099';

async function authRequest(operation, body) {
  const response = await fetch(`${AUTH_URL}/identitytoolkit.googleapis.com/v1/accounts:${operation}?key=fake-api-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  return { response, payload };
}

async function ensureAuthUser() {
  const created = await authRequest('signUp', {
    email: EMAIL,
    password: PASSWORD,
    returnSecureToken: true,
  });
  if (created.response.ok && typeof created.payload.localId === 'string') {
    return created.payload.localId;
  }

  if (created.payload?.error?.message !== 'EMAIL_EXISTS') {
    throw new Error(`Unable to seed Auth emulator: ${created.payload?.error?.message ?? created.response.status}`);
  }

  const signedIn = await authRequest('signInWithPassword', {
    email: EMAIL,
    password: PASSWORD,
    returnSecureToken: true,
  });
  if (!signedIn.response.ok || typeof signedIn.payload.localId !== 'string') {
    throw new Error(`Unable to reuse Auth emulator user: ${signedIn.payload?.error?.message ?? signedIn.response.status}`);
  }
  return signedIn.payload.localId;
}

async function seedFirestore(uid) {
  const testEnvironment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { host: '127.0.0.1', port: 8080 },
  });
  const now = '2026-09-03T12:00:00.000Z';

  try {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      const firestore = context.firestore();
      await setDoc(doc(firestore, 'users', uid), {
        uid,
        email: EMAIL,
        displayName: 'Arquitecto E2E',
        role: 'superadmin',
      });
      await setDoc(doc(firestore, 'businessInitiatives', 'e2e-initiative'), {
        id: 'e2e-initiative',
        schemaVersion: 1,
        code: 'NEG-2026-001',
        title: 'Modernización E2E',
        need: 'Verificar de extremo a extremo los journeys críticos de Arky.',
        driver: 'Puerta de calidad autenticada',
        objectives: ['Validar identidad, persistencia y gobierno'],
        expectedOutcomes: [],
        affectedCapabilities: [],
        businessUnits: [],
        status: 'approved',
        priority: 'high',
        horizon: 'now',
        riskLevel: 'medium',
        risks: [],
        regulatoryDrivers: [],
        kpis: [],
        milestones: [],
        stakeholders: [],
        documents: [],
        dependsOnCodes: [],
        notes: [],
        provenance: 'manual',
        userId: uid,
        createdAt: now,
        updatedAt: now,
      });
      await setDoc(doc(firestore, 'projects', 'e2e-project'), {
        id: 'e2e-project',
        name: 'Proyecto E2E gobernado',
        description: 'Fixture aislado para validar los journeys autenticados.',
        projectContext: ['Ejecución contra emuladores locales, sin datos productivos.'],
        initiativeIds: ['e2e-initiative'],
        linkedBusinessProjects: ['NEG-2026-001'],
        artifacts: [],
        artifactCount: 0,
        artifactStorage: 'subcollection-v1',
        aggregateStorage: 'split-v1',
        userId: uid,
        createdAt: now,
        updatedAt: now,
      });
      // El ARB se siembra como estado de dominio completo, no como un mock de
      // UI. Así el journey usa las mismas reglas, repositorio y subcolección
      // inmutable que una aprobación real.
      await setDoc(doc(firestore, 'projects', 'e2e-project', 'engagements', 'e2e-engagement-arb'), {
        id: 'e2e-engagement-arb',
        projectId: 'e2e-project',
        schemaVersion: 1,
        title: 'Decisión ARB E2E',
        brief: 'Fixture determinista para validar la decisión del comité de arquitectura.',
        initiativeIds: ['e2e-initiative'],
        businessProjectIds: ['NEG-2026-001'],
        status: 'awaiting-arb',
        priority: 'high',
        charter: {
          kind: 'modernization',
          objectives: ['Validar el registro de una decisión ARB.'],
          scope: ['Aprobación del encargo de prueba.'],
          outOfScope: [],
          constraints: [],
          regulatoryDrivers: [],
          deliverables: [],
          participantIds: [],
          coordinatorId: 'lucia',
          consolidatorId: 'alejandro',
          provenance: 'deterministic',
          proposedAt: now,
          approvedAt: now,
          approvedBy: { id: uid, name: 'Arquitecto E2E', role: 'superadmin' },
        },
        tasks: [],
        gateAssessment: {
          overallStatus: 'conditional',
          evaluatedAt: now,
          gates: [{
            id: 'security-review',
            status: 'conditional',
            evidenceArtifactIds: [],
            blockers: [],
            conditions: ['Completar evidencia de seguridad antes del siguiente ciclo.'],
          }],
        },
        arbDecisions: [],
        budget: { maxAiCalls: 12, consumedAiCalls: 0 },
        auditTrail: [],
        createdBy: { id: uid, name: 'Arquitecto E2E', role: 'superadmin' },
        createdAt: now,
        updatedAt: now,
      });
    });
  } finally {
    await testEnvironment.cleanup();
  }
}

const uid = await ensureAuthUser();
await seedFirestore(uid);
console.info('[e2e:seed] isolated authenticated fixture ready');
