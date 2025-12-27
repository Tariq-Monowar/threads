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
        }
        catch {
            return defaultValue;
        }
    }
    return defaultValue;
}
/**
 * Check if a JSON array contains a value
 */
function jsonArrayContains(jsonArray, value) {
    const array = getJsonArray(jsonArray);
    return array.includes(value);
}
/**
 * Add a value to a JSON array (avoiding duplicates)
 */
function jsonArrayAdd(jsonArray, value) {
    const array = getJsonArray(jsonArray);
    if (!array.includes(value)) {
        return [...array, value];
    }
    return array;
}
/**
 * Remove a value from a JSON array
 */
function jsonArrayRemove(jsonArray, value) {
    const array = getJsonArray(jsonArray);
    return array.filter((item) => item !== value);
}
//# sourceMappingURL=jsonArray.js.map