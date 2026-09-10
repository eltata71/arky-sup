/**
 * Tiny class-name joiner — drops falsy values and joins the rest with a single
 * space.  Lets us write `cn('base', isActive && 'active', extraClass)` without
 * pulling in `clsx`/`classnames`.  Avoids deduping or precedence work because
 * Tailwind's last-class-wins behaviour already covers the common case.
 */
export type ClassValue = string | number | false | null | undefined;

export function cn(...values: ClassValue[]): string {
    let out = '';
    for (const value of values) {
        if (!value && value !== 0) continue;
        if (out.length > 0) out += ' ';
        out += String(value);
    }
    return out;
}
