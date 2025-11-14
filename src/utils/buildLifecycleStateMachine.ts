import { BuildStatusType } from '../types/api';

/**
 * Explicit build lifecycle state machine to guard against invalid status
 * regressions. Each state lists the statuses it may transition to.
 */
const transitions: Record<BuildStatusType, BuildStatusType[]> = {
  queued: ['processing', 'cancelled'],
  processing: ['completed', 'failed', 'timeout', 'cancelled'],
  completed: [],
  failed: [],
  timeout: [],
  cancelled: []
};

/**
 * Determine if a transition between build statuses is allowed.
 */
export function canTransition(
  current: BuildStatusType | undefined,
  next: BuildStatusType
): boolean {
  if (!current || current === next) return true;
  return transitions[current]?.includes(next) ?? false;
}
