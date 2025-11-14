import type { Env } from '../types/env';

interface TimelineEvent {
  event: string;
  timestamp: string;
  details?: Record<string, unknown>;
}

/**
 * Append an event to a project's timeline.json in R2.
 * Creates the file if it doesn't exist.
 */
export async function appendTimelineEvent(
  projectId: string,
  env: Env,
  event: string,
  details?: Record<string, unknown>
): Promise<void> {
  const key = `projects/${projectId}/timeline.json`;
  let timeline: TimelineEvent[] = [];

  try {
    const obj = await env.PROJECTS_BUCKET.get(key);
    if (obj) {
      const text = await obj.text();
      timeline = JSON.parse(text || '[]');
    }
  } catch (e) {
    console.warn(`[Timeline] Failed to read existing timeline for ${projectId}:`, e);
  }

  timeline.push({ event, timestamp: new Date().toISOString(), details });

  try {
    await env.PROJECTS_BUCKET.put(key, JSON.stringify(timeline, null, 2), {
      httpMetadata: { contentType: 'application/json' }
    });
  } catch (e) {
    console.warn(`[Timeline] Failed to write timeline for ${projectId}:`, e);
  }
}
