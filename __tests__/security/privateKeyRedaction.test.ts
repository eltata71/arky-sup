import { createPrivateKey, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { redactSecretShapes } from '../../lib/secretShapes';

// Generated only in memory, never fixtures, logs, snapshots or committed keys.
const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey;
const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey;
const cases = [
  ['PKCS#1', rsa.export({ type: 'pkcs1', format: 'pem' }).toString()],
  ['PKCS#8', rsa.export({ type: 'pkcs8', format: 'pem' }).toString()],
  ['SEC1', ec.export({ type: 'sec1', format: 'pem' }).toString()],
  ['encrypted PKCS#8', rsa.export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'ephemeral-test-only' }).toString()],
  ['encrypted legacy PEM', rsa.export({ type: 'pkcs1', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'ephemeral-test-only' }).toString()],
] as const;

describe('private-key PEM redaction', () => {
  it.each(cases)('removes the entire %s key, not only enough to break parsing', (_name, pem) => {
    expect(() => createPrivateKey({ key: pem, passphrase: 'ephemeral-test-only' })).not.toThrow();
    const text = redactSecretShapes(`before\n${pem}after`);
    expect(text === 'before\n[credencial omitida]\nafter').toBe(true);
    expect(() => createPrivateKey(text)).toThrow();
  });

  it.each(cases)('fails closed for every truncation after the %s header', (_name, pem) => {
    const headerEnd = pem.indexOf('\n');
    for (let end = headerEnd; end < pem.trimEnd().length; end += 1) {
      // Exact equality proves that no body fragment or partial footer survives.
      expect(redactSecretShapes(`before\n${pem.slice(0, end)}`) === 'before\n[credencial omitida]').toBe(true);
    }
  });

  it.each(['RSA ', 'EC ', 'DSA ', 'ENCRYPTED ', 'OPENSSH ', ''])('supports the admitted %sPRIVATE KEY label and newline formats', (label) => {
    const body = rsa.export({ type: 'pkcs8', format: 'pem' }).toString().split('\n').slice(1, -2).join('\n');
    for (const newline of ['\n', '\r\n', '']) {
      const pem = `-----BEGIN ${label}PRIVATE KEY-----${newline}${body}${newline}-----END ${label}PRIVATE KEY-----`;
      expect(redactSecretShapes(pem) === '[credencial omitida]').toBe(true);
    }
  });

  it('removes adjacent and repeated blocks, and is idempotent', () => {
    const pem = cases[0][1].trim();
    const text = redactSecretShapes(`${pem}${pem}\n${pem}`);
    expect(text).toBe('[credencial omitida][credencial omitida]\n[credencial omitida]');
    expect(redactSecretShapes(text)).toBe(text);
  });

  it('discards the rest of the field when an incomplete block has no trustworthy end', () => {
    const pem = cases[0][1].split('-----END')[0];
    expect(redactSecretShapes(`${pem}\ntrailing diagnostic`)).toBe('[credencial omitida]');
  });

  it('does not trust a mismatched footer inside a private-key block', () => {
    const pem = cases[0][1].replace('-----END RSA PRIVATE KEY-----', '-----END EC PRIVATE KEY-----');
    expect(redactSecretShapes(`${pem}remaining fragment`)).toBe('[credencial omitida]');
  });

  it('preserves public PEM and ordinary prose', () => {
    const publicPem = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();
    expect(redactSecretShapes(publicPem)).toBe(publicPem);
    expect(redactSecretShapes('Use a rotated private key.')).toBe('Use a rotated private key.');
  });
});
