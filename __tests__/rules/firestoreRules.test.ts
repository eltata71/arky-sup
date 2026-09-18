/**
 * The rules, executed.
 *
 * Everything else in `__tests__/authz` reads source files. This suite runs the
 * real rules engine in the Firestore emulator and asks it the questions that
 * matter, because D-4 was precisely a case where reading the code told you
 * nothing: `isAdmin()` looked correct and was permanently false.
 *
 * Skipped automatically when the emulator is not reachable, so the ordinary
 * `npm run test:ci` does not require Java. Run it with:
 *
 *   npx firebase-tools emulators:exec --only firestore --project demo-arky \
 *     "npx vitest run __tests__/rules"
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where } from 'firebase/firestore';
import { readFileSync } from 'node:fs';

const HOST = process.env.FIRESTORE_EMULATOR_HOST;
const describeRules = HOST ? describe : describe.skip;

let env: RulesTestEnvironment;

/** Seed the profile documents the rules read to resolve a caller's role. */
async function seedProfiles(profiles: Array<{ uid: string; role: string }>) {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const profile of profiles) {
      await setDoc(doc(db, 'users', profile.uid), {
        uid: profile.uid,
        email: `${profile.uid}@empresa.com`,
        displayName: profile.uid,
        role: profile.role,
      });
    }
  });
}

const as = (uid: string) => env.authenticatedContext(uid).firestore();

