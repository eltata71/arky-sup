import { describe, expect, it } from 'vitest';
import { deriveHardBlockContext, evaluateGateGuard, gateGuardTone } from '../../services/diagram/visualGateGuard';

describe('visualGateGuard / evaluateGateGuard', () => {
  it('never interrupts the user when gate is ready', () => {
    const exportDecision = evaluateGateGuard('ready', 'export');
    expect(exportDecision.requireConfirmation).toBe(false);
    expect(exportDecision.hardBlock).toBe(false);

    const presentationDecision = evaluateGateGuard('ready', 'presentation');
    expect(presentationDecision.requireConfirmation).toBe(false);
  });

  it('soft-confirms presentation/publication on warnings but lets exports through', () => {
    const exportDecision = evaluateGateGuard('warnings', 'export');
    expect(exportDecision.requireConfirmation).toBe(false);

    const presentationDecision = evaluateGateGuard('warnings', 'presentation');
    expect(presentationDecision.requireConfirmation).toBe(true);

    const publicationDecision = evaluateGateGuard('warnings', 'publication');
    expect(publicationDecision.requireConfirmation).toBe(true);
  });

  it('requires confirmation for all actions when blocked', () => {
    const exportDecision = evaluateGateGuard('blocked', 'export');
    expect(exportDecision.requireConfirmation).toBe(true);
    expect(exportDecision.hardBlock).toBe(false);
    expect(exportDecision.message).toMatch(/bloque/i);

    const presentationDecision = evaluateGateGuard('blocked', 'presentation');
    expect(presentationDecision.requireConfirmation).toBe(true);
  });

  it('falls back to ready behaviour when the gate state is undefined', () => {
    const decision = evaluateGateGuard(undefined, 'export');
    expect(decision.requireConfirmation).toBe(false);
    expect(decision.hardBlock).toBe(false);
  });

  it('produces a non-empty, action-specific message', () => {
    const e = evaluateGateGuard('blocked', 'export');
    expect(e.message.length).toBeGreaterThan(10);
    expect(e.message.toLowerCase()).toContain('exportar');

    const p = evaluateGateGuard('blocked', 'presentation');
    expect(p.message.toLowerCase()).toContain('presentaci');
  });
});

describe('visualGateGuard / gateGuardTone', () => {
  it('maps gate states to UI tones', () => {
    expect(gateGuardTone('ready')).toBe('info');
    expect(gateGuardTone('warnings')).toBe('warn');
    expect(gateGuardTone('blocked')).toBe('block');
    expect(gateGuardTone(undefined)).toBe('info');
  });
});

describe('visualGateGuard / hard-block paths', () => {
  it('hard-blocks every action when the diagram has zero content nodes', () => {
    const decision = evaluateGateGuard('ready', 'export', { contentNodeCount: 0 });
    expect(decision.hardBlock).toBe(true);
    expect(decision.hardBlockCode).toBe('EMPTY_DIAGRAM');
    expect(decision.requireConfirmation).toBe(true);
    expect(decision.confirmCta).toBe('No disponible');
  });

  it('hard-blocks when render errors accumulated past the threshold', () => {
    const decision = evaluateGateGuard('warnings', 'presentation', { recentRenderErrors: 7 });
    expect(decision.hardBlock).toBe(true);
    expect(decision.hardBlockCode).toBe('CRITICAL_RENDER_ERRORS');
  });

  it('hard-blocks when the canvas is on the emergency grid fallback', () => {
    const decision = evaluateGateGuard('blocked', 'publication', { isEmergencyFallback: true });
    expect(decision.hardBlock).toBe(true);
    expect(decision.hardBlockCode).toBe('EMERGENCY_FALLBACK');
  });

  it('does not hard-block when only soft thresholds are tripped', () => {
    const decision = evaluateGateGuard('blocked', 'export', { contentNodeCount: 12, recentRenderErrors: 1 });
    expect(decision.hardBlock).toBe(false);
    expect(decision.hardBlockCode).toBeUndefined();
    expect(decision.requireConfirmation).toBe(true);
  });

  it('keeps soft confirmation when the hard-block context is absent', () => {
    const decision = evaluateGateGuard('blocked', 'export');
    expect(decision.hardBlock).toBe(false);
    expect(decision.requireConfirmation).toBe(true);
  });
});

describe('visualGateGuard / deriveHardBlockContext', () => {
  it('infers render errors from RECENT_RENDER_ERRORS gate signal when not provided', () => {
    const ctx = deriveHardBlockContext({ signals: [{ code: 'RECENT_RENDER_ERRORS', severity: 'high', message: '' }] }, {});
    expect(ctx.recentRenderErrors).toBe(5);
  });

  it('prefers the explicit override when both gate signal and option are present', () => {
    const ctx = deriveHardBlockContext(
      { signals: [{ code: 'RECENT_RENDER_ERRORS', severity: 'high', message: '' }] },
      { recentRenderErrors: 2 },
    );
    expect(ctx.recentRenderErrors).toBe(2);
  });

  it('returns zero render errors when no signal or option is present', () => {
    const ctx = deriveHardBlockContext(null, {});
    expect(ctx.recentRenderErrors).toBe(0);
  });
});
