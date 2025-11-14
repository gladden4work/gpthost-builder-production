/**
 * ServiceMetrics - Centralized metrics collection for service operations
 * Part 4 of DAY3-TDD-STRATEGY implementation
 * Tracks operation duration, success/failure counts, and calculates averages
 */

export interface SlowOperation {
  service: string;
  operation: string;
  avgDuration: number;
  count: number;
}

/**
 * Static class for collecting and aggregating service metrics
 * Thread-safe for concurrent operations using Map
 */
export class ServiceMetrics {
  private static metrics = new Map<string, number>();

  /**
   * Record metrics for a service operation
   * @param service - Name of the service (e.g., 'StorageService')
   * @param operation - Operation name (e.g., 'uploadFile')
   * @param duration - Operation duration in milliseconds
   * @param success - Whether the operation succeeded
   */
  static recordOperation(
    service: string,
    operation: string,
    duration: number,
    success: boolean
  ): void {
    const status = success ? 'success' : 'failure';
    const countKey = `${service}.${operation}.${status}.count`;
    const durationKey = `${service}.${operation}.${status}.duration`;
    
    // Update count
    const currentCount = this.metrics.get(countKey) || 0;
    this.metrics.set(countKey, currentCount + 1);
    
    // Update total duration
    const currentDuration = this.metrics.get(durationKey) || 0;
    this.metrics.set(durationKey, currentDuration + duration);
  }

  /**
   * Get all collected metrics with calculated averages
   * @returns Record of metric keys to values, including averages
   */
  static getMetrics(): Record<string, number> {
    const result: Record<string, number> = {};
    
    // Copy all metrics
    for (const [key, value] of this.metrics) {
      result[key] = value;
      
      // Calculate averages for duration metrics
      if (key.endsWith('.duration')) {
        const countKey = key.replace('.duration', '.count');
        const count = this.metrics.get(countKey) || 1; // Avoid division by zero
        const avgKey = key.replace('.duration', '.avg');
        result[avgKey] = value / count;
      }
    }
    
    return result;
  }

  /**
   * Clear all collected metrics
   * Useful for testing and metric reset
   */
  static clear(): void {
    this.metrics.clear();
  }

  /**
   * Get operations that exceed a specified duration threshold
   * @param thresholdMs - Threshold in milliseconds
   * @returns Array of slow operations with their average durations
   */
  static getSlowOperations(thresholdMs: number): SlowOperation[] {
    const slowOps: SlowOperation[] = [];
    const processedOps = new Set<string>();
    
    for (const [key] of this.metrics) {
      // Extract service.operation from keys like "StorageService.uploadFile.success.count"
      const parts = key.split('.');
      if (parts.length >= 4 && parts[3] === 'count') {
        const service = parts[0];
        const operation = parts[1];
        const status = parts[2];
        const opKey = `${service}.${operation}.${status}`;
        
        if (!processedOps.has(opKey)) {
          processedOps.add(opKey);
          
          const durationKey = `${service}.${operation}.${status}.duration`;
          const countKey = `${service}.${operation}.${status}.count`;
          
          const totalDuration = this.metrics.get(durationKey) || 0;
          const count = this.metrics.get(countKey) || 1;
          const avgDuration = totalDuration / count;
          
          if (avgDuration > thresholdMs) {
            // Check if this service.operation combo is already added
            const existingOp = slowOps.find(
              op => op.service === service && op.operation === operation
            );
            
            if (!existingOp) {
              slowOps.push({
                service,
                operation,
                avgDuration,
                count
              });
            }
          }
        }
      }
    }
    
    return slowOps;
  }

  /**
   * Calculate success rate for a specific service operation
   * @param service - Service name
   * @param operation - Operation name
   * @returns Success rate between 0 and 1, or null if no data
   */
  static getSuccessRate(service: string, operation: string): number | null {
    const successCountKey = `${service}.${operation}.success.count`;
    const failureCountKey = `${service}.${operation}.failure.count`;
    
    const successCount = this.metrics.get(successCountKey) || 0;
    const failureCount = this.metrics.get(failureCountKey) || 0;
    const totalCount = successCount + failureCount;
    
    if (totalCount === 0) {
      return null; // No data for this operation
    }
    
    return successCount / totalCount;
  }

  /**
   * Get aggregate metrics for a specific service
   * @param service - Service name
   * @returns Aggregated metrics for the service
   */
  static getServiceMetrics(service: string): Record<string, number> {
    const result: Record<string, number> = {};
    const metrics = this.getMetrics();
    
    for (const [key, value] of Object.entries(metrics)) {
      if (key.startsWith(`${service}.`)) {
        result[key] = value;
      }
    }
    
    return result;
  }

  /**
   * Get total operation count across all services
   * @returns Total number of operations recorded
   */
  static getTotalOperationCount(): number {
    let total = 0;
    
    for (const [key, value] of this.metrics) {
      if (key.endsWith('.count')) {
        total += value;
      }
    }
    
    return total;
  }

  /**
   * Get average duration across all operations
   * @returns Average duration in milliseconds
   */
  static getOverallAverageDuration(): number {
    let totalDuration = 0;
    let totalCount = 0;
    
    for (const [key, value] of this.metrics) {
      if (key.endsWith('.duration')) {
        totalDuration += value;
      } else if (key.endsWith('.count')) {
        totalCount += value;
      }
    }
    
    return totalCount > 0 ? totalDuration / totalCount : 0;
  }
}