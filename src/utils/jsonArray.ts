/**
 * Utility functions for handling JSON arrays in MySQL with Prisma
 * Since MySQL doesn't support native arrays, we use JSON type
 */

/**
 * Safely get an array from a JSON field
 */
export function getJsonArray<T>(value: any, defaultValue: T[] = []): T[] {
  // Already an array
  if (Array.isArray(value)) return value;
  
  // Null or undefined
  if (value == null) return defaultValue;
  
  // Try parsing string
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : defaultValue;
    } catch {
      return defaultValue;
    }
  }
  
  // Any other type
  return defaultValue;
}

/**
 * Check if a JSON array contains a value
 */
export function jsonArrayContains<T>(jsonArray: any, value: T): boolean {
  return getJsonArray<T>(jsonArray).includes(value);
}

/**
 * Add a value to a JSON array (avoiding duplicates)
 */
export function jsonArrayAdd<T>(jsonArray: any, value: T): T[] {
  const array = getJsonArray<T>(jsonArray);
  return array.includes(value) ? array : [...array, value];
}

/**
 * Remove a value from a JSON array
 */
export function jsonArrayRemove<T>(jsonArray: any, value: T): T[] {
  return getJsonArray<T>(jsonArray).filter((item) => item !== value);
}
