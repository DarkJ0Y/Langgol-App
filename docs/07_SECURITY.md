# 07 — Security & Abuse Resistance

> **Status:** Approved 2026-08-10 (decisions D1–D10) · **Posture:** Langgol is a marketplace that moves money and holds identity documents of low-digital-literacy users. It is treated as a financial application, not a content site.

---

## 1. Threat model

| #   | Threat                                                                  | Actor                        | Impact                         | Primary control                                                                 |
| --- | ----------------------------------------------------------------------- | ---------------------------- | ------------------------------ | ------------------------------------------------------------------------------- |
| T1  | Price manipulation at checkout                                          | Buyer                        | Direct financial loss          | Server-side quotes (§5)                                                         |
| T2  | IDOR — reading/modifying another user's order, farm, address, documents | Any authenticated user       | Data breach, financial loss    | Owner-scoped queries (§4.3)                                                     |
| T3  | Privilege escalation to `ADMIN`/`OPS_AGENT`                             | Any user                     | Total compromise               | Server-derived roles, no client role input (§4)                                 |
| T4  | Duplicate/replayed financial operations                                 | Buyer, network, buggy client | Double charge, double payout   | Idempotency at request and ledger level (§7)                                    |
| T5  | OTP brute force / SIM-swap account takeover                             | Attacker                     | Account takeover               | Rate limits, hashed OTP, attempt caps, re-verification on sensitive change (§3) |
| T6  | Fake farmers, phantom listings, advance-fee scams                       | Fraudster                    | User harm, trust collapse      | Verification, publish gating, payout holds (§8)                                 |
| T7  | Fake reviews and reputation manipulation                                | Seller, competitor           | Ranking distortion             | Order-gated reviews, collusion detection (§8)                                   |
| T8  | Malicious file upload (webshell, malware, EXIF leakage)                 | Any uploader                 | RCE, PII leak                  | Signed uploads, type/size validation, re-encode, private buckets (§6)           |
| T9  | Enumeration of users/orders/phone numbers                               | Attacker                     | Privacy loss, targeted fraud   | UUID ids, uniform 404s, rate limits (§4.4)                                      |
| T10 | Insider abuse — admin issuing refunds or altering settlements           | Staff                        | Theft                          | Segregation of duties, audit log, 2FA, threshold approvals (§10)                |
| T11 | Webhook forgery ("payment succeeded")                                   | Attacker                     | Goods released without payment | Signature verification, provider-state reconfirmation (§7.3)                    |
| T12 | SQL injection / mass assignment                                         | Attacker                     | Data breach                    | Parameterised queries, explicit DTO allowlists (§5.3)                           |
| T13 | Scraping of farmer PII and phone numbers                                | Competitor                   | Poaching, harassment           | Contact masking pre-order, rate limits (§9.3)                                   |
| T14 | Denial of service on OTP/SMS (cost attack)                              | Attacker                     | Financial loss on SMS spend    | Per-phone/IP/global budget caps with circuit breaker (§3.2)                     |
| T15 | Coerced or agent-mediated account misuse                                | Field agent                  | Farmer's money misdirected     | Agent actions attributed and audited; payout changes require farmer OTP (§8.4)  |

T15 deserves emphasis. In an agent-assisted onboarding model, the field agent is a trusted insider sitting next to a user who may not read the screen. The architecture must make the agent's actions visible and must keep payout-destination changes out of the agent's reach.

---

## 2. Security principles

1. Server decides; client requests. No trust in any client-supplied price, total, role, seller id, status, or ownership claim.
2. Deny by default. Every route, action and query is unauthorised until explicitly permitted.
3. Defence in depth: middleware gate → policy check → owner-scoped query → database constraint.
4. Fail closed. If authorization cannot be determined, deny.
5. Audit everything that moves money, changes state, or touches identity.
6. Least privilege for humans and for services.
7. No secret in the client bundle, ever.

---

## 3. Authentication

### 3.1 Phone + OTP

Bangladeshi users authenticate by mobile number.

- Phone normalised to E.164 (`+8801XXXXXXXXX`) and validated against Bangladeshi operator prefixes
- OTP: 6 digits from a CSPRNG, **hashed** at rest (argon2id), 5-minute TTL, single use
- Max 5 verification attempts per challenge, then the challenge is burned
- The response is identical whether or not the phone is registered — no account enumeration
- Constant-time comparison on the hash

