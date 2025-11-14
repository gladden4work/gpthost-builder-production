/**
 * GitHub Workflow Fix
 * 
 * This module contains the fix for the GitHub Actions workflow failures.
 * 
 * ROOT CAUSE ANALYSIS:
 * The workflow is failing because of a timing/synchronization issue:
 * 1. Files are uploaded to the repository via GitHub API
 * 2. Workflow is triggered immediately after upload
 * 3. Workflow does 'actions/checkout@v4' which checks out the repository
 * 4. BUT: The checkout gets the repository state from BEFORE the files were uploaded
 * 5. Result: Workflow can't find the uploaded files and fails
 * 
 * SOLUTION OPTIONS:
 * 
 * Option 1: Pass source files as workflow input (RECOMMENDED)
 * - Modify workflow to accept source_files as JSON input
 * - Workflow creates files from the input instead of expecting them in repo
 * - No race condition, guaranteed to work
 * 
 * Option 2: Add delay after upload
 * - Wait 5-10 seconds after uploading files before triggering workflow
 * - Allows GitHub to fully process the file uploads
 * - Less reliable, but simpler
 * 
 * Option 3: Use git commit + push instead of API file upload
 * - Clone repo, add files, commit, push
 * - Then trigger workflow
 * - More complex but guarantees files are in repo
 * 
 * Option 4: Modify workflow to fetch files from R2/external storage
 * - Upload files to R2 first
 * - Pass R2 URLs to workflow
 * - Workflow downloads files from R2
 * - Avoids GitHub repository entirely
 */

import { GitHubApiClient } from './githubApi';
import { BuildJob } from '../types/api';

/**
 * Fixed version of triggerBuild that ensures files are available to workflow
 */
export async function triggerBuildFixed(
  githubClient: GitHubApiClient,
  repositoryFullName: string,
  buildJob: BuildJob,
  callbackUrl?: string
): Promise<{ success: boolean; runId?: number; error?: string }> {
  try {
    // OPTION 1 IMPLEMENTATION: Pass files as workflow input
    // This is the most reliable solution
    
    const response = await fetch(
      `https://api.github.com/repos/${repositoryFullName}/actions/workflows/gpthost-build.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          ref: 'main',
          inputs: {
            project_id: buildJob.project_id,
            // CRITICAL FIX: Include source_files as workflow input
            source_files: JSON.stringify(buildJob.source_files),
            build_config: JSON.stringify(buildJob.build_config),
            // Prefer explicit callback, then env var, then static fallback
            callback_url:
              callbackUrl ||
              (typeof process !== 'undefined' && process.env && process.env.GITHUB_BUILD_CALLBACK_URL) ||
              'https://gpthost-builder-staging.gladden4work.workers.dev/api/v2/github/build-callback',
            callback_token: process.env.GITHUB_TOKEN
          }
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      return { success: false, error: `Failed to trigger workflow: ${error.message}` };
    }

    // Wait a moment for the workflow to start
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Get the latest workflow run
    const runsResponse = await fetch(
      `https://api.github.com/repos/${repositoryFullName}/actions/workflows/gpthost-build.yml/runs?per_page=1`,
      {
        headers: {
          'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github+json'
        }
      }
    );

    if (runsResponse.ok) {
      const data = await runsResponse.json();
      const latestRun = data.workflow_runs?.[0];
      return { success: true, runId: latestRun?.id };
    }

    return { success: true };

  } catch (error) {
    console.error(`Failed to trigger build for project ${buildJob.project_id}:`, error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Alternative Option 2: Add delay after file upload
 */
export async function ensureFilesAreSynced(delayMs: number = 10000): Promise<void> {
  console.info(`⏳ Waiting ${delayMs}ms for GitHub to sync uploaded files...`);
  await new Promise(resolve => setTimeout(resolve, delayMs));
  console.info('✅ File sync delay completed');
}

/**
 * Workflow YAML fix that needs to be applied to the repository
 */
export const WORKFLOW_YAML_FIX = `
# Add this to the workflow_dispatch inputs section:
      source_files:
        description: 'Source files as JSON object'
        required: true
        type: string

# Then in the "Create source files" step, use the input:
    - name: Create source files from workflow input
      working-directory: projects/\${{ inputs.project_id }}
      run: |
        echo "Creating source files from workflow input..."
        echo '\${{ inputs.source_files }}' > source_files.json
        
        # Parse JSON and create files
        jq -r 'to_entries[] | [.key, .value] | @tsv' source_files.json | while IFS=$'\\t' read -r filename content; do
          # Determine directory (src/ for code files, root for config files)
          if [[ "\$filename" == *.json ]] || [[ "\$filename" == *.html ]] || [[ "\$filename" == *.config.* ]]; then
            echo "\$content" > "\$filename"
            echo "Created: \$filename"
          else
            mkdir -p src
            echo "\$content" > "src/\$filename"
            echo "Created: src/\$filename"
          fi
        done
        
        rm source_files.json
        echo "Source files created successfully"
        ls -la
        ls -la src/
`;
