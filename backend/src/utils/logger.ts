/**
 * Minimal structured logger. Swap for pino/winston later if needed — the
 * call sites (logger.info('event_name', {...fields})) won't have to change.
 *
 * Per the product brief §45: never log passwords, tokens, license keys, or
 * note/highlight content. Callers should pass only IDs, counts, and status
 * codes — see requireLicense.ts for the pattern (logs a licenseKeyHash, not
 * the key itself).
 */
type Fields = Record<string, unknown>;

function emit(level: 'info' | 'warn' | 'error', event: string, fields: Fields = {}) {
  const entry = { level, event, time: new Date().toISOString(), ...fields };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (event: string, fields?: Fields) => emit('info', event, fields),
  warn: (event: string, fields?: Fields) => emit('warn', event, fields),
  error: (event: string, fields?: Fields) => emit('error', event, fields),
};