describeRules('firestore.rules', () => {
  beforeAll(async () => {
    const [host, port] = (HOST ?? '127.0.0.1:8080').split(':');
    env = await initializeTestEnvironment({
      projectId: 'demo-arky',
      firestore: {
        rules: readFileSync('firestore.rules', 'utf8'),
        host,
        port: Number(port),
      },
    });
  });

  afterAll(async () => {
    await env?.cleanup();
  });

  beforeEach(async () => {
    await env.clearFirestore();
    await seedProfiles([
      { uid: 'viewer1', role: 'viewer' },
      { uid: 'arch1', role: 'architect' },
      { uid: 'arch2', role: 'architect' },
      { uid: 'rev1', role: 'reviewer' },
      { uid: 'trainer1', role: 'trainer' },
      { uid: 'admin1', role: 'admin' },
      { uid: 'super1', role: 'superadmin' },
      { uid: 'legacy1', role: 'student' },
    ]);
  });

  /* ------------------------------------------------- the D-4 defect itself */

  describe('an administrator is recognised without custom claims', () => {
    it('lets an admin read a project owned by someone else', async () => {
      await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'projects/p1'), { userId: 'arch1', name: 'X' });
      });
      // This is the assertion the old rules failed: `admin1` has no custom
      // claim, and under `request.auth.token.role` it was nobody.
      await assertSucceeds(getDoc(doc(as('admin1'), 'projects/p1')));
    });

    it('lets the review board read work it does not own', async () => {
      await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'projects/p1'), { userId: 'arch1', name: 'X' });
      });
      // A board that cannot read what it governs cannot govern it.
      await assertSucceeds(getDoc(doc(as('rev1'), 'projects/p1')));
    });

    it('does not extend that read to a trainer or a viewer', async () => {
      await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'projects/p1'), { userId: 'arch1', name: 'X' });
      });
      await assertFails(getDoc(doc(as('trainer1'), 'projects/p1')));
      await assertFails(getDoc(doc(as('viewer1'), 'projects/p1')));
    });

    it('still denies a peer who merely happens to be signed in', async () => {
      await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'projects/p1'), { userId: 'arch1', name: 'X' });
      });
      await assertFails(getDoc(doc(as('arch2'), 'projects/p1')));
    });

    it('denies an identity with no profile document at all', async () => {
      await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'projects/p1'), { userId: 'arch1', name: 'X' });
      });
      // A stranger, not a low-privilege user.
      await assertFails(getDoc(doc(as('ghost'), 'projects/p1')));
    });
  });

  /* --------------------------------------------------- nobody self-provisions */

  describe('creating an account', () => {
    it('refuses an identity writing its own profile', async () => {
      await assertFails(
        setDoc(doc(as('ghost'), 'users/ghost'), {
          uid: 'ghost', email: 'g@e.com', displayName: 'G', role: 'architect',
        }),
      );
    });

    it('refuses an identity writing itself in as superadmin', async () => {
      // The escalation the old `allow create: if request.auth.uid == uid` gave away.
      await assertFails(
        setDoc(doc(as('ghost'), 'users/ghost'), {
          uid: 'ghost', email: 'g@e.com', displayName: 'G', role: 'superadmin',
        }),
      );
    });

    it('lets an administrator provision an account', async () => {
      await assertSucceeds(
        setDoc(doc(as('admin1'), 'users/nuevo'), {
          uid: 'nuevo', email: 'n@e.com', displayName: 'N', role: 'architect',
        }),
      );
    });

    it('refuses an administrator minting another administrator', async () => {
      await assertFails(
        setDoc(doc(as('admin1'), 'users/nuevo'), {
          uid: 'nuevo', email: 'n@e.com', displayName: 'N', role: 'admin',
        }),
      );
    });

    it('lets a superadmin grant a privileged role', async () => {
      await assertSucceeds(
        setDoc(doc(as('super1'), 'users/nuevo'), {
          uid: 'nuevo', email: 'n@e.com', displayName: 'N', role: 'admin',
        }),
      );
    });

    it('refuses a role the model does not know', async () => {
      await assertFails(
        setDoc(doc(as('super1'), 'users/nuevo'), {
          uid: 'nuevo', email: 'n@e.com', displayName: 'N', role: 'wizard',
        }),
      );
    });

    it('refuses a document whose uid does not match its id', async () => {
      await assertFails(
        setDoc(doc(as('admin1'), 'users/nuevo'), {
          uid: 'otro', email: 'n@e.com', displayName: 'N', role: 'architect',
        }),
      );
    });
  });

  /* ------------------------------------------------------ nobody self-promotes */

  describe('changing a role', () => {
    it('lets the owner change their display name', async () => {
      await assertSucceeds(updateDoc(doc(as('arch1'), 'users/arch1'), { displayName: 'Ana Torres' }));
    });

    it('refuses the owner changing their own role', async () => {
      await assertFails(updateDoc(doc(as('arch1'), 'users/arch1'), { role: 'admin' }));
      await assertFails(updateDoc(doc(as('arch1'), 'users/arch1'), { role: 'reviewer' }));
    });

    /* ---------------------------------------------------------------- D-13 */

    it('refuses the owner rewriting their own uid', async () => {
      // `uid` es la clave con la que el resto del modelo identifica a la
      // persona. Reescribirla no escala privilegio, pero deja un documento que
      // dice ser de otro.
      await assertFails(updateDoc(doc(as('arch1'), 'users/arch1'), { uid: 'admin1' }));
    });

    it('refuses the owner rewriting their own email', async () => {
      // Es lo que un administrador lee en el directorio antes de cambiarle el
      // rol a alguien. Que el sujeto pueda editarlo rompe esa lectura.
      await assertFails(
        updateDoc(doc(as('arch1'), 'users/arch1'), { email: 'admin1@arky.test' }),
      );
    });

    it('refuses the owner adding a field nobody declared', async () => {
      await assertFails(
        updateDoc(doc(as('arch1'), 'users/arch1'), { entitlements: ['everything'] }),
      );
    });

    it('refuses a display-name change smuggling a role change with it', async () => {
      // El modo de fallo que la lista blanca existe para cerrar: la escritura
      // legítima usada como vehículo de la que no lo es.
      await assertFails(
        updateDoc(doc(as('arch1'), 'users/arch1'), {
          displayName: 'Ana Torres',
          role: 'superadmin',
        }),
      );
    });

    it('still lets the owner change only their display name', async () => {
      await assertSucceeds(
        updateDoc(doc(as('arch1'), 'users/arch1'), { displayName: 'Ana T.' }),
      );
    });

    it('refuses an administrator editing their own row', async () => {
      // An administrator who can edit their own row can grant themselves
      // anything, and `users:grant-privileged` stops meaning anything.
      await assertFails(updateDoc(doc(as('admin1'), 'users/admin1'), { role: 'superadmin' }));
    });

    it('lets an administrator change somebody elses non-privileged role', async () => {
      await assertSucceeds(updateDoc(doc(as('admin1'), 'users/arch1'), { role: 'reviewer' }));
    });

    it('refuses an administrator promoting somebody to admin', async () => {
      await assertFails(updateDoc(doc(as('admin1'), 'users/arch1'), { role: 'admin' }));
    });

    it('refuses an administrator demoting a superadmin', async () => {
      // Otherwise "admin cannot grant privilege" is bypassed by removing the
      // people who hold it.
      await assertFails(updateDoc(doc(as('admin1'), 'users/super1'), { role: 'viewer' }));
    });

    it('lets a superadmin do both', async () => {
      await assertSucceeds(updateDoc(doc(as('super1'), 'users/arch1'), { role: 'admin' }));
      await assertSucceeds(updateDoc(doc(as('super1'), 'users/admin1'), { role: 'viewer' }));
    });

    it('refuses everyone else outright', async () => {
      await assertFails(updateDoc(doc(as('rev1'), 'users/arch1'), { role: 'viewer' }));
      await assertFails(updateDoc(doc(as('trainer1'), 'users/arch1'), { role: 'viewer' }));
    });
  });

  describe('deleting an account', () => {
    it('is refused to its own owner', async () => {
      await assertFails(deleteDoc(doc(as('arch1'), 'users/arch1')));
    });

    it('is refused to an administrator deleting themselves', async () => {
      await assertFails(deleteDoc(doc(as('admin1'), 'users/admin1')));
    });

    it('is allowed to an administrator for someone else', async () => {
      await assertSucceeds(deleteDoc(doc(as('admin1'), 'users/arch1')));
    });
  });

  describe('reading the directory', () => {
    it('is allowed to an administrator', async () => {
      await assertSucceeds(getDocs(collection(as('admin1'), 'users')));
    });

    it('is refused to everyone else', async () => {
      await assertFails(getDocs(collection(as('arch1'), 'users')));
      await assertFails(getDocs(collection(as('rev1'), 'users')));
    });

    it('still lets anyone read their own profile', async () => {
      await assertSucceeds(getDoc(doc(as('arch1'), 'users/arch1')));
    });
  });

  /* --------------------------------------------------------- the portfolio */

  describe('authoring the portfolio is a permission, not a session', () => {
    it('refuses a viewer creating a project', async () => {
      await assertFails(setDoc(doc(as('viewer1'), 'projects/p9'), { userId: 'viewer1', name: 'X' }));
    });

    it('lets an architect create one', async () => {
      await assertSucceeds(setDoc(doc(as('arch1'), 'projects/p9'), { userId: 'arch1', name: 'X' }));
    });

    it('refuses a trainer creating one', async () => {
      await assertFails(setDoc(doc(as('trainer1'), 'projects/p9'), { userId: 'trainer1', name: 'X' }));
    });

    it('refuses handing a project to somebody else on update', async () => {
      await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'projects/p1'), { userId: 'arch1', name: 'X' });
      });
      await assertFails(updateDoc(doc(as('arch1'), 'projects/p1'), { userId: 'arch2' }));
    });

    it('refuses a viewer creating an initiative', async () => {
      await assertFails(
        setDoc(doc(as('viewer1'), 'businessInitiatives/i9'), { userId: 'viewer1', name: 'X' }),
      );
    });
  });

  /* ------------------------------------------- the queries the app actually runs */

  describe('the app\'s own query shapes', () => {
    beforeEach(async () => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'projects/p1'), { userId: 'arch1', name: 'A' });
        await setDoc(doc(db, 'projects/p2'), { userId: 'arch2', name: 'B' });
        await setDoc(doc(db, 'courses/c1'), { userId: 'arch1', title: 'C4' });
        await setDoc(doc(db, 'courses/c2'), { userId: 'arch2', title: 'BPMN' });
      });
    });

    it('lets a non-admin list their own projects, as getAllProjects does', async () => {
      // The rule is evaluated per returned document, so the query must be
      // constrained to what the caller may read — which is exactly the shape
      // `firestoreService.getAllProjects` uses for a non-admin.
      await assertSucceeds(
        getDocs(query(collection(as('arch1'), 'projects'), where('userId', '==', 'arch1'))),
      );
    });

    it('refuses the same query aimed at somebody else', async () => {
      await assertFails(
        getDocs(query(collection(as('arch1'), 'projects'), where('userId', '==', 'arch2'))),
      );
    });

    it('refuses an unconstrained listing from a non-admin', async () => {
      await assertFails(getDocs(collection(as('arch1'), 'projects')));
    });

    it('lets an administrator list the whole collection', async () => {
      await assertSucceeds(getDocs(collection(as('admin1'), 'projects')));
    });

    it('lets a trainer list the whole course catalogue, as LMSContext does', async () => {
      await assertSucceeds(getDocs(collection(as('trainer1'), 'courses')));
    });

    it('limits a learner to their own courses', async () => {
      await assertSucceeds(
        getDocs(query(collection(as('arch1'), 'courses'), where('userId', '==', 'arch1'))),
      );
      await assertFails(getDocs(collection(as('arch1'), 'courses')));
    });

    it('lets a user read and write their own settings document', async () => {
      await assertSucceeds(setDoc(doc(as('arch1'), 'settings/user_arch1'), { theme: 'dark' }));
      await assertFails(setDoc(doc(as('arch1'), 'settings/user_arch2'), { theme: 'dark' }));
    });
  });

  /* -------------------------------------------------------------- the ARB */

  describe('the delivered transition', () => {
    beforeEach(async () => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'projects/p1'), { userId: 'arch1', name: 'X' });
        await setDoc(doc(db, 'projects/p1/engagements/e1'), { status: 'in-progress' });
      });
    });

    it('is refused to the author of the work', async () => {
      await assertFails(updateDoc(doc(as('arch1'), 'projects/p1/engagements/e1'), { status: 'delivered' }));
    });

    it('is allowed to a reviewer', async () => {
      // The old rules said "admin", which excluded the one role whose purpose
      // is governance.
      await assertSucceeds(updateDoc(doc(as('rev1'), 'projects/p1/engagements/e1'), { status: 'delivered' }));
    });

    it('refuses a reviewer editing the work itself', async () => {
      // Reading to govern is not authoring: the board signs off, it does not
      // rewrite the deliverable on its way past.
      await assertFails(updateDoc(doc(as('rev1'), 'projects/p1/engagements/e1'), { status: 'in-review' }));
    });

    it('lets the author still advance it to any other status', async () => {
      await assertSucceeds(updateDoc(doc(as('arch1'), 'projects/p1/engagements/e1'), { status: 'in-review' }));
    });

    it('refuses an ARB decision from someone without arb:decide', async () => {
      await assertFails(
        setDoc(doc(as('arch1'), 'projects/p1/engagements/e1/arbDecisions/d1'), {
          actor: { id: 'arch1' }, verdict: 'approved',
        }),
      );
    });

    it('refuses an ARB decision signed with somebody elses name', async () => {
      await assertFails(
        setDoc(doc(as('rev1'), 'projects/p1/engagements/e1/arbDecisions/d1'), {
          actor: { id: 'admin1' }, verdict: 'approved',
        }),
      );
    });

    it('keeps a recorded decision immutable', async () => {
      await assertSucceeds(
        setDoc(doc(as('rev1'), 'projects/p1/engagements/e1/arbDecisions/d1'), {
          actor: { id: 'rev1' }, verdict: 'approved',
        }),
      );
      await assertFails(
        updateDoc(doc(as('rev1'), 'projects/p1/engagements/e1/arbDecisions/d1'), { verdict: 'rejected' }),
      );
    });
  });

  /* --------------------------------------------------------- the curriculum */

  describe('courses', () => {
    beforeEach(async () => {
      await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'courses/c1'), { userId: 'arch1', title: 'C4' });
      });
    });

    it('lets someone manage the course they generated', async () => {
      await assertSucceeds(updateDoc(doc(as('arch1'), 'courses/c1'), { title: 'C4 v2' }));
      await assertSucceeds(deleteDoc(doc(as('arch1'), 'courses/c1')));
    });

    it('refuses a peer touching it', async () => {
      await assertFails(updateDoc(doc(as('arch2'), 'courses/c1'), { title: 'mío' }));
      await assertFails(getDoc(doc(as('arch2'), 'courses/c1')));
    });

    it('lets a trainer curate the whole catalogue', async () => {
      await assertSucceeds(getDoc(doc(as('trainer1'), 'courses/c1')));
      await assertSucceeds(updateDoc(doc(as('trainer1'), 'courses/c1'), { title: 'Currículo' }));
    });
  });

  /* ------------------------------------------------------- legacy accounts */

  describe('a legacy role keeps working', () => {
    it('reads a stored `student` as an architect', async () => {
      // Nobody loses access on the day the model changed.
      await assertSucceeds(setDoc(doc(as('legacy1'), 'projects/p8'), { userId: 'legacy1', name: 'X' }));
    });

    it('does not promote it into governance', async () => {
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'projects/p1'), { userId: 'legacy1', name: 'X' });
        await setDoc(doc(db, 'projects/p1/engagements/e1'), { status: 'in-progress' });
      });
      await assertFails(updateDoc(doc(as('legacy1'), 'projects/p1/engagements/e1'), { status: 'delivered' }));
    });

    it('cannot be written as a role on a new document', async () => {
      await assertFails(
        setDoc(doc(as('super1'), 'users/nuevo'), {
          uid: 'nuevo', email: 'n@e.com', displayName: 'N', role: 'student',
        }),
      );
    });
  });

  /* ------------------------------- aggregates split off the project document */

  describe('the aggregates split off the project document', () => {
    // Moving the architecture graph and the publication packages out of the
    // project document is a storage change, not a trust change. These assert
    // that the new paths carry exactly the project's authorisation — a split
    // that quietly widened access would be a worse defect than the size limit
    // it was made to fix.
    const seedProject = async () => {
      await env.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'projects/p1'), { userId: 'arch1', name: 'X' });
      });
    };

    it('lets the owner write and read its architecture graph', async () => {
      await seedProject();
      await assertSucceeds(setDoc(doc(as('arch1'), 'projects/p1/aggregates/architectureGraph'), { graph: {} }));
      await assertSucceeds(getDoc(doc(as('arch1'), 'projects/p1/aggregates/architectureGraph')));
    });

    it('lets the owner write and read a publication package document', async () => {
      await seedProject();
      await assertSucceeds(setDoc(doc(as('arch1'), 'projects/p1/publications/pkg1'), { package: {} }));
      await assertSucceeds(getDoc(doc(as('arch1'), 'projects/p1/publications/pkg1')));
    });

    it('denies another architect who does not own the project', async () => {
      await seedProject();
      await assertFails(setDoc(doc(as('arch2'), 'projects/p1/aggregates/architectureGraph'), { graph: {} }));
      await assertFails(getDoc(doc(as('arch2'), 'projects/p1/publications/pkg1')));
    });

    it('denies a viewer any write, as on the project itself', async () => {
      await seedProject();
      await assertFails(setDoc(doc(as('viewer1'), 'projects/p1/aggregates/architectureGraph'), { graph: {} }));
      await assertFails(setDoc(doc(as('viewer1'), 'projects/p1/publications/pkg1'), { package: {} }));
    });

    it('lets the review board read them, as it reads the project it governs', async () => {
      await seedProject();
      await env.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'projects/p1/aggregates/architectureGraph'), { graph: {} });
        await setDoc(doc(db, 'projects/p1/publications/pkg1'), { package: {} });
      });
      await assertSucceeds(getDoc(doc(as('rev1'), 'projects/p1/aggregates/architectureGraph')));
      await assertSucceeds(getDoc(doc(as('rev1'), 'projects/p1/publications/pkg1')));
    });

    it('denies a trainer, who has no business in the portfolio', async () => {
      await seedProject();
      await assertFails(getDoc(doc(as('trainer1'), 'projects/p1/aggregates/architectureGraph')));
      await assertFails(getDoc(doc(as('trainer1'), 'projects/p1/publications/pkg1')));
    });

    it('denies an unauthenticated caller outright', async () => {
      await seedProject();
      const anon = env.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(anon, 'projects/p1/aggregates/architectureGraph')));
      await assertFails(setDoc(doc(anon, 'projects/p1/publications/pkg1'), { package: {} }));
    });

    it('covers the artifact index, which every portfolio read now fetches', async () => {
      // The index is a second document in the same `aggregates` collection, so
      // it inherits the rule above rather than getting one of its own. That is
      // worth asserting: it is read on every portfolio load, by far the most
      // frequent read in the app, and a gap here would be a portfolio that
      // silently fails to load rather than one that refuses visibly.
      await seedProject();
      await assertSucceeds(setDoc(doc(as('arch1'), 'projects/p1/aggregates/artifactIndex'), { summaries: [], count: 0 }));
      await assertSucceeds(getDoc(doc(as('arch1'), 'projects/p1/aggregates/artifactIndex')));
      await assertSucceeds(getDoc(doc(as('rev1'), 'projects/p1/aggregates/artifactIndex')));
      await assertFails(getDoc(doc(as('arch2'), 'projects/p1/aggregates/artifactIndex')));
      await assertFails(setDoc(doc(as('viewer1'), 'projects/p1/aggregates/artifactIndex'), { summaries: [], count: 0 }));
    });
  });

});
