---
name: security-signals-audit
description: Check whether a website shows the outward signs of good security posture - HTTPS and HSTS, security headers and CSP quality, cookie flags, leaked secrets and source maps, vulnerable JS libraries, SRI, security.txt, trackers before consent, SPF/DMARC/CAA - passively by default, with owner-only probes. Produces a gate result and a fix list.
---

# Security signals audit

Answers one question: **does this site show the signs of a team that takes security seriously?** It reads only what the site serves to every visitor: response headers, cookies, HTML, the site's own JavaScript, its TLS certificate and its public DNS. It turns that into a pass/fail gate and a fix list.

It reports **signals, not security**. Nobody can certify a site as secure from the outside, so never word a report, badge or listing as "secure". "Shows the signs of good security posture" is accurate and still worth having.

Use when asked to check a site's security posture, headers, CSP, cookies, email authentication (SPF/DMARC), exposed files or source maps, or before a launch. Pair it with `slop-ui-audit` (what a visitor sees, plus the full leak crawl) and `content-structure-audit` (what a crawler reads).

## Tools in this skill

| File | Runs in | Does |
|---|---|---|
| `scripts/security-signals.mjs` | Node 18+, no dependencies | Passive checks across the home page and up to N sitemap pages. Also pulls DNS through DNS-over-HTTPS (Cloudflare) and matches library versions against the retire.js vulnerability repository. `--probe` adds owner-only checks. Writes `security-report.md` and `security.json` |

```bash
node security-signals.mjs https://example.com --pages 10 --out ./security-out
node security-signals.mjs https://example.com --probe        # ONLY on sites you own or are authorised to test
```

## Rules of engagement

- **Passive by default.** Without `--probe`, the script requests only URLs the site advertises (pages, sitemap, its own scripts and their source maps), plus `security.txt` and public DNS. That's safe to run on any public site.
- **`--probe` is owner-only.** It sends requests the site doesn't advertise:
  - common exposed files (`/.env`, `/.git/HEAD`, …), with catch-all-200 detection;
  - directory listings;
  - a Certificate Transparency sweep (crt.sh) for staging or preview hosts that are publicly reachable.

  Run it only with the owner's authorisation, ideally proven by a DNS TXT record or meta tag. Report staging hosts privately, never on a public listing.
- **Never** port scan, fuzz, brute-force, try logins, or send anything that could look like an attack. This keeps the audit clearly within the Computer Misuse Act (UK) and equivalent laws elsewhere, and within the hosting provider's terms.
- **TLS interception.** Behind a corporate or sandbox proxy, the certificate the script sees is the proxy's (for example an issuer you don't recognise, such as the sandbox vendor). Run the certificate checks from a normal machine before reporting them.
- Never print a full secret. The script redacts to the first 8 characters.

## What it checks

| Area | Signal | Gate | Notes |
|---|---|---|---|
| Transport | http:// redirects to https:// | **yes** | |
| Transport | HSTS max-age of at least 180 days | **yes** | Preload readiness is informational |
| Transport | Certificate trusted, at least 14 days to expiry, TLS 1.2 or later | no | High if expiry is under 14 days |
| Transport | Mixed content | no | |
| Headers | CSP present and enforced, with no `unsafe-inline` (without nonces or hashes), no `unsafe-eval`, no wildcard/scheme/`data:` script sources, and `object-src` and `base-uri` set | no | Judged on quality, not presence. Report-Only counts as missing |
| Headers | `frame-ancestors` or X-Frame-Options, `nosniff`, Referrer-Policy, Permissions-Policy, COOP, no version banners | no | |
| Cookies | Session-like cookies (`sess`, `auth`, `token`, `jwt`, `csrf`, …) are `Secure` and `HttpOnly` | **yes** | Other cookies: Secure plus an explicit SameSite |
| Leakage | Live secrets in HTML or same-origin JS | **yes** | A compact set; run `slop-ui-audit`'s `leak-crawl.mjs` for the full scan |
| Leakage | Public source maps | **yes** | A map of a framework polyfill is lower risk than one of app code. Say which it is |
| Supply chain | Known-vulnerable JS libraries (retire.js) | no | High if any match is high or critical |
| Supply chain | SRI on versioned CDN scripts, plus a third-party script inventory | no | |
| Disclosure | `security.txt` (RFC 9116) with Contact and an Expires date not yet passed; a privacy policy link | no | |
| Privacy | Trackers in the initial HTML with no consent manager | **yes** | A **lead**: confirm in a browser by recording network requests before any click (Playwright, or the browser tool from `slop-ui-audit`). Cookieless analytics pass |
| Email and DNS | One SPF record, not `+all`; DMARC at `quarantine` or `reject`; CAA; MTA-STS; DNSSEC | no | DMARC is high when the domain has MX records, because it sends mail and can be spoofed |
| Exposure (owner-only) | Exposed files, directory listings, reachable staging hosts | no | Only with `--probe` |

## Step 1 - Run and read

Run the script and read `security-report.md`. Then judge the results:

- **Severity in context.** A source map of a framework polyfill is not the same as one of app code: open the map's `sources` list and say which it is. Trackers in the HTML with a consent manager present still need the browser check.
- **CSP.** Explain the specific gap and give a working policy for the site's actual script sources, starting in `Content-Security-Policy-Report-Only`.
- **Email.** If the domain sends mail and DMARC is missing, give the exact record to publish (`v=DMARC1; p=none; rua=mailto:…`) and a plan to move to `quarantine`.
- **False positives.** A vulnerable-library match on a library that isn't actually loaded, or a session-like cookie that is really a preference cookie: downgrade it, and say that you did.

## Step 2 - Report

```markdown
# Security signals - <site> (<date>)

**Mode:** passive | passive + owner probes · **Gate:** PASS/FAIL (n/6) · These are signals, not proof of security.

## Fix first
1. ...

## Gate
| Item | Result | Detail |

## Fix list by area (Transport, Headers, Cookies, Leakage, Supply chain, Disclosure, Privacy, Email and DNS, Exposure)
## What's working (keep it)
```

Every finding needs the evidence (header value, cookie name, URL), why it matters, and the exact fix: a header line, a DNS record, a config directive. Use British English and redact secrets.

## Fixing at the source

Recommend fixes where they belong:
- headers at the edge (CDN or proxy rules), or once in the app framework's middleware;
- source maps in the build config (`productionBrowserSourceMaps: false` in Next.js, `build.sourcemap: false` in Vite);
- cookies in the session library's config;
- DNS records at the DNS provider.

Avoid page-by-page workarounds.
