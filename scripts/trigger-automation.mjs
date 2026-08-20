/**
 * Scheduled automation tick.
 *
 * Railway runs this as its own service on a cron schedule, against the same
 * image as the web service. It calls the endpoint a person's click calls, so a
 * scheduled run inherits policy evaluation, the approval gate and the audit
 * trail — an automated run can create a PENDING approval and nothing more.
 *
 * Two constraints shape it:
 *
 *  - It must exit when the cycle finishes. Railway skips a tick if the previous
 *    run is still going, so a long-running loop would starve the schedule.
 *  - It must exit non-zero on failure, so a bad worker key or an unready
 *    instance shows as a failed run instead of a silent success.
 *
 * Plain node with no dependency on purpose: the runner image has no curl, and
 * `npm run worker` needs tsx, a devDependency that `npm ci --omit=dev` leaves
 * out of the image.
 */

const appUrl = process.env.AUTOMATION_TARGET_URL || process.env.NEXT_PUBLIC_APP_URL;
const workerKey = process.env.WORKER_API_KEY;

if (!appUrl) {
  console.error('AUTOMATION_TARGET_URL (or NEXT_PUBLIC_APP_URL) is not set.');
  process.exit(1);
}

if (!workerKey) {
  // Failing closed is the point: without a credential the endpoint answers 401,
  // and a scheduler that treated that as "nothing to do" would hide the fact
  // that automation had stopped running.
  console.error('WORKER_API_KEY is not set; the automation endpoint will refuse.');
  process.exit(1);
}

const endpoint = new URL('/api/automation/run', appUrl).toString();

// Bounded so a hung request cannot hold the slot past the next tick.
const timeout = AbortSignal.timeout(
  Number(process.env.AUTOMATION_TIMEOUT_MS || 240_000),
);

try {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'x-worker-key': workerKey },
    signal: timeout,
  });

  const body = await response.text();

  if (!response.ok) {
    // The body can carry a reason; it never carries the key, which is only ever
    // a request header.
    console.error(`Automation run failed: ${response.status} ${body}`);
    process.exit(1);
  }

  console.log(`Automation run complete: ${body}`);
} catch (error) {
  console.error(`Automation run could not reach ${endpoint}:`, error.message);
  process.exit(1);
}
