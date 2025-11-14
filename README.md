# GPTHost Builder Staging - ⚠️ SIMULATION-ONLY BUILD SYSTEM ⚠️

## CRITICAL WARNING: THIS IS A SIMULATION-ONLY BUILD SYSTEM

**🚨 IMPORTANT:** The current build system in this codebase contains **ONLY SIMULATED** build processes. No actual builds are executed.

### ❌ WHAT DOESN'T WORK (SIMULATED ONLY):

- **npm install**: No actual package installation occurs
- **Vite builds**: No actual bundling, compilation, or minification
- **File system operations**: No real file reading/writing in Workers environment
- **Dependency resolution**: No actual package downloads or node_modules creation
- **Asset generation**: All artifacts are mock data, not real build outputs

### ✅ WHAT ACTUALLY WORKS (SIMULATION):

- **Build status updates**: Progress tracking and status polling for UI development
- **Mock artifacts**: Fake build outputs stored in R2 for testing
- **Build timing simulation**: Realistic build duration simulation
- **Error handling**: Simulated error scenarios for testing
- **Queue processing**: Simulated build job processing

### 🔧 FOR REAL BUILDS, YOU NEED:

**GitHub Actions Integration** (TASK-021 to TASK-028):
- External build runners with Node.js environment
- Actual npm/yarn package installation
- Real Vite/Webpack build execution
- Proper file system access
- Build artifact collection and storage

### 📁 Key Simulation Files:

#### Core Build System (ALL SIMULATED):
- `src/utils/buildExecutor.ts` - **SIMULATION ONLY** - fake npm install and Vite builds
- `src/utils/buildQueueConsumer.ts` - **SIMULATION ONLY** - fake build job processing
- `src/routes/manualBuild.ts` - **SIMULATION ONLY** - fake manual build triggers

#### What Each File Actually Does:
```
buildExecutor.ts:
  ❌ executeNpmInstall() - Generates fake install logs, no real packages
  ❌ executeBuild() - Generates fake build artifacts, no real compilation
  ❌ collectArtifacts() - Creates mock HTML/JS/CSS files
  ❌ uploadArtifactsToR2() - Uploads fake artifacts to R2

buildQueueConsumer.ts:
  ❌ processBuildJob() - Simulates build progress, calls fake executors
  ❌ executeBuildProcess() - Orchestrates fake build stages

manualBuild.ts:
  ❌ manualBuildHandler() - Triggers simulated builds, returns fake status
```

### 🏗️ Architecture for Real Builds:

```
Current (SIMULATION):
Frontend → Cloudflare Workers → Simulated Build Process → Fake Artifacts

Needed (REAL):
Frontend → Cloudflare Workers → GitHub Actions → Real Build Environment
                                      ↓
                              npm install + Vite build
                                      ↓
                              Real Artifacts → R2 Storage
```

### 🛠️ Development Usage:

This simulation system is useful for:
- **Frontend development**: Testing build status UI components
- **API integration**: Testing build status polling and error handling
- **Queue testing**: Verifying build job creation and status updates
- **Error scenario testing**: Simulating various build failure modes

### ⚡ Quick Start:

```bash
# Install dependencies
npm install

# Start development server
wrangler dev

# Trigger a simulated build
curl -X POST http://localhost:8787/api/build/{project_id}

# Check simulated build status
curl http://localhost:8787/api/build/status/{project_id}
```

### 🔍 Identifying Simulations:

Look for these warning indicators in logs:
- `⚠️ SIMULATION:` prefix in log messages
- Console warnings about fake processes
- References to "GitHub Actions integration required"
- Build responses containing `"build_type": "SIMULATION_ONLY"`

### 📋 Migration to Real Builds:

To implement real builds:
1. **Complete TASK-021 to TASK-028** (GitHub Actions integration)
2. **Replace simulation functions** with actual GitHub API calls
3. **Update build orchestration** to trigger real CI/CD pipelines
4. **Modify artifact handling** to process real build outputs
5. **Update error handling** for real build failures

### 🚨 Production Warnings:

- **DO NOT deploy** this simulation system to production expecting real builds
- **Builds will fail** if attempted in production with `NODE_ENV=production`
- **Users will receive fake artifacts** that won't create functional websites
- **GitHub Actions integration is mandatory** for production functionality

---

**Remember: This is a development simulation. Real website builds require external build infrastructure via GitHub Actions.**