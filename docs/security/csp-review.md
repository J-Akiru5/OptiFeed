# CSP review

Question: which policy is actually enforced, what does it block, and is a change needed?

Answer in one line: the **enforcing** `Content-Security-Policy` header is the one served and
applied; the `Content-Security-Policy-Report-Only` header blocks nothing and reports to nowhere.
The enforcing policy covers `script-src`, `base-uri`, `frame-ancestors` and `form-action`, but it
is **missing `object-src`**, and its `script-src` allows inline script. The minimal change is one
directive, `object-src 'none'`; the report-only policy must not be promoted to enforcing without a
nonce-based rewrite and a full regression run.

Evidence base: `apps/web/next.config.ts` (the only CSP definition in the application),
`apps/web/lib/__tests__/next-config-headers.test.ts` (asserts the declared values), and a
repository-wide search for other CSP sources. Reviewed 2026-10-29 against `origin/develop`
@ `8eb6ce4` (v1.29.0).

---

## 1. What is declared

`apps/web/next.config.ts` builds one shared directive list and attaches two headers to every
response (`headers()` with `source: "/(.*)"`):

| Header | `script-src` | Other directives |
| --- | --- | --- |
| `Content-Security-Policy` (enforcing) | `'self' 'unsafe-inline' https://va.vercel-scripts.com` (+ `'unsafe-eval'` in development) | `default-src 'self'`, `style-src 'self' 'unsafe-inline'`, `img-src 'self' data: blob: https://images.unsplash.com https://*.supabase.co`, `font-src 'self'`, `connect-src 'self' https://*.supabase.co wss://*.supabase.co`, `form-action 'self'`, `base-uri 'self'`, `frame-ancestors 'none'` |
| `Content-Security-Policy-Report-Only` | `'self' https://va.vercel-scripts.com` (+ `'unsafe-eval'` in development) | The same list |

Two details that answer "which one applies":

1. **Only `Content-Security-Policy` is enforced.** `Report-Only` is a separate header: the browser
   evaluates it and never blocks a request because of it. If both were enforcing, the browser
   would apply the intersection (most restrictive) of the two; because one is report-only, the
   permissive `'unsafe-inline'` policy is what actually governs scripts.
2. **The report-only policy has no `report-uri` and no `report-to`.** Its violations go to the
   browser console for whoever is watching, and nowhere else. No violation data is collected
   today, so the stricter policy is an unvalidated intention, not a measured control.

No other part of the app sets a CSP: there is no `<meta http-equiv="Content-Security-Policy">`,
no header in `apps/web/proxy.ts`, and `apps/web/vercel.json` only sets cache headers for `/sw.js`
and `/offline.html`. The unit test in `next-config-headers.test.ts` covers `form-action`,
`base-uri` and the report-only shape, so a silent change to those values fails CI.

---

## 2. What the enforced policy blocks

| Directive | Effect in production | Bypassable? |
| --- | --- | --- |
| `script-src 'self' …` | External scripts only from our origin and `va.vercel-scripts.com` (Vercel Analytics/Speed Insights, both installed). A third-party CDN script or a compromised third-party widget is blocked. | An injected **inline** `<script>` runs because of `'unsafe-inline'`. |
| `default-src 'self'` | Fallback for `object-src`, `frame-src`, `media-src`, `worker-src`, `manifest-src`: same-origin only. | Same-origin objects are allowed (see §3). |
| `connect-src` | `fetch`/XHR/WebSocket to our origin and `*.supabase.co` only. Exfiltration to `https://attacker.example` is blocked. | **Any** Supabase project is allowed (`https://*.supabase.co`), not just ours; an XSS could write to an attacker-owned Supabase project. |
| `img-src` | Images from our origin, `data:`, `blob:`, Unsplash and `*.supabase.co`. Image-beacon exfiltration elsewhere is blocked. | Same Supabase wildcard caveat as `connect-src`. |
| `style-src`, `font-src` | Inline styles allowed (Tailwind/React need them); fonts only from our origin. | `'unsafe-inline'` styles can be abused for UI redress, not for script execution. |
| `base-uri 'self'` | An injected `<base href>` cannot repoint every relative URL to another origin. | No. |
| `form-action 'self'` | An injected form cannot POST credentials or data to another origin. | No. |
| `frame-ancestors 'none'` | The app cannot be embedded in a frame (clickjacking), matching `X-Frame-Options: DENY`. | No. |
| `object-src` (absent) | Falls back to `default-src 'self'` → a same-origin `<object>`/`<embed>` is allowed; a remote one is blocked. | Same-origin plugin content. |

Also worth stating plainly: **`'unsafe-inline'` in `script-src` is the dominant weakness.** The
policy still stops a remote script from running and stops the common exfiltration channels
(`connect-src`, `img-src`, `form-action`), but a server-side or stored XSS that injects an inline
`<script>` executes inside the page. CSP is not the primary XSS defence here; React's escaping and
the audit/guard discipline are. `'unsafe-eval'` is absent in production and only added when
`NODE_ENV=development`.

