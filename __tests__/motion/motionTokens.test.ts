import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function tsxFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap(name => {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) return name === '__tests__' ? [] : tsxFiles(rel);
    return /\.tsx$/.test(name) ? [rel] : [];
  });
}

const motionFiles = ['components', 'pages', 'hooks', 'context']
  .flatMap(tsxFiles)
  .filter(file => /from ['"]motion\/react['"]/.test(readFileSync(join(ROOT, file), 'utf8')));

describe('13.1 · el movimiento sale de MOTION', () => {
  it('vigila todos los componentes motion, incluidos los añadidos después de la base de 31', () => {
    expect(motionFiles.length).toBeGreaterThanOrEqual(31);
    const overrides = motionFiles.filter(file => /<MotionConfig\b[^>]*reducedMotion=(?:"never"|'never')/.test(readFileSync(join(ROOT, file), 'utf8')));
    expect(overrides).toEqual([]);
  });

  it('ninguna animación de motion/react escribe una duración ni una curva literal', () => {
    const offenders: string[] = [];
    for (const file of motionFiles) {
      readFileSync(join(ROOT, file), 'utf8').split('\n').forEach((line, i) => {
        // 0 es «sin animación» (movimiento reducido); lo demás son segundos.
        const literalDuration = /duration:\s*(?!0\b)\d+(?:\.\d+)?(?=[\s,}])/.test(line) && !/fitView|fitBounds|zoom|scrollToContent/.test(line);
        const literalEase = /ease:\s*(\[|'easeIn|'easeOut|'easeInOut|'linear')/.test(line);
        if (literalDuration || literalEase) offenders.push(`${file}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('la raíz envuelve la aplicación en MotionConfig reducedMotion="user"', () => {
    const entry = readFileSync(join(ROOT, 'index.tsx'), 'utf8');
    expect(entry).toMatch(/<MotionConfig reducedMotion="user">/);
  });
});
