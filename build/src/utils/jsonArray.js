"use strict";
/**
 * Utility functions for handling JSON arrays in MySQL with Prisma
 * Since MySQL doesn't support native arrays, we use JSON type
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getJsonArray = getJsonArray;
exports.jsonArrayContains = jsonArrayContains;
exports.jsonArrayAdd = jsonArrayAdd;
exports.jsonArrayRemove = jsonArrayRemove;
/**
 * Safely get an array from a JSON field
 */
function getJsonArray(value, defaultValue = []) {
    // Already an array
    if (Array.isArray(value))
        return value;
    // Null or undefined
    if (value == null)
        return defaultValue;
    // Try parsing string
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : defaultValue;
        }
        catch {
            return defaultValue;
        }
    }
    // Any other type
    return defaultValue;
}
/**
 * Check if a JSON array contains a value
 */
function jsonArrayContains(jsonArray, value) {
    return getJsonArray(jsonArray).includes(value);
}
/**
 * Add a value to a JSON array (avoiding duplicates)
 */
function jsonArrayAdd(jsonArray, value) {
    const array = getJsonArray(jsonArray);
    return array.includes(value) ? array : [...array, value];
}
/**
 * Remove a value from a JSON array
 */
function jsonArrayRemove(jsonArray, value) {
    return getJsonArray(jsonArray).filter((item) => item !== value);
}
//# sourceMappingURL=jsonArray.js.map