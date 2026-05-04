const TOLERANCE = 0.001;

/**
 * Deep equality check with numeric tolerance for floating-point comparisons.
 * Returns true if structures are equivalent within TOLERANCE for numbers.
 */
export function deepEqualApprox(a: any, b: any): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < TOLERANCE;
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((val, i) => deepEqualApprox(val, b[i]));
  if (a instanceof Object && b instanceof Object) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].every(k => deepEqualApprox(a[k], b[k]));
  }
  return false;
}

/**
 * Return a shallow copy of `obj` with the specified keys removed.
 */
export function omitKeys<T extends object, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> {
  const clone = { ...obj };
  for (const k of keys) delete clone[k];
  return clone;
}

/**
 * Recursively touch every property (useful for reactive traversal).
 */
export function touchDeep(obj: any): void {
  if (Array.isArray(obj)) obj.forEach(touchDeep);
  else if (obj instanceof Object) Object.values(obj).forEach(touchDeep);
}

