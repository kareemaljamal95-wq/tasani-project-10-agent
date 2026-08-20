import { beforeEach, afterEach, afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
  createTestUser,
  giveTestSubscription,
  resetDatabase,
} from './helpers';
import { __setDiscoveryProvider } from '@/lib/discovery';
import { runDiscoveryScan } from '@/lib/discovery/scan';
import {
  DiscoveryUnavailableError,
  type DiscoveredBusiness,
  type DiscoveryProvider,
} from '@/lib/discovery/provider';
import { EntitlementError } from '@/lib/billing/entitlements';
import { UsageLimitError, USAGE_METRIC, DISCOVERY_METRIC } from '@/lib/billing/usage';
import { parseDiscoverySearch } from '@/lib/automation';

/**
 * Discovery is substituted at the network boundary, not by mocking the scan.
 * The dedup, the entitlement, the metering and the import are the things under
 * test, so all of them run for real against the database.
 */
const BUSINESSES: DiscoveredBusiness[] = [
  {
    externalId: 'places/AAA',
    name: 'Riyadh Dental Centre',
    phone: '+966 11 000 0001',
    website: 'https://example.test/a',
    address: 'King Fahd Rd, Riyadh',
    category: 'dentist',
    rating: 4.4,
    ratingCount: 210,
  },
  {
    // No phone, no website — the ordinary case a directory returns, and the
    // reason dedup cannot depend on email.
    externalId: 'places/BBB',
    name: 'Smile Clinic',
  },
];

class FakeProvider implements DiscoveryProvider {
  readonly name = 'google_places';
  calls = 0;

  constructor(
    private readonly configured = true,
    private readonly results = BUSINESSES,
  ) {}

  isConfigured(): boolean {
    return this.configured;
  }

  async search(): Promise<DiscoveredBusiness[]> {
    this.calls += 1;
    return this.results;
  }
}

beforeEach(async () => {
  await resetDatabase();
  __setDiscoveryProvider(new FakeProvider());
});

