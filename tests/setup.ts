/**
 * Test environment.
 *
 * DATABASE_URL must point at a throwaway database — the suite truncates
 * tables between tests. AUTH_SECRET and the limits are set here so env()
 * validation passes without a .env file.
 */
const defaults: Record<string, string> = {
  DATABASE_URL: 'postgresql://postgres@localhost/tasami_test?host=/tmp',
  AUTH_SECRET:
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
  RATE_LIMIT_MAX: '10000',
  AUTH_RATE_LIMIT_MAX: '10000',
};

for (const [key, value] of Object.entries(defaults)) {
  if (!process.env[key]) process.env[key] = value;
}