### 3.2 Rate limits and SMS cost protection

| Scope                               | Limit                                               |
| ----------------------------------- | --------------------------------------------------- |
| OTP request per phone               | 3 / 15 min, 10 / day                                |
| OTP request per IP                  | 10 / hour                                           |
| OTP request per device fingerprint  | 10 / hour                                           |
| Verification attempts per challenge | 5                                                   |
| Global SMS spend                    | Daily budget cap with circuit breaker and ops alert |

An SMS gateway with no budget cap is an open invoice to an attacker.

### 3.3 Sessions

Database-backed sessions (revocable, unlike stateless JWTs), rotated on privilege change. Cookie: `httpOnly`, `Secure`, `SameSite=Lax`, `__Host-` prefix. Idle timeout 30 days for buyers/farmers, **8 hours for admin**. Session list and "sign out everywhere" available to users. Any session may be revoked by an admin.

### 3.4 Elevated authentication

Required, with a fresh OTP or second factor, for: changing the payout account · changing the registered phone · admin sign-in (2FA mandatory) · admin refunds and settlement approvals · role grants.

A payout-account change also triggers a **notification to the old number** and a configurable settlement hold, because payout redirection is the highest-value attack on this platform.

---

## 4. Authorization

### 4.1 Model

Role-based with ownership and state predicates. Roles: `FARMER`, `CONSUMER`, `RETAILER`, `OPS_AGENT`, `ADMIN`. Roles are read from `UserRoleAssignment` server-side per request. **A role is never read from a cookie, header, JWT claim written by the client, or request body.**

### 4.2 Policy layer

Pure, unit-tested predicates in `packages/domain/policy`:

```ts
can(actor, 'order:accept', order)
  → actor.roles.includes('FARMER')
 && order.sellerFarmerProfileId === actor.farmerProfileId
 && order.status === 'PENDING'
 && now <= order.acceptanceDeadline
```

Every server action calls a policy predicate. Every predicate has tests for allow and deny.

### 4.3 Owner-scoped data access (the control that actually stops IDOR)

Repositories expose owner-scoped finders. `orders.findOwnedById(id, actorContext)` puts the ownership condition **in the SQL**. The pattern `findById(id)` followed by an if-statement is banned by lint for owned aggregates: it works until someone forgets the if-statement, and someone always forgets.

### 4.4 Uniform responses

A resource the actor may not see returns **404**, not 403 — a 403 confirms existence. Error messages never reveal whether a phone number, order or user exists.

### 4.5 Admin surface

`(admin)` routes are gated in middleware **and** re-checked in every action (middleware is not a security boundary on its own). Admin sessions are short-lived, 2FA-required, and optionally IP-restricted in production. Every admin action writes an `AuditLog` row with a mandatory reason for destructive operations.

---

## 5. Input validation and the price-integrity chain

### 5.1 Never trusted from the client

Prices · totals · fees · discounts · commission · seller ids · user ids · roles · order status · payment status · quantities-already-reserved · distances · delivery costs.

### 5.2 The checkout chain

```text
Client sends: { quoteId, idempotencyKey, paymentMethod, addressId }
              ↑ no money values at all
Server: load quote → verify owner → verify not consumed → verify not expired
      → re-read listings → verify price and availability unchanged
      → reserve atomically → create order with money copied from the quote
```

There is no code path that reads a price from a request body. This is structural, not procedural — it does not depend on a reviewer noticing.

### 5.3 Validation

Zod schemas at every boundary with **explicit allowlists** — no spreading request bodies into ORM calls (mass assignment). Prisma parameterises all queries; the handful of raw SQL statements (geo search, atomic reservation) use bound parameters exclusively, and raw string interpolation into SQL is banned by lint.

---

## 6. File uploads

Listing photos, verification documents, delivery proof, dispute evidence.

