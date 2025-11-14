#!/bin/bash
# Test cleanup script for GPTHost Builder
# Removes temporary test artifacts and resets test environment

echo "🧹 Cleaning up test artifacts..."

# Remove temporary R2 test data
if [ -d "./test/.r2" ]; then
    rm -rf ./test/.r2
    echo "✅ Cleaned R2 test storage"
fi

# Remove any test project files
if [ -d "./test/.temp" ]; then
    rm -rf ./test/.temp
    echo "✅ Cleaned temporary test files"
fi

# Kill any hanging processes (if any)
pkill -f "vitest" > /dev/null 2>&1
pkill -f "wrangler dev" > /dev/null 2>&1

echo "✅ Test cleanup completed"
exit 0