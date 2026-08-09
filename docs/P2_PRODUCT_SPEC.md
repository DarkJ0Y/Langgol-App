# P2 — Product Specification

> **Status:** Design proposal · **Baseline:** [`01_MVP_REQUIREMENTS.md`](01_MVP_REQUIREMENTS.md)

---

## 1. What P2 must prove

P1 proved Langgol can have a secure, tested foundation. P2 must prove:

> **Langgol has an agricultural marketplace model that can economically work in Bangladesh.**

Not "can we list produce" — we can. The question is whether the transaction pays for itself while
leaving the farmer better off and the buyer no worse off.

---

## 2. Scope

**Geography:** one pilot district, narrowed to 2–3 clustered wards plus their farm hinterland
(decision D2-11, open question Q2-1). **Crops:** 5–8. **Farmers:** 30–80.
**Buyers:** retailers as the anchor segment, households on pooled routes and pickup points.

### In scope

| Area            | Contents                                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Supply**      | Farmer onboarding · verification · farm · listing with crop, grade, harvest date and forward-harvest support · inventory with reservations and spoilage |
| **Demand**      | Location-aware discovery ranked by delivered cost · search and filters · listing detail with a full price breakdown · cart                              |
| **Commerce**    | Server-authoritative quote · reservation · single-seller order · cancellation with fault attribution · fulfilment · settlement at T+0/T+1               |
| **Fulfilment**  | Pickup · seller delivery · ops-coordinated delivery · **pooled routes and pickup points** (D2-2)                                                        |
| **Measurement** | Price observations · farmer realisation · buyer delivered price · trip cost · commission · contribution margin · failed-delivery cost                   |
| **Ops**         | Verification queue · listing moderation · route assembly · trip costing · dispute resolution · settlement approval                                      |

### Out of scope — and staying out

Warehouse receipts · Amanat · blockchain or tokenisation · machinery and equipment rental · crop
insurance · weather products · AI diagnosis · export · subscriptions · multi-seller carts · RFQ and
negotiation · self-service logistics marketplace · native apps · **farmer credit**.

Also deferred: `Plot`, `CropCycle`, recurring contracts, prepaid payments.

---

## 3. Personas and what each actually needs

**Farmer** — smallholder, possibly low literacy, may share a phone, may need an agent, sells small
quantities, speaks in _mon_ and _seer_, needs predictable settlement, and judges Langgol on **net
realisation and whether payment arrives when promised**. Not on features.

**Consumer** — household buyer, small quantities, cares about delivered price and freshness, will
compare a few nearby farmers, abandons a complicated checkout. **Economically the hardest segment**
([`P2_ECONOMICS.md`](P2_ECONOMICS.md) §5).

**Retailer** — shop, restaurant or institution. Larger baskets, repeat purchase, compares to the
**wholesale** price not retail, cares about reliability and availability. **The anchor segment**:
one retailer order moves produce at roughly one ninth the delivery cost per kg of household orders.

**OPS_AGENT** — field worker who onboards farmers, assists listings, assembles routes, coordinates
fulfilment and may handle COD cash. Attributed and audited on every action; **never** touches
payout accounts, settlements, refunds, disputes, verifications or roles.

**ADMIN** — platform operator with segregation of duties, not a superuser. Refund requester ≠
approver; settlement approver ≠ payer.

---

## 4. The farmer journey

