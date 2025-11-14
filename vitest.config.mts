import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineWorkersConfig({
	resolve: {
		alias: {
			'node:os': path.resolve(__dirname, './test/polyfills/node-os.js'),
			os: path.resolve(__dirname, './test/polyfills/node-os.js'),
			'node:fs': path.resolve(__dirname, './test/polyfills/node-fs.js'),
			fs: path.resolve(__dirname, './test/polyfills/node-fs.js'),
			'@': path.resolve(__dirname, './src'),
		},
	},
	test: {
		// Exclude archived tests from running
		exclude: ['**/archive/**', '**/node_modules/**'],
		// Memory optimization: Run tests sequentially
		maxWorkers: 1,
		minWorkers: 1,
		maxConcurrency: 1,
		// Ensure proper cleanup
		teardownTimeout: 10000,
		// Add timeout to prevent hanging tests
		testTimeout: 30000,
		// Memory optimization: Clear mocks between tests
		clearMocks: true,
		restoreMocks: true,
		setupFiles: ['./test/setup/worker-polyfills.ts'],
		poolOptions: {
			workers: {
				wrangler: { configPath: './wrangler.jsonc' },
				// Memory optimization: Share worker between tests
				isolate: false,
				singleWorker: true,
				// Configure miniflare for functional R2 simulation
				miniflare: {
					// Use supported compatibility date
					compatibilityDate: '2025-08-03',
					compatibilityFlags: ['nodejs_compat'],
					// Enable R2 buckets with actual storage behavior
					r2Buckets: {
						PROJECTS_BUCKET: 'gpthost-projects-test',
						BUILDS_BUCKET: 'gpthost-builds-test', 
						DEPLOYMENTS_BUCKET: 'gpthost-deployments-test'
					},
					// Memory optimization: Only persist R2 for E2E tests
					// Disable persistence for unit/integration tests to save memory
					r2Persist: process.env.TEST_TYPE === 'e2e' ? './test/.r2' : false,
					// Enable queue simulation for build processing
					queueProducers: {
						BUILD_QUEUE: 'gpthost-build-queue-test'
					},
					// Add queue consumers for full queue simulation
					queueConsumers: {
						'gpthost-build-queue-test': {
							maxBatchSize: 1,
							maxBatchTimeout: 30
						}
					},
					modules: [
						{ type: 'CommonJS', name: 'node:os', path: path.resolve(__dirname, './test/polyfills/node-os.js') },
						{ type: 'CommonJS', name: 'os', path: path.resolve(__dirname, './test/polyfills/node-os.js') },
						{ type: 'CommonJS', name: 'node:fs', path: path.resolve(__dirname, './test/polyfills/node-fs.js') },
						{ type: 'CommonJS', name: 'fs', path: path.resolve(__dirname, './test/polyfills/node-fs.js') },
					],
					// Bind environment variables for tests (inherits from .dev.vars)
					bindings: {
						ENVIRONMENT: 'test',
						MAX_FILE_SIZE: '104857600',
						SUPPORTED_EXTENSIONS: '.html,.jsx,.tsx,.vue,.svelte',
						// Use same token as .dev.vars for consistency
						MVP_ACCESS_TOKEN: 'test-valid-token-12345',
						DEPLOYMENT_DOMAIN: 'test-deployments.r2.dev',
						// GitHub config will be read from .dev.vars by Wrangler
					}
				}
			},
		},
	},
});
