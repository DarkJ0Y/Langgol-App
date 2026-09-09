/**
 * The application's only way to the bytes of a KYC document.
 *
 * The object store holds these under a folder the adapter refuses to produce a public URL for, so
 * no path through Langgol reaches them without passing here — and here re-verifies the grant, the
 * viewer and their live authorization on every request.
 *
 * That is a statement about this codebase, not about the bucket. The storage adapter runs as an
 * anonymous principal, so the bucket's own rules must independently deny direct access to the
 * `kyc-documents/` prefix; see the note in
 * packages/infrastructure/src/crypto/document-grant.ts.
 *
 * ## Why the token is in the path rather than a query string
 *
 * Query strings are logged by proxies, CDNs and analytics far more readily than paths are, and
 * they travel in `Referer` headers. Neither is a strong protection on its own, which is why the
 * grant expires in minutes and names its viewer — but a credential does not belong in the part of
 * a URL that is most likely to be written down.
 *
 * ## Headers
 *
 * `no-store` on every response, including failures. A KYC document must not sit in a shared cache
 * or a browser's disk cache after the reviewer has closed the tab. `Content-Disposition:
 * attachment` and `X-Content-Type-Options: nosniff` together stop the browser rendering the file
 * in the origin's own context, which is what turns an uploaded document into stored cross-site
 * scripting.
 *
 * Refs: docs/07_SECURITY.md §6, §7
 */

import { NextResponse } from 'next/server'
import { serveDocument } from '@langgol/application'
import { isErr } from '@langgol/shared'
import { kycDeps } from '@/lib/deps'
import { currentActor } from '@/lib/guard'

/** Never cached, never stored, never guessed at by a sniffing browser. */
const SAFE_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, private',
  Pragma: 'no-cache',
  'X-Content-Type-Options': 'nosniff',
  // Nothing on this response may be framed or scripted, whatever it turns out to contain.
  'Content-Security-Policy': "default-src 'none'; sandbox",
  'Referrer-Policy': 'no-referrer',
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await context.params
  const actor = await currentActor()

  /*
   * A malformed percent-escape makes `decodeURIComponent` throw, which would surface as a 500 —
   * a different answer from every other failure here, and therefore a signal. The uniform 404 is
   * the whole point of this handler's error strategy, so a bad escape joins it.
   */
  let decoded: string
  try {
    decoded = decodeURIComponent(token)
  } catch {
    return new NextResponse(null, { status: 404, headers: SAFE_HEADERS })
  }

  const result = await serveDocument(actor, decoded, await kycDeps())

  /*
   * One answer for every failure.
   *
   * Forged, expired, presented by the wrong person, or pointing at a record that does not exist —
   * all 404. Distinguishing them would tell a prober which part of their guess was right, and the
   * use case has already recorded the interesting cases in the audit log.
   */
  if (isErr(result)) {
    return new NextResponse(null, { status: 404, headers: SAFE_HEADERS })
  }

  return new NextResponse(new Uint8Array(result.value.data), {
    status: 200,
    headers: {
      ...SAFE_HEADERS,
      'Content-Type': result.value.contentType,
      'Content-Length': String(result.value.data.byteLength),
      // `attachment` rather than `inline`: the browser saves it instead of rendering it in the
      // origin's context, which is what stops an uploaded file becoming stored XSS.
      'Content-Disposition': 'attachment; filename="document"',
    },
  })
}
