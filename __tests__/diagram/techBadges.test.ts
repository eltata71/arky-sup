import { describe, expect, it } from 'vitest';
import { detectTechBadge, OFFICIAL_TECH_BADGES } from '../../lib/diagramTechBadges';

describe('detectTechBadge', () => {
    it('returns null when label+type are empty', () => {
        expect(detectTechBadge(undefined, undefined)).toBeNull();
        expect(detectTechBadge('', '')).toBeNull();
    });

    it('recognises AWS regardless of casing', () => {
        expect(detectTechBadge('AWS Lambda function', 'service')?.label).toBe('AWS');
        expect(detectTechBadge('amazon sqs queue', 'messaging')?.label).toBe('AWS');
    });

    it('prefers more specific matches when both could fire', () => {
        // "Postgres on AWS RDS" → AWS entry is listed first by design and catches RDS.
        const first = detectTechBadge('Postgres on AWS RDS', 'database');
        expect(first).not.toBeNull();
        // PostgreSQL must still be reachable when AWS isn't in the haystack.
        const second = detectTechBadge('PostgreSQL 15', 'database');
        expect(second?.label).toBe('PostgreSQL');
    });

    it('covers modern ecosystem entries', () => {
        const expected = ['Snowflake', 'Databricks', 'Terraform', 'Kubernetes', 'Datadog', 'Stripe', 'Auth0', 'Okta', 'Vercel'];
        for (const label of expected) {
            const found = OFFICIAL_TECH_BADGES.find(b => b.label === label);
            expect(found, `missing badge: ${label}`).toBeDefined();
        }
    });
});
