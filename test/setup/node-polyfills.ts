/**
 * Node.js polyfills for unit tests
 * 
 * Provides compatibility shims for APIs that exist in Workers but not Node.js
 */

import { vi } from 'vitest';
import crypto from 'node:crypto';

// Polyfill crypto.randomUUID if not available
if (!globalThis.crypto) {
	globalThis.crypto = crypto as any;
}

// Polyfill TextEncoder/TextDecoder if not available
if (!globalThis.TextEncoder) {
	globalThis.TextEncoder = TextEncoder;
}

if (!globalThis.TextDecoder) {
	globalThis.TextDecoder = TextDecoder;
}

// Mock console methods to reduce noise in tests
globalThis.console = {
	...console,
	// Reduce noise in tests while keeping errors visible
	log: vi.fn(),
	info: vi.fn(),
	warn: vi.fn(),
	debug: vi.fn(),
	error: console.error, // Keep error output for debugging
};

// Mock performance.now() if not available
if (!globalThis.performance) {
	globalThis.performance = {
		now: () => Date.now(),
		timeOrigin: Date.now(),
	} as any;
}

// Add any R2-specific type mocks for unit tests
// These will be overridden by actual mocks in test files
declare global {
	interface R2Bucket {
		put: any;
		get: any;
		delete: any;
		list: any;
		head: any;
		createMultipartUpload: any;
		resumeMultipartUpload: any;
	}
}

// Environment variable defaults for testing
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.ENVIRONMENT = 'test';

// Suppress deprecation warnings in tests
process.removeAllListeners('warning');

export {};