- Direct-to-storage via **short-lived signed URLs**; files never stream through the application server
- Server-issued policy constrains content type and max size (listing image 5 MB; document 10 MB)
- Magic-byte sniffing, not extension or client-declared MIME
- Images re-encoded server-side to strip EXIF (**GPS coordinates in a farmer's photo are location PII**) and normalised to WebP at bounded dimensions
- Randomised storage keys; original filenames never used
- **Verification documents and dispute evidence live in private buckets**, served only through short-TTL signed URLs after a policy check. Never public
- SHA-256 recorded for integrity and duplicate detection
- Uploads rate-limited per user

---

## 7. Transaction integrity

### 7.1 Idempotency

Two layers, per [`06_FINANCIAL_ARCHITECTURE.md`](06_FINANCIAL_ARCHITECTURE.md) §7: request-level `IdempotencyRecord(scope, key)` and ledger-level deterministic `LedgerTransaction.idempotencyKey`. The second is the one that protects the books.

### 7.2 Concurrency

Atomic conditional `UPDATE` for inventory ([`02_DATABASE.md`](02_DATABASE.md) §13); optimistic `version` on orders and listings; database `CHECK` constraints as the final backstop. Concurrency tests are merge-blocking.

### 7.3 Webhooks

- Signature verified against the provider secret before **any** parsing, using constant-time comparison
- Timestamp freshness enforced to block replay
- Handler is idempotent on `(provider, providerRef)`
- **The webhook is a notification, not a fact.** For any payment-success event above a threshold, the platform re-queries the provider's API for authoritative state before releasing goods
- Raw payload stored for dispute and forensics

### 7.4 Server-side state only

Order status, payment status and inventory are computed server-side from the ledger and the event log. A client claiming `paymentStatus: PAID` changes nothing.

---

## 8. Marketplace abuse

### 8.1 Seller trust

Publishing requires `VERIFIED` status. Verification requires identity documents reviewed by a human. New sellers have a longer settlement hold. Automatic pause after N consecutive rejections or timeouts. Suspension is a reversible, audited state, not a deletion.

### 8.2 Fake reviews and collusion

Reviews only from a `DELIVERED` order, one per order per subject, from the buyer of that order. Signals monitored: buyer and seller sharing device fingerprint, IP, address or phone prefix cluster; circular trading; abnormal order-to-review latency; a burst of 5-star reviews from new accounts. Flagged clusters go to human review — automated bans on weak signals will hit innocent villages where households genuinely share a phone.

### 8.3 Listing fraud

Price-outlier detection against `PriceObservation` medians; image-reuse detection via perceptual hash; buyer reporting on every listing; ops moderation queue.

### 8.4 Field-agent controls

`OPS_AGENT` may create farms and listings on a farmer's behalf; both `createdByUserId` and the farmer are recorded on every such record, and the farmer's order and earnings SMS go to the **farmer's** number regardless of who is operating the app. An agent **cannot** change a payout account, approve a settlement, or resolve a dispute. Agent activity is reported per agent: listings created, orders influenced, cancellations, disputes.

### 8.5 COD-specific abuse

Repeated refusal-at-delivery is tracked per buyer; thresholds move a buyer to prepaid-only. Every wasted trip is costed to the platform ([`05_ORDER_SYSTEM.md`](05_ORDER_SYSTEM.md) §6), so the abuse is visible in money, not just in counts.

---

## 9. Privacy and PII

### 9.1 Data classification

| Class         | Examples                                                       | Handling                                                                                             |
| ------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Critical**  | NID number and image, payout account, OTP, session token       | Encrypted at rest (app-layer envelope for payout refs), private buckets, never logged, strict access |
| **Sensitive** | Phone, exact home coordinates, order history, dispute evidence | Access-controlled, masked in lists, never in analytics exports without pseudonymisation              |
| **Internal**  | Farm location, listing data, ratings                           | Business-visible                                                                                     |
| **Public**    | Product catalogue, published listings, aggregate prices        | Open                                                                                                 |

### 9.2 Practices

Collect only what a documented purpose requires. NID number stored as a hash for duplicate detection plus the image in a private bucket, never as a queryable plaintext column. Logs redact phone numbers, tokens and money by default. Bangla-language consent text at collection, written for the actual user, not for lawyers. Data-subject export and deletion supported, with financial records retained under statutory retention and the rest anonymised.

### 9.3 Contact masking

Full counterparty phone numbers are revealed only after an order reaches `CONFIRMED`, and only to the counterparties. Listings show a farm name and area, not a home address. Scraping-resistant rate limits on discovery endpoints. This protects farmers from poaching and from harassment, and it is also the platform's commercial interest — but the user-protection reason is the one that governs.

### 9.4 Legal basis

Bangladesh's personal-data-protection framework has been in development for several years and its status must be re-verified with counsel before launch. The design assumes a strict regime — purpose limitation, consent, data minimisation, in-country data residency being achievable — so that tightening requirements is a configuration and hosting decision rather than a re-architecture. See [`08_BANGLADESH_CONTEXT.md`](08_BANGLADESH_CONTEXT.md) §7.6.

---

## 10. Insider risk and audit

- **Segregation of duties:** refund requester ≠ refund approver above a threshold; settlement approval ≠ settlement payment; role granting restricted to a small set and always audited
- **Audit log** on every privileged action: actor, role, action, entity, before/after, reason, IP, user agent, request id — append-only, retained per statutory requirements, searchable by admins, exportable
- **Reason mandatory** for: force-cancel, refund, verification rejection, suspension, settlement adjustment, role change
- **Nobody can delete** ledger entries, order events or audit logs — enforced by database rules ([`02_DATABASE.md`](02_DATABASE.md) §12), not by policy alone
- Production database access by engineers is via audited, time-boxed, approved sessions; direct writes to money tables are prohibited

---

## 11. Infrastructure and application hardening

- HTTPS only; HSTS with preload; TLS 1.2+
- Security headers: strict CSP (nonce-based, no `unsafe-inline`), `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, frame-ancestors deny
- CSRF: server actions rely on same-origin plus `SameSite=Lax` cookies; state-changing route handlers verify origin explicitly
- Secrets in a managed secret store; rotation runbook; nothing in the repo; CI scanning for committed secrets and for secret-like `NEXT_PUBLIC_*` names
- Dependencies: lockfile committed, automated vulnerability scanning, minimal dependency count by policy (every new package is a supply-chain decision)
- Database: least-privilege application role, TLS-only connections, no public network exposure, RLS enabled deny-all as a backstop ([`03_ARCHITECTURE.md`](03_ARCHITECTURE.md) §6.3)
- Backups encrypted, PITR enabled, and **restore rehearsed before launch**
- Rate limiting at the edge plus per-user application limits on expensive operations (discovery, quote creation, uploads)

---

## 12. Incident response

1. **Detect** — alerts on ledger imbalance, auth anomalies, webhook failure spikes, error-rate jumps, unusual admin activity
2. **Contain** — revoke sessions, disable accounts, feature-flag off affected paths, freeze settlements
3. **Assess** — reconstruct from the audit log and event log; the append-only design exists precisely for this moment
4. **Remediate** — correct with compensating ledger entries, never by editing history
5. **Notify** — affected users, and regulators where required, on a documented timeline
6. **Review** — blameless post-mortem; the fix includes a test

A pre-launch runbook is required for at least: farmer payout redirection, mass account-takeover attempt, payment provider compromise, and data exposure of verification documents.

---

## 13. Pre-launch security checklist

- [ ] Every mutation tested as anonymous / wrong role / correct role wrong owner / correct owner
- [ ] No `findById` without ownership scoping on any owned aggregate
- [ ] No money value accepted from any client payload — verified by grep and by review
- [ ] Idempotency proven for order creation, payment capture, refund, settlement
- [ ] Concurrency test: two buyers, last unit — exactly one wins
- [ ] Webhook signature verification tested, including a forged-signature case
- [ ] Mock payment provider proven unregistrable in production
- [ ] Upload restrictions verified with a polyglot/webshell attempt; EXIF stripping verified
- [ ] Private buckets verified inaccessible without a signed URL
- [ ] Rate limits verified on OTP, quotes, uploads, discovery
- [ ] SMS budget circuit breaker tested
- [ ] Admin 2FA enforced; segregation of duties verified
- [ ] Audit log completeness verified for all privileged actions
- [ ] Ledger balance trigger verified by attempting an unbalanced insert
- [ ] Backup restore rehearsed end to end
- [ ] Dependency and secret scanning green in CI
- [ ] Penetration test or a structured external review of auth, authorization and payments