afterEach(() => {
  __setDiscoveryProvider(null);
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('discovery scan', () => {
  it('imports discovered businesses as leads', async () => {
    const user = await createTestUser();
    await giveTestSubscription(user.id);

    const result = await runDiscoveryScan({
      userId: user.id,
      actor: user.email,
      query: 'dental clinic',
      location: 'Riyadh',
    });

    expect(result.found).toBe(2);
    expect(result.imported).toBe(2);

    const leads = await prisma.lead.findMany({
      where: { userId: user.id },
      orderBy: { companyName: 'asc' },
    });

    expect(leads.map((l) => l.companyName)).toEqual([
      'Riyadh Dental Centre',
      'Smile Clinic',
    ]);
    expect(leads[0].externalSource).toBe('google_places');
    expect(leads[0].assignedAgent).toBe('DISCOVERY');

    // Nothing may invent contact details the source did not publish.
    const smile = leads.find((l) => l.companyName === 'Smile Clinic')!;
    expect(smile.email).toBeNull();
    expect(smile.phone).toBeNull();
    expect(smile.website).toBeNull();
  });

  it('imports nothing on a re-scan of the same businesses', async () => {
    // The regression this guards: Lead is unique on (userId, email), email is
    // null for a directory listing, and Postgres does not collide NULLs — so
    // without (userId, externalSource, externalId) every scheduled scan would
    // duplicate the entire result set.
    const user = await createTestUser();
    await giveTestSubscription(user.id);

    const first = await runDiscoveryScan({
      userId: user.id,
      actor: user.email,
      query: 'dental clinic',
      location: 'Riyadh',
    });
    const second = await runDiscoveryScan({
      userId: user.id,
      actor: user.email,
      query: 'dental clinic',
      location: 'Riyadh',
    });

    expect(first.imported).toBe(2);
    expect(second.imported).toBe(0);
    expect(second.duplicates).toBe(2);
    expect(await prisma.lead.count({ where: { userId: user.id } })).toBe(2);
  });

  it('keeps the same business separate for two accounts', async () => {
    const first = await createTestUser();
    const second = await createTestUser();
    await giveTestSubscription(first.id);
    await giveTestSubscription(second.id);

    await runDiscoveryScan({
      userId: first.id,
      actor: first.email,
      query: 'dental clinic',
      location: 'Riyadh',
    });
    const other = await runDiscoveryScan({
      userId: second.id,
      actor: second.email,
      query: 'dental clinic',
      location: 'Riyadh',
    });

    expect(other.imported).toBe(2);
    expect(await prisma.lead.count({ where: { userId: second.id } })).toBe(2);
  });

  it('refuses a plan without discovery and writes nothing', async () => {
    const user = await createTestUser();
    await giveTestSubscription(user.id, 'starter');

    await expect(
      runDiscoveryScan({
        userId: user.id,
        actor: user.email,
        query: 'dental clinic',
        location: 'Riyadh',
      }),
    ).rejects.toBeInstanceOf(EntitlementError);

    expect(await prisma.lead.count({ where: { userId: user.id } })).toBe(0);
  });

  it('fails closed with no provider configured, and writes nothing', async () => {
    __setDiscoveryProvider(new FakeProvider(false));

    const user = await createTestUser();
    await giveTestSubscription(user.id);

    await expect(
      runDiscoveryScan({
        userId: user.id,
        actor: user.email,
        query: 'dental clinic',
        location: 'Riyadh',
      }),
    ).rejects.toBeInstanceOf(DiscoveryUnavailableError);

    expect(await prisma.lead.count({ where: { userId: user.id } })).toBe(0);

    // An unconfigured instance must not bill for the scan it could not run.
    const counter = await prisma.usageCounter.findFirst({
      where: { userId: user.id, metric: DISCOVERY_METRIC },
    });
    expect(counter).toBeNull();
  });

  it('meters scans separately from AI actions', async () => {
    const user = await createTestUser();
    await giveTestSubscription(user.id);

    await runDiscoveryScan({
      userId: user.id,
      actor: user.email,
      query: 'dental clinic',
      location: 'Riyadh',
    });

    const discovery = await prisma.usageCounter.findFirst({
      where: { userId: user.id, metric: DISCOVERY_METRIC },
    });
    const ai = await prisma.usageCounter.findFirst({
      where: { userId: user.id, metric: USAGE_METRIC },
    });

    expect(discovery?.count).toBe(1);
    // A directory lookup is not a model call and must not appear on the AI bill.
    expect(ai).toBeNull();
  });

  it('refuses once the scan budget is spent', async () => {
    const user = await createTestUser();
    await giveTestSubscription(user.id, 'growth'); // discovery.monthly = 50

    const period = await prisma.subscription.findFirstOrThrow({
      where: { userId: user.id },
    });

    await prisma.usageCounter.create({
      data: {
        userId: user.id,
        periodKey: period.currentPeriodStart!.toISOString().slice(0, 10),
        periodStart: period.currentPeriodStart!,
        periodEnd: period.currentPeriodEnd!,
        metric: DISCOVERY_METRIC,
        count: 50,
      },
    });

    await expect(
      runDiscoveryScan({
        userId: user.id,
        actor: user.email,
        query: 'dental clinic',
        location: 'Riyadh',
      }),
    ).rejects.toBeInstanceOf(UsageLimitError);

    // The refused reservation is rolled back, not left charged.
    const counter = await prisma.usageCounter.findFirstOrThrow({
      where: { userId: user.id, metric: DISCOVERY_METRIC },
    });
    expect(counter.count).toBe(50);
    expect(await prisma.lead.count({ where: { userId: user.id } })).toBe(0);
  });

  it('records the scan in the audit log', async () => {
    const user = await createTestUser();
    await giveTestSubscription(user.id);

    await runDiscoveryScan({
      userId: user.id,
      actor: user.email,
      query: 'dental clinic',
      location: 'Riyadh',
    });

    const audit = await prisma.auditLog.findFirst({
      where: { userId: user.id, type: 'discovery_scan' },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actor).toBe(user.email);
  });
});

describe('discovery search parsing', () => {
  it('splits query from location', () => {
    expect(parseDiscoverySearch('dental clinic @ Riyadh')).toEqual({
      query: 'dental clinic',
      location: 'Riyadh',
    });
  });

  it('rejects a search with no location', () => {
    expect(parseDiscoverySearch('dental clinic')).toBeNull();
    expect(parseDiscoverySearch('dental clinic @ ')).toBeNull();
  });
});
