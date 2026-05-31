/**
 * Simple unique ID generator (similar to snowflake).
 * Generates a 53-bit integer string that's unique within a process.
 * Format: timestamp(42bits) + random(11bits) = safe JavaScript integer
 */
let lastTime = 0;
let counter = 0;

export function generateBatchId(): number {
  const now = Date.now();
  if (now === lastTime) {
    counter++;
  } else {
    lastTime = now;
    counter = 0;
  }
  // Combine timestamp and counter to ensure uniqueness
  const id = BigInt(now) * BigInt(2048) + BigInt(counter);
  return Number(id);
}