| Step           | Actor                         | Input                                         | Validation                                                            | State                                     | Entity                        | Authorization                                | Notification         | Audit               | Failure mode                                                         |
| -------------- | ----------------------------- | --------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------- | ----------------------------- | -------------------------------------------- | -------------------- | ------------------- | -------------------------------------------------------------------- |
| Onboard        | Farmer / agent                | Phone, name, language                         | E.164 + operator prefix; DB CHECK                                     | `UNVERIFIED`                              | `User`, `FarmerProfile`       | self / `assist`                              | SMS welcome          | `ACCOUNT_CREATED`   | Shared phone → one account, agent-assisted                           |
| Verify         | Farmer submits, Admin decides | Documents                                     | Human review — **no NID API is available**                            | `PENDING` → `VERIFIED`/`REJECTED`         | `VerificationRequest`         | submit: own/assist · approve: **admin only** | SMS outcome + reason | `FARMER_VERIFIED`   | Rejection must state why and allow resubmission                      |
| Add farm       | Farmer / agent                | Name, area, location                          | Union hierarchy **or** map pin; `LocationPrecision` recorded          | —                                         | `Farm`                        | own / assist                                 | —                    | `FARM_CREATED`      | No pin → union centroid, precision flagged                           |
| Create listing | Farmer / agent                | Product, grade, quantity, unit, price, window | Verified only; price sanity vs `PriceObservation` → warn, never block | `DRAFT` → `PUBLISHED` / `PENDING_HARVEST` | `Listing`                     | own, verified                                | —                    | `LISTING_PUBLISHED` | Price outlier flags moderation                                       |
| Receive order  | Farmer                        | —                                             | —                                                                     | `PENDING`                                 | `Order`, `ListingReservation` | —                                            | **SMS, urgent**      | `ORDER_PLACED`      | No response → `SELLER_TIMEOUT`, reliability counted                  |
| Accept         | Farmer                        | —                                             | Within quiet-hours-aware window                                       | `CONFIRMED`                               | `OrderEvent`                  | own                                          | SMS buyer            | transition          | Reject requires a reason                                             |
| Prepare        | Farmer                        | Actual weight                                 | ±5% tolerance                                                         | `PREPARING` → `READY_FOR_PICKUP`          | —                             | own / assist                                 | Ops dispatch         | transition          | Beyond tolerance → buyer confirms or dispute                         |
| Fulfil         | Farmer / ops                  | OTP or photo proof                            | OTP verified                                                          | `IN_TRANSIT` → `DELIVERED`                | `Delivery`, `TripStop`        | own / ops                                    | SMS buyer            | transition          | Failure books the trip cost                                          |
| Settle         | System → Admin                | —                                             | Delivered + risk-tier hold + COD reconciled + no dispute              | `Settlement` `PAID`                       | `Settlement`, ledger          | approve ≠ pay                                | **SMS with amount**  | `SETTLEMENT_PAID`   | Payout failure retried; farmer not blocked by our collection failure |
| Realisation    | System                        | —                                             | Trip costed first                                                     | —                                         | `OrderEconomics`              | —                                            | —                    | —                   | Uncosted trip blocks measurement rather than estimating              |

---

## 5. Consumer and retailer journeys

**Consumer:** choose product → nearby supply ranked by delivered cost → compare → quantity →
fulfilment (pickup / pooled delivery) → **see the full quote** → confirm → track → receive → review.

**Retailer:** search supply → larger quantity → compare delivered cost against wholesale → quote →
order → fulfilment → settlement → repeat-last-order.

Recurring scheduled orders are **not** in P2 (Q2-7); a repeat-last-order action captures most of
the behaviour for a fraction of the cost.

---

## 6. Farmer verification states

```text
UNVERIFIED ──submit──► PENDING ──approve──► VERIFIED ──suspend──► SUSPENDED
     ▲                    │                                            │
     └──────reject────────┘                            reinstate ──────┘
```

Only `VERIFIED` may **publish** a listing. `UNVERIFIED` may create a farm and draft listings — so
onboarding is never blocked on a review queue. Verification is **human review of documents**; no
electronic NID verification capability is assumed, because none is available to us.

---

## 7. Agent-assisted workflows

An agent may onboard a farmer, create or update farm details, assist listing creation, and
coordinate fulfilment. Every such action records `actorUserId` **and** the farmer acted for, and
the farmer's SMS goes to the farmer's own number.

An agent may **not** change payout accounts, alter financial totals, approve their own disputes or
verifications, touch the ledger, bypass authorization, or act without attribution.
