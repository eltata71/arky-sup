import { describe, it, expect } from 'vitest';
import { cn } from '../../../components/ui/cn';

describe('cn', () => {
    it('joins truthy strings with single spaces', () => {
        expect(cn('a', 'b', 'c')).toBe('a b c');
    });

    it('drops falsy values (false, null, undefined, "")', () => {
        expect(cn('a', false, null, undefined, '', 'b')).toBe('a b');
    });

    it('keeps the literal "0"', () => {
        expect(cn('a', 0, 'b')).toBe('a 0 b');
    });

    it('returns empty string when all falsy', () => {
        expect(cn(false, null, undefined)).toBe('');
    });

    it('handles a single class value', () => {
        expect(cn('only')).toBe('only');
    });
});
