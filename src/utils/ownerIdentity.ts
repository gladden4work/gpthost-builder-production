/**
 * Owner identity utilities
 *
 * Provides helper functions for mapping authenticated owner IDs to any
 * previously stored ownerEmail fields so legacy projects (email-only) can
 * still be associated with the right owner.
 */

export interface OwnerRecordLike {
  ownerId?: string | null;
  owner_id?: string | null;
  ownerEmail?: string | null;
  owner_email?: string | null;
}

/**
 * Normalize an owner token (ID or email) for comparisons.
 * - Trims whitespace
 * - Lowercases when the token looks like an email (contains '@')
 */
export function normalizeOwnerToken(token?: string | null): string | null {
  if (token === undefined || token === null) return null;
  const trimmed = String(token).trim();
  if (!trimmed) return null;
  return trimmed.includes('@') ? trimmed.toLowerCase() : trimmed;
}

/**
 * Build an alias set for the given ownerId using:
 * - The ownerId itself
 * - Emails recorded on any projects that already carry that ownerId
 * - Optional fallback emails supplied by the caller (e.g., Supabase JWT)
 */
export function buildOwnerAliasSet(
  ownerId: string,
  projects: OwnerRecordLike[],
  fallbackEmails: string[] = []
): Set<string> {
  const aliases = new Set<string>();
  const normalizedOwnerId = normalizeOwnerToken(ownerId);
  if (normalizedOwnerId) aliases.add(normalizedOwnerId);

  for (const fallback of fallbackEmails) {
    const normalized = normalizeOwnerToken(fallback);
    if (normalized) aliases.add(normalized);
  }

  if (!projects.length) {
    return aliases;
  }

  for (const project of projects) {
    const projectOwner = normalizeOwnerToken(project.ownerId ?? project.owner_id);
    if (projectOwner && normalizedOwnerId && projectOwner === normalizedOwnerId) {
      const email = normalizeOwnerToken(project.ownerEmail ?? project.owner_email);
      if (email) {
        aliases.add(email);
      }
    }
  }

  return aliases;
}

/**
 * Determine whether a project matches any alias in the provided set.
 */
export function projectMatchesOwnerAliases(
  project: OwnerRecordLike,
  aliases: Set<string>
): boolean {
  if (aliases.size === 0) return false;
  const direct = normalizeOwnerToken(project.ownerId ?? project.owner_id);
  if (direct && aliases.has(direct)) return true;
  const email = normalizeOwnerToken(project.ownerEmail ?? project.owner_email);
  if (email && aliases.has(email)) return true;
  return false;
}
