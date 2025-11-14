import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Lightweight Vitest configuration for unit tests
 * 
 * This configuration runs tests in Node.js environment without Workers runtime,
 * significantly reducing memory usage and improving test speed.
 * 
 * Use this for:
 * - Pure unit tests with mocked dependencies
 * - Service tests that don't need real R2/Queue interaction
 * - Tests in test/unit/ and test/services/ directories
 * 
 * Memory usage: ~200-300MB (vs 1.5GB+ with Workers runtime)
 * Speed: 3-5x faster than Workers runtime
 */
export default defineConfig({
	test: {
		// Run in Node.js environment (no Workers runtime overhead)
		environment: 'node',
		
		// Include only unit and service tests
		include: [
			'test/unit/**/*.test.ts',
			'test/services/**/*.test.ts'
		],
		
		// Exclude archived tests and integration/e2e tests
		exclude: [
			'**/archive/**',
			'**/node_modules/**',
			'test/integration/**',
			'test/e2e/**'
		],
		
		// Memory optimizations
		maxWorkers: 1,
		maxConcurrency: 1,
		
		// Automatic mock cleanup
		clearMocks: true,
		restoreMocks: true,
		mockReset: true,
		
		// Faster test execution
		isolate: false,
		threads: false,
		
		// Timeout settings
		testTimeout: 10000,
		hookTimeout: 10000,
		teardownTimeout: 5000,
		
		// Coverage settings (optional)
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
			exclude: [
				'**/node_modules/**',
				'**/test/**',
				'**/archive/**',
				'**/*.config.*',
				'**/types/**'
			]
		},
		
		// Global setup for Node environment
		globals: true,
		
		// Setup files for Node environment polyfills
		setupFiles: ['./test/setup/node-polyfills.ts']
	},
	
	// Resolve aliases to match Workers config
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './src'),
			'@lib': path.resolve(__dirname, './src/lib'),
			'@services': path.resolve(__dirname, './src/services'),
			'@domain': path.resolve(__dirname, './src/domain'),
			'@types': path.resolve(__dirname, './src/types')
		}
	},
	
	// Ensure TypeScript support
	esbuild: {
		target: 'node18',
		platform: 'node'
	}
});