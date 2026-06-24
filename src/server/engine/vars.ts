// Environment variable substitution for UI test executors.
//
// Replaces ${varName} placeholders in natural-language steps, YAML flows,
// preconditions, and assertion text with values from the active environment.
// Unmatched placeholders are left as-is so the user can see what's missing.

/**
 * Replace ${varName} placeholders in a string with values from the map.
 * Unmatched placeholders are preserved unchanged.
 */
export function substituteVars(text: string, vars: Record<string, string>): string {
  if (!text || Object.keys(vars).length === 0) return text;
  return text.replace(/\$\{([^}]+)\}/g, (_, key: string) => {
    const val = vars[key.trim()];
    return val !== undefined ? val : `\${${key}}`;
  });
}
