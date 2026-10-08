import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BRACES_ADVISORY = 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm';
const BUILD_CHAIN = new Set(['braces', 'chokidar', 'micromatch', 'fast-glob', 'tailwindcss']);
const EXCEPTION_EXPIRES = '2026-11-03';

/** The sole exception is one unpatched advisory in build-only dependencies. */
export function assessAudit(report, lockfile, today = new Date().toISOString().slice(0, 10)) {
  if (!report?.vulnerabilities || !lockfile?.packages) return ['npm audit did not return a valid report.'];
  const high = Object.entries(report.vulnerabilities)
    .filter(([, vulnerability]) => ['high', 'critical'].includes(vulnerability.severity));
  if (high.length === 0) return [];

  const names = new Set(high.map(([name]) => name));
  const root = report.vulnerabilities.braces;
  const rootAdvisory = root?.via?.length === 1 && root.via[0]?.url === BRACES_ADVISORY;
  const knownChain = rootAdvisory && [...names].every((name) => BUILD_CHAIN.has(name));
  const onlyBuildDependencies = high.every(([, vulnerability]) =>
    vulnerability.nodes?.length > 0
    && vulnerability.nodes.every((node) => lockfile.packages[node]?.dev === true));
  // A source below high cannot make anything high; it only has to stay out of production.
  const belowHighBuildOnly = (name) => {
    const source = report.vulnerabilities[name];
    return Boolean(source) && !['high', 'critical'].includes(source.severity)
      && source.nodes?.length > 0 && source.nodes.every((node) => lockfile.packages[node]?.dev === true);
  };
  const derivedFromBraces = high.every(([name, vulnerability]) =>
    name === 'braces' || (
      vulnerability.via?.some((source) => typeof source === 'string' && BUILD_CHAIN.has(source))
      && vulnerability.via.every((source) =>
        typeof source === 'string' && (BUILD_CHAIN.has(source) || belowHighBuildOnly(source)))));

  if (today <= EXCEPTION_EXPIRES && knownChain && onlyBuildDependencies && derivedFromBraces) {
    return [];
  }
  return high.map(([name, vulnerability]) => `${name}: ${vulnerability.severity}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const audit = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8' });
  if (audit.error) throw audit.error;
  let report;
  try {
    report = JSON.parse(audit.stdout);
  } catch {
    console.error('npm audit did not return JSON:', audit.stderr.trim());
    process.exit(1);
  }
  const lockfile = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  const failures = assessAudit(report, lockfile);
  if (failures.length > 0) {
    console.error('High or critical dependency advisories:', failures.join(', '));
    process.exit(1);
  }
  const known = report.vulnerabilities?.braces?.via?.some((via) => via.url === BRACES_ADVISORY);
  if (known) console.log(`Temporary build-only exception for GHSA-vfj7-8cjw-p6xm (expires ${EXCEPTION_EXPIRES}).`);
  console.log('Dependency audit: no other high or critical advisories.');
}
