/**
 * Normalize user-provided project names into a safe slug.
 * Rules:
 * - Lowercase
 * - Replace spaces/underscores with hyphens
 * - Drop non-alphanumeric/non-hyphen chars
 * - Collapse duplicate hyphens and trim edges
 * - Enforce length 3-50 characters (post-sanitize)
 */
export interface SanitizedProjectName {
  sanitized: string;
  error?: string;
}

export function sanitizeProjectName(rawName: string | undefined | null): SanitizedProjectName {
  const base = (rawName ?? '').toString().trim().toLowerCase();

  const slug = base
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50); // hard cap to avoid overly long subdomains/ids

  if (!slug) {
    return {
      sanitized: '',
      error: 'Project name must be 3-50 alphanumeric characters with hyphens'
    };
  }

  if (slug.length < 3 || slug.length > 50) {
    return {
      sanitized: slug,
      error: 'Project name must be 3-50 alphanumeric characters with hyphens'
    };
  }

  return { sanitized: slug };
}
