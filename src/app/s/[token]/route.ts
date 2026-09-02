import { getSharedSite } from '@/lib/sitegen';

export const dynamic = 'force-dynamic';

/**
 * A shared site, served to whoever holds the link.
 *
 * Deliberately unauthenticated: the person who needs to see this page is the
 * business owner being pitched, and they have no account here. That is the
 * whole purpose — a generated site nobody outside the account can open is not
 * a deliverable, it is a file.
 *
 * The token is the credential. It is 192 random bits, it appears in no listing,
 * and revoking sets it to null — which the unique lookup can never match. A
 * guessed or withdrawn token is indistinguishable from one that never existed.
 *
 * Short URL on purpose (`/s/<token>`): this gets pasted into WhatsApp.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const site = await getSharedSite(token);

  if (!site) {
    return new Response('Not found.', {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  return new Response(site.html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Never cached by a shared proxy: revocation has to take effect on the
      // next request, not whenever an intermediary decides to expire it.
      'cache-control': 'private, no-store',
      // The page is self-contained, so nothing here should ever be framed or
      // sniffed into behaving as another type.
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  });
}
