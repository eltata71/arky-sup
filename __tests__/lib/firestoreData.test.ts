import { describe, expect, it } from 'vitest';
import { sanitizeForFirestore } from '../../lib/firestoreData';

describe('sanitizeForFirestore', () => {
  it('omits undefined object fields and converts undefined array slots to null', () => {
    const sanitized = sanitizeForFirestore({
      keep: 'value',
      drop: undefined,
      nested: {
        keep: 1,
        drop: undefined,
      },
      list: [undefined, { keep: true, drop: undefined }, 'ok'],
    });

    expect(sanitized).toEqual({
      keep: 'value',
      nested: { keep: 1 },
      list: [null, { keep: true }, 'ok'],
    });
  });
});
