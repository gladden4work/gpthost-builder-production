import { describe, it, expect } from 'vitest';
import { canTransition } from '../../src/utils/buildLifecycleStateMachine';

describe('buildLifecycleStateMachine', () => {
  it('allows forward transitions', () => {
    expect(canTransition('queued', 'processing')).toBe(true);
    expect(canTransition('processing', 'completed')).toBe(true);
  });

  it('blocks invalid transitions', () => {
    expect(canTransition('completed', 'processing')).toBe(false);
  });
});
