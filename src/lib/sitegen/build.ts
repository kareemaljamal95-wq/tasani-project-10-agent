import { randomBytes } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { recordActivity } from '@/lib/activity';
import { requireCapability } from '@/lib/billing/entitlements';
import { consumeSiteBuild } from '@/lib/billing/usage';
import { parseBusiness } from './parse';
import { renderSite } from './render';
import { DEFAULT_THEME, findTheme } from './theme';
import type { BusinessProfile } from './profile';

/**
 * Turning pasted text into a stored, deliverable site.
 *
 * Order mirrors `runDiscoveryScan` and `executeAgent`, and it is deliberate:
 *
 *  1. entitlement — an unentitled account is refused before anything else;
 *  2. parse — a paste that yields nothing usable fails before it is metered,
 *     because charging for an empty result would be charging for our inability
 *     to read it;
 *  3. meter — reserved only once the build is certainly going to happen;
 *  4. render and store.
 *
 * The generated page is never published anywhere. It is a file the owner
 * reviews and delivers, which is why it does not pass through the approval
 * gate: that gate guards what reaches an outside party, and nothing here does.
 */

export interface BuildSiteInput {
  userId: string;
  actor: string;
  raw: string;
  /** Overrides the parsed name — used when the source is a known lead. */
  name?: string;
  leadId?: string;
  themeId?: string;
}

export interface BuildSiteResult {
  id: string;
  name: string;
  theme: string;
  profile: BusinessProfile;
  /** Fields the source did not provide, for the UI to surface immediately. */
  missing: BusinessProfile['missing'];
}

export async function buildSite(
  input: BuildSiteInput,
): Promise<BuildSiteResult> {
  await requireCapability(input.userId, 'leads.enabled');

  const profile = parseBusiness({ raw: input.raw, name: input.name });

  await consumeSiteBuild(input.userId);

  const theme = findTheme(input.themeId ?? DEFAULT_THEME);
  const html = renderSite(profile, { themeId: theme.id });

  // Scoped by userId so a leadId from another account cannot be attached.
  const lead = input.leadId
    ? await prisma.lead.findFirst({
        where: { id: input.leadId, userId: input.userId },
        select: { id: true },
      })
    : null;

  const site = await prisma.generatedSite.create({
    data: {
      userId: input.userId,
      leadId: lead?.id ?? null,
      name: profile.name,
      profile: profile as unknown as Prisma.InputJsonValue,
      theme: theme.id,
      html,
    },
    select: { id: true, name: true, theme: true },
  });

  if (lead) {
    await recordActivity({
      userId: input.userId,
      leadId: lead.id,
      type: 'note',
      message: `أُنشئ موقع لـ ${profile.name}.`,
      data: { siteId: site.id, missing: profile.missing },
      actor: input.actor,
    });
  }

  logger.info('Site generated', {
    userId: input.userId,
    siteId: site.id,
    theme: theme.id,
    gaps: profile.missing.length,
  });

  return { ...site, profile, missing: profile.missing };
}

/** Sites the caller owns. A guessed id belongs to no one. */
export function listSites(userId: string, limit = 50) {
  return prisma.generatedSite.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 100),
    select: {
      id: true,
      name: true,
      theme: true,
      leadId: true,
      createdAt: true,
      profile: true,
    },
  });
}

export function getOwnedSite(id: string, userId: string) {
  return prisma.generatedSite.findFirst({ where: { id, userId } });
}

export async function deleteSite(id: string, userId: string): Promise<boolean> {
  const result = await prisma.generatedSite.deleteMany({
    where: { id, userId },
  });
  return result.count > 0;
}

/**
 * Turns a stored site into a link anyone can open.
 *
 * A generated page is worthless as a pitch while only its owner can see it —
 * the prospect has to open their own finished site, on their own phone, before
 * any of this means anything to them. So sharing is a deliberate act with an
 * unguessable token rather than a permanently public id.
 *
 * Idempotent: re-sharing an already shared site returns the same token, so an
 * owner who sends the link twice does not invalidate the copy already sitting
 * in a prospect's messages.
 */
export async function shareSite(
  id: string,
  userId: string,
): Promise<{ token: string; alreadyShared: boolean } | null> {
  const site = await getOwnedSite(id, userId);
  if (!site) return null;

  if (site.shareToken) {
    return { token: site.shareToken, alreadyShared: true };
  }

  // 192 bits from a CSPRNG. The token is the whole access control for this
  // page, so it has to be unguessable rather than merely unique.
  const token = randomBytes(24).toString('base64url');

  await prisma.generatedSite.updateMany({
    where: { id, userId },
    data: { shareToken: token, sharedAt: new Date() },
  });

  logger.info('Site shared', { userId, siteId: id });

  return { token, alreadyShared: false };
}

/**
 * Withdraws a share link.
 *
 * `sharedAt` is deliberately kept: the owner should still be able to see that
 * a page was once public, which a cleared timestamp would hide.
 */
export async function unshareSite(id: string, userId: string): Promise<boolean> {
  const result = await prisma.generatedSite.updateMany({
    where: { id, userId },
    data: { shareToken: null },
  });

  return result.count > 0;
}

/**
 * Serves a shared page to whoever holds the link.
 *
 * The only read in this module not scoped by `userId`, because a prospect has
 * no account — which is the entire point. It is safe for one reason: the token
 * is the credential, a revoked token is null and `null` never matches here.
 */
export function getSharedSite(token: string) {
  if (!token) return null;

  return prisma.generatedSite.findUnique({
    where: { shareToken: token },
    select: { id: true, name: true, html: true },
  });
}

/**
 * Re-renders a stored site under a different theme.
 *
 * Reads the stored profile rather than re-parsing, which is why the profile is
 * kept beside the html: changing a theme must not require the owner to find
 * and paste the original listing again. Not metered — no new site is created.
 */
export async function retheme(
  id: string,
  userId: string,
  themeId: string,
): Promise<boolean> {
  const site = await getOwnedSite(id, userId);
  if (!site) return false;

  const theme = findTheme(themeId);
  const profile = site.profile as unknown as BusinessProfile;

  await prisma.generatedSite.updateMany({
    where: { id, userId },
    data: { theme: theme.id, html: renderSite(profile, { themeId: theme.id }) },
  });

  return true;
}
