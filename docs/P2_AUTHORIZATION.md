# P2 — Authorization Matrix

> **Status:** Design proposal · **Baseline:** [`07_SECURITY.md`](07_SECURITY.md) §4 and the
> exhaustive `RULES: Record<Action, Rule>` pattern already implemented in `packages/domain/policy`.

Every action gets exactly one rule. `RULES` stays an exhaustive `Record`, so adding an `Action`
without a rule is a **compile error** — no action can ship unguarded.

Legend: **✓** allowed · **own** own records only · **✗** denied · **audit** allowed with mandatory
reason and audit row · **assist** may act _for_ a farmer, fully attributed.

---

## 1. Matrix

| Action                         | Farmer                 | Consumer             | Retailer             | OPS_AGENT      | Admin                          |
| ------------------------------ | ---------------------- | -------------------- | -------------------- | -------------- | ------------------------------ |
| `farm:create`                  | ✓ own                  | ✗                    | ✗                    | assist         | audit                          |
| `farm:read`                    | own                    | ✗                    | ✗                    | ✓              | ✓                              |
| `farm:update`                  | own                    | ✗                    | ✗                    | assist         | audit                          |
| `farm:delete`                  | own (soft)             | ✗                    | ✗                    | ✗              | audit                          |
| `listing:create`               | own, **verified only** | ✗                    | ✗                    | assist         | ✗                              |
| `listing:read`                 | own                    | ✓ published          | ✓ published          | ✓              | ✓                              |
| `listing:update`               | own                    | ✗                    | ✗                    | assist         | ✗                              |
| `listing:publish`              | own, verified          | ✗                    | ✗                    | assist         | ✗                              |
| `listing:pause`                | own                    | ✗                    | ✗                    | assist         | audit                          |
| `listing:unpublish-moderation` | ✗                      | ✗                    | ✗                    | ✗              | audit                          |
| `inventory:adjust`             | own                    | ✗                    | ✗                    | assist         | audit                          |
| `inventory:write-off-spoilage` | own                    | ✗                    | ✗                    | assist         | audit                          |
| `quote:create`                 | ✗                      | ✓                    | ✓                    | assist         | ✗                              |
| `quote:read`                   | ✗                      | own                  | own                  | ✓              | ✓                              |
| `reservation:create`           | ✗                      | ✓ (via order)        | ✓ (via order)        | assist         | ✗                              |
| `reservation:release`          | ✗                      | own                  | own                  | ✓              | audit                          |
| `order:create`                 | ✗                      | ✓                    | ✓                    | assist         | ✗                              |
| `order:read`                   | own (as seller)        | own                  | own                  | ✓              | ✓                              |
| `order:accept`                 | own, in window         | ✗                    | ✗                    | ✗              | audit                          |
| `order:reject`                 | own, reason            | ✗                    | ✗                    | ✗              | audit                          |
| `order:mark-preparing`         | own                    | ✗                    | ✗                    | assist         | audit                          |
| `order:mark-ready`             | own                    | ✗                    | ✗                    | assist         | audit                          |
| `order:dispatch`               | own (seller delivery)  | ✗                    | ✗                    | ✓              | audit                          |
| `order:confirm-delivery`       | own (+OTP)             | own (+OTP)           | own (+OTP)           | ✓ (+OTP/proof) | audit                          |
| `order:cancel`                 | own, per policy        | own, per policy      | own, per policy      | audit          | audit                          |
| `order:force-cancel`           | ✗                      | ✗                    | ✗                    | ✗              | audit                          |
| `trip:create`                  | ✗                      | ✗                    | ✗                    | ✓              | ✓                              |
| `trip:assign-order`            | ✗                      | ✗                    | ✗                    | ✓              | ✓                              |
| `trip:record-cost`             | ✗                      | ✗                    | ✗                    | ✓              | audit                          |
| `route:manage`                 | ✗                      | ✗                    | ✗                    | ✓              | ✓                              |
| `settlement:view`              | own                    | ✗                    | ✗                    | ✗              | ✓                              |
| `settlement:build`             | ✗                      | ✗                    | ✗                    | ✗              | ✓ (system)                     |
| `settlement:approve`           | ✗                      | ✗                    | ✗                    | **✗**          | audit                          |
| `settlement:mark-paid`         | ✗                      | ✗                    | ✗                    | **✗**          | audit, **separate permission** |
| `payout-account:update`        | own, **elevated auth** | ✗                    | ✗                    | **✗**          | ✗                              |
| `refund:request`               | ✗                      | own                  | own                  | audit          | audit                          |
| `refund:approve`               | ✗                      | ✗                    | ✗                    | **✗**          | audit, **≠ requester**         |
| `dispute:raise`                | own                    | own                  | own                  | audit          | audit                          |
| `dispute:resolve`              | ✗                      | ✗                    | ✗                    | **✗**          | audit                          |
| `review:create`                | ✗                      | own, delivered order | own, delivered order | ✗              | ✗                              |
| `price-observation:create`     | ✗                      | ✗                    | ✓ own shop prices    | ✓              | ✓                              |
| `price-observation:read`       | ✗                      | ✗                    | ✗                    | ✓              | ✓                              |
| `economics:read`               | own summary            | ✗                    | ✗                    | ✗              | ✓                              |
| `verification:submit`          | own                    | ✗                    | own                  | assist         | ✗                              |
| `verification:approve`         | ✗                      | ✗                    | ✗                    | **✗**          | audit                          |
| `user:suspend`                 | ✗                      | ✗                    | ✗                    | ✗              | audit                          |
| `role:grant-privileged`        | ✗                      | ✗                    | ✗                    | ✗              | audit                          |
| `config:write`                 | ✗                      | ✗                    | ✗                    | ✗              | audit                          |

---

## 2. The five things `OPS_AGENT` can never do

Field agents are trusted insiders sitting beside users who may not read the screen. They may
onboard, list, and coordinate — and never touch money or identity:

1. **Change a payout account.** The highest-value attack on the platform.
2. **Approve a settlement or mark one paid.**
3. **Approve a refund**, or resolve a dispute.
4. **Approve a verification** — including one they submitted.
5. **Grant a role**, suspend a user, or edit configuration.

Every agent action records `actorUserId` **and** the user acted for, and the farmer's own
notifications go to the _farmer's_ number regardless of whose phone raised the action.

---

## 3. Segregation of duties

| Pair                              | Rule                                            |
| --------------------------------- | ----------------------------------------------- |
| Refund requester / approver       | Must differ above a configured threshold        |
| Settlement approver / payer       | Separate permissions, never both on one account |
| Verification submitter / approver | Must differ                                     |
| Dispute party / resolver          | Admin only, never a participant                 |

---

## 4. Enforcement, restated

1. **Route gate** (middleware) — coarse, presence-of-cookie, _not_ a boundary.
2. **Policy check** — `can(actor, action, resource)`, pure, exhaustive, fails closed.
3. **Owner-scoped query** — the ownership condition is **in the SQL**. This is what actually stops
   IDOR; `findById` followed by an `if` is banned by lint for owned aggregates.

A resource the actor may not see returns **404, not 403** — a 403 confirms existence.
