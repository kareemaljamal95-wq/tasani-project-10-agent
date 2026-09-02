import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  clientIp,
  handleRouteError,
  parseBody,
  rateLimit,
  requireUser,
} from '@/lib/api/guard';
import {
  deleteSite,
  getOwnedSite,
  retheme,
  shareSite,
  unshareSite,
  THEMES,
} from '@/lib/sitegen';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * A PATCH either restyles the page or changes who can open it. They are one
 * route because they are one resource, and a union keeps a body that means
 * both from parsing at all.
 */
const patchSchema = z.union([
  z.object({ themeId: z.enum(THEMES.map((t) => t.id) as [string, ...string[]]) }),
  z.object({ share: z.boolean() }),
]);

/**
 * The generated page itself.
 *
 * Returns HTML rather than JSON so the owner can open it, and sends
 * `X-Content-Type-Options: nosniff` with an attachment disposition on request.
 * A site belonging to another account reads as not-found, like every other
 * resource here.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireUser();
    rateLimit(`site:${session.userId}:${clientIp(req)}`);

    const { id } = await params;
    const site = await getOwnedSite(id, session.userId);

    if (!site) {
      return NextResponse.json({ error: 'Site not found.' }, { status: 404 });
    }

    const download = new URL(req.url).searchParams.get('download') === '1';

    return new NextResponse(site.html, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'x-content-type-options': 'nosniff',
        ...(download
          ? {
              'content-disposition': `attachment; filename="${encodeURIComponent(site.name)}.html"`,
            }
          : {}),
      },
    });
  } catch (error) {
    return handleRouteError(error, 'GET /api/sites/[id]');
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireUser();
    rateLimit(`site:${session.userId}:${clientIp(req)}`);

    const { id } = await params;
    const body = await parseBody(req, patchSchema);

    if ('share' in body) {
      if (!body.share) {
        if (!(await unshareSite(id, session.userId))) {
          return NextResponse.json({ error: 'Site not found.' }, { status: 404 });
        }
        return NextResponse.json({ ok: true, shared: false });
      }

      const shared = await shareSite(id, session.userId);

      if (!shared) {
        return NextResponse.json({ error: 'Site not found.' }, { status: 404 });
      }

      // The absolute URL is built here, not in the browser: the owner pastes
      // this into a message, and a relative path is useless there.
      return NextResponse.json({
        ok: true,
        shared: true,
        url: `${env().NEXT_PUBLIC_APP_URL}/s/${shared.token}`,
        alreadyShared: shared.alreadyShared,
      });
    }

    // Not metered: re-rendering a stored profile creates no new site.
    const changed = await retheme(id, session.userId, body.themeId);

    if (!changed) {
      return NextResponse.json({ error: 'Site not found.' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, themeId: body.themeId });
  } catch (error) {
    return handleRouteError(error, 'PATCH /api/sites/[id]');
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await requireUser();
    rateLimit(`site:${session.userId}:${clientIp(req)}`);

    const { id } = await params;

    if (!(await deleteSite(id, session.userId))) {
      return NextResponse.json({ error: 'Site not found.' }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return handleRouteError(error, 'DELETE /api/sites/[id]');
  }
}
