/**
 * Handler wrapper for test compatibility
 * 
 * This module exports the existing uploadHandler as handleUpload
 * to match the expectations of the API-First TDD test suite.
 */

export { uploadHandler as handleUpload } from '../routes/upload';