---

## 3. The gap that matters: `object-src`

`object-src` is the only one of the five directives in the review scope that is **missing**:

| Directive | Present? | Comment |
| --- | --- | --- |
| `script-src` | Yes | Present but weakened by `'unsafe-inline'`; fixing that is a separate, larger change. |
| `object-src` | **No** | Falls back to `default-src 'self'`; same-origin `<object>`/`<embed>`/legacy plugin content is permitted. |
| `base-uri` | Yes | `'self'`. |
| `frame-ancestors` | Yes | `'none'`, plus `X-Frame-Options: DENY`. |
| `form-action` | Yes | `'self'`. |

Why it matters: plugin content is an execution context that CSP otherwise does not govern, and
`object-src 'none'` is the cheapest way to close it. The fallback to `default-src 'self'` means the
gap only opens if an attacker can get same-origin content served as an object — plausible with an
upload/serve path, not currently reachable through the private Storage buckets.

Evidence that closing it cannot break the app:

- A repository-wide search of `apps/web` found **no `<object>`, `<embed>` or `<iframe>`** element.
- PDFs are generated in the browser with `jspdf` and downloaded; they are not embedded as objects.
- The 3D feeder viewer renders into a WebGL `<canvas>` (`@react-three/fiber`), not a plugin.
- The Vercel Analytics scripts are `<script>` elements, unaffected by `object-src`.

### Proposed change (one line, not applied in this workstream)

```diff
 const cspDirectives = [
 	"default-src 'self'",
+	// Plugins are an execution context CSP otherwise does not govern; nothing
+	// in the app embeds one.
+	"object-src 'none'",
 	"style-src 'self' 'unsafe-inline'",
```

Because `cspDirectives` is shared, the directive lands in both the enforcing and the report-only
policy. It does not change any test expectation, and when it is applied the existing
`next-config-headers.test.ts` should gain one assertion:

```ts
expect(csp).toContain("object-src 'none'");
```

Risk: **negligible**. The only way it breaks a page is a future feature that embeds a same-origin
object/plugin; that feature would have to add its source explicitly (or use an `<iframe>`, which
`frame-src`/`default-src` already constrain). It cannot affect third-party PDF viewing, because
that is a top-level navigation or a download, not an embed.

Optional, lower value: `frame-src 'none'` (no iframes exist today) and
`upgrade-insecure-requests` (the app is HTTPS-only behind HSTS). Neither is required.

---

## 4. Why the report-only policy is not promoted

The stricter policy differs in exactly one directive: it removes `'unsafe-inline'` from
`script-src`. Next.js App Router pages ship inline scripts for the RSC payload and hydration
bootstrap (`self.__next_f.push(...)`); without a nonce or hash those are blocked, and the page
either fails to hydrate or renders blank. The comment in `next.config.ts` records that reasoning.

Promoting it today would therefore be a guess, not a fix, and the evidence needed to de-risk the
guess does not exist:

- No violation reports have ever been collected (no `report-uri`/`report-to`), so the full set of
  inline scripts and eval uses in production is unknown.
- Enforcing would need a nonce generated per request (a middleware/proxy CSP), `'strict-dynamic'`
  or hashes, and a full Playwright run across the main flows. None of that is in place.

The correct sequence is: collect violations on a real deployment → rewrite the policy with a nonce
→ verify in a preview deployment with the E2E suite → then enforce. Until then the report-only
header stays report-only. This document does not authorise flipping it.

If violation data is wanted, the smallest useful step is a `report-uri` pointing at a same-origin
route that rate-limits and stores the reports (CSP reports are attacker-controllable input — they
need the same treatment as any other untrusted body). That is a separate feature, not part of this
review.

---

## 5. Verification status

| Claim | How it was checked | Status |
| --- | --- | --- |
| Both headers are declared and applied to `/(.*)` | Read `next.config.ts`; `headers()` returns one rule for `/(.*)`; unit test reads the same function | **Static, verified** |
| The enforcing policy is the one with `'unsafe-inline'` | Read the two header values in `next.config.ts` | **Static, verified** |
| No other CSP source exists | Repository search for `Content-Security-Policy` (only `next.config.ts` and the test) | **Static, verified** |
| None of the five directives is missing except `object-src` | Parsed the directive list in `next.config.ts` | **Static, verified** |
| No `<object>`/`<embed>`/`<iframe>` in the app | Repository search of `apps/web/**/*.tsx` | **Static, verified** |
| The headers are actually served by the running deployment | Not verified here — no production access in this workstream, and a local `next build` was deferred under resource pressure | **Unverified** — the owner can confirm with `curl -sI https://pakaonai.syntaxure.dev \| grep -i '^content-security-policy'` |
| The report-only policy would break the app if enforced | Inferred from the Next.js inline bootstrap and the config comment; no violation data | **Not measured** |

The runtime check matters because a reverse proxy or platform setting could strip or add headers.
Nothing in the repository does, but only a live response proves it.
