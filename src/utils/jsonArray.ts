/**
 * Utility functions for handling JSON arrays in MySQL with Prisma
 * Since MySQL doesn't support native arrays, we use JSON type
 */

/**
 * Safely get an array from a JSON field
 */
export function getJsonArray<T>(value: any, defaultValue: T[] = []): T[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (value === null || value === undefined) {
    return defaultValue;
  }
  // If it's a string, try to parse it
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : defaultValue;
    } catch {
      return defaultValue;
    }
  }
  return defaultValue;
}

/**
 * Check if a JSON array contains a value
 */
export function jsonArrayContains<T>(jsonArray: any, value: T): boolean {
  const array = getJsonArray<T>(jsonArray);
  return array.includes(value);
}

/**
 * Add a value to a JSON array (avoiding duplicates)
 */
export function jsonArrayAdd<T>(jsonArray: any, value: T): T[] {
  const array = getJsonArray<T>(jsonArray);
  if (!array.includes(value)) {
    return [...array, value];
  }
  return array;
}

/**
 * Remove a value from a JSON array
 */
export function jsonArrayRemove<T>(jsonArray: any, value: T): T[] {
  const array = getJsonArray<T>(jsonArray);
  return array.filter((item) => item !== value);
}

