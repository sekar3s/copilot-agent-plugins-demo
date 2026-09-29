# STRIDE checklist

Use these prompts for every element that crosses a trust boundary.

| Category | Property violated | Ask yourself | Typical mitigations |
|---|---|---|---|
| **S**poofing | Authentication | Can a caller pretend to be another user, service or admin? Are tokens validated (signature, expiry, audience)? | Strong authN (OIDC), signed tokens, mTLS between services, no shared accounts |
| **T**ampering | Integrity | Can request bodies, query strings, files, dependencies or DB rows be modified in transit or at rest? | Input validation (schema), parameterized queries, integrity checks, lockfiles + dependency scanning, signed artifacts |
| **R**epudiation | Non-repudiation | Could a user deny an action because nothing was logged? | Structured audit logs with user id + timestamp, tamper-evident log storage |
| **I**nformation disclosure | Confidentiality | Can secrets, PII or stack traces leak through responses, logs, errors, client bundles or repos? | Secret managers, generic error messages, field-level filtering, TLS, least-privilege queries |
| **D**enial of service | Availability | Can a caller exhaust CPU, memory, DB connections or storage? Unbounded pagination or uploads? | Rate limiting, request size limits, pagination caps, timeouts, circuit breakers |
| **E**levation of privilege | Authorization | Can a user reach admin routes or other tenants' data? Are ownership checks enforced server-side? | Central authZ middleware, deny-by-default, object-level ownership checks, least privilege |

## Web/API specific prompts

- CORS: is `origin: '*'` combined with credentials?
- Are IDs in URLs guessable and checked for ownership (IDOR)?
- Do file paths or URLs come from user input (path traversal, SSRF)?
- Is anything built with string concatenation for SQL, shell or HTML (injection / XSS)?
- Are security headers set (CSP, HSTS, X-Content-Type-Options)?
- Are dependencies pinned and scanned?
