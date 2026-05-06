/**
 * CSRF defense for browser-cookie-authed mutating endpoints.
 *
 * Modern browsers always send `Origin` on cross-origin requests. We reject any
 * request whose `Origin` does not match the request URL's origin. As a fallback
 * for older clients (and same-origin requests where `Origin` may legitimately
 * be omitted), we also accept a `Referer` whose origin matches.
 *
 * GET/HEAD/OPTIONS are not protected here — they should be side-effect-free.
 */
export function isSameOriginRequest(req: Request): boolean {
  const url = new URL(req.url);
  const expected = url.origin;

  const origin = req.headers.get("origin");
  if (origin) {
    return origin === expected;
  }

  // Origin can be absent on top-level navigations and same-origin GETs in some
  // browsers; for POSTs that's rare but possible. Fall back to Referer.
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin === expected;
    } catch {
      return false;
    }
  }

  // No Origin and no Referer: refuse — we can't prove same-origin.
  return false;
}
