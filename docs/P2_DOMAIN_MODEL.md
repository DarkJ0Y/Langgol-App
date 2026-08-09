# P2 — Domain Model

> **Status:** Design proposal · **Baseline:** [`02_DATABASE.md`](02_DATABASE.md), [`05_ORDER_SYSTEM.md`](05_ORDER_SYSTEM.md)

---

## 1. Shape

```text
User ──┬── FarmerProfile ── Farm ── Listing ──┬── ListingImage
       │                                       └── ListingReservation
       ├── ConsumerProfile                                │
       └── RetailerProfile                                │
                                                          ▼
Buyer ── Cart ── OrderQuote ──────────────────────────► Order ──┬── OrderItem
                                                                 ├── OrderEvent (append-only)
                                                                 ├── Delivery ── DeliveryTrip ── TripStop
                                                                 ├── Payment / Refund
                                                                 ├── Review
                                                                 └── Dispute
                                                                        │
                                              LedgerTransaction ◄────────┘
                                              Settlement ── SettlementItem
                                              OrderEconomics ── BaselineSnapshot
```

**Deliberately absent:** `Plot`, `CropCycle`, `Warehouse`, `LogisticsProvider`, `Contract`, `RFQ`,
`Subscription`, `CreditAccount`. Decisions D2-3 and D2-4.

---

## 2. Farm — the simplest structure that works

**`Farmer → Farm → Listing`.** No plot layer.

A plot table would be justified if something in supply, discovery, pricing or measurement needed
per-plot resolution. Nothing does: discovery needs _one_ location per listing, pricing needs
distance and quantity, measurement needs the farmer and the district. Plots are agronomic
modelling that would earn nothing in P2 and would have to be maintained by farmers who have no
reason to.

`Farm` carries name, `AdminArea`, optional coordinates, `LocationPrecision`, and land area in
decimals. A farmer may have several farms; a listing belongs to exactly one.

**Listing location may override the farm's** — produce is often already at a collection point when
it is offered, and pricing must use where the goods _are_.

---

## 3. Crop and harvest — attributes, not entities

The curated catalogue (`ProductCategory → Product → ProductVariety`) is already specified in
[`02_DATABASE.md`](02_DATABASE.md) §6 and is unchanged. Free text remains banned: it destroys
search, comparability and price-observation matching.

Harvest is carried on the listing:

| Field                           | Meaning                        | Why on the listing                                                   |
| ------------------------------- | ------------------------------ | -------------------------------------------------------------------- |
| `harvestedAt`                   | Already harvested              | Freshness ranking, spoilage modelling                                |
| `expectedHarvestAt`             | Forward supply                 | A farmer can list before harvest — the "sell it before it rots" case |
| `availableFrom` / `availableTo` | Offer window                   | Expiry sweep                                                         |
| `grade`                         | Seller-declared A/B/C/UNGRADED | Never a Langgol certification (ADR-26)                               |

**Forward listings are a distinct risk.** A listing whose `expectedHarvestAt` has not arrived
cannot be reserved against actual stock. P2 treats these as **`PENDING_HARVEST`** listings:
discoverable, marked clearly, orderable only if the farmer opts in, and with a longer acceptance
window and a `CROP_FAILURE` cancellation path that carries no reliability penalty.

---

## 4. Quantity

Unchanged and authoritative: integer base units, **milligram** mass base, exact conversions
(ADR-20). No second quantity system.

| Unit        | Role                                 | Base units |
| ----------- | ------------------------------------ | ---------- |
| `MILLIGRAM` | canonical mass base                  | 1          |
| `GRAM`      | display + input                      | 1,000      |
| `KG`        | **primary display and pricing unit** | 1,000,000  |
| `SEER`      | input alias + display                | 933,100    |
| `MON`       | input alias + display (wholesale)    | 37,324,000 |
| `PIECE`     | canonical count base                 | 1          |
| `HALI`      | input alias + display                | 4          |
| `DOZEN`     | input alias + display                | 12         |

**Canonical:** `MILLIGRAM`, `MILLILITRE`, `PIECE`. **Everything else is display or input.**
A farmer may enter `২ মণ`; the listing stores 74,648,000 mg; a consumer sees `৭৪.৬৪৮ কেজি`.
Invoices, settlements and the order record are metric — weights-and-measures law requires it
([`08_BANGLADESH_CONTEXT.md`](08_BANGLADESH_CONTEXT.md) §7.9).

---

## 5. Inventory — a stateful resource on the listing

```text
quantityTotalBase = quantityAvailableBase + quantityReservedBase + quantitySoldBase
                    + quantitySpoiledBase
```

| State       | Meaning                                                           |
| ----------- | ----------------------------------------------------------------- |
| `available` | Offerable now                                                     |
| `reserved`  | Held against a placed order awaiting farmer acceptance            |
| `sold`      | Delivered and committed                                           |
| `spoiled`   | Written off by the farmer or ops, with a reason                   |
| `cancelled` | Not a stock state — a released reservation returns to `available` |

**Invariant, enforced by CHECK:** no component negative, and the sum never exceeds
`quantityTotalBase`. `quantitySpoiledBase` is new in P2; the rest exist in P1.

### 5.1 Concurrency — two buyers, one crate

The P1 mechanism is reused unchanged and is the reason overselling is structurally impossible:

```sql
UPDATE listings
   SET quantity_available_base = quantity_available_base - $qty,
       quantity_reserved_base  = quantity_reserved_base  + $qty,
       version = version + 1
 WHERE id = $listingId
   AND status = 'PUBLISHED'
   AND quantity_available_base >= $qty
RETURNING id;
```

Zero rows ⇒ `InsufficientInventory`. No read-then-write, no application-level lock, and the CHECK
constraint is the backstop if this query is ever bypassed.

**Buyer A reserves 100 kg, B simultaneously attempts 100 kg, farmer has 150 kg:** the database
serialises the two `UPDATE`s; exactly one succeeds. B receives "just sold out" with alternatives —
a kind message with a next step, never a raw error.

**Release paths:** farmer rejects · acceptance window expires · buyer cancels before confirmation ·
reservation TTL elapses (swept every minute).

---

## 6. Listing

Answers, per §11 of the brief: what · by whom · where · how much · what grade · harvested when ·
available when · asking price · pricing unit · fulfilment options · pickup location · delivery
area · preparation time.

New in P2 relative to the P1 schema: `preparationHours`, `pickupPointId?`, `deliveryAreaIds[]`,
`quantitySpoiledBase`, `PENDING_HARVEST` status, and optional `priceBands` for volume pricing
(open decision Q2-4).

**The listing price is not the checkout authority.** `OrderQuote` remains the sole pricing
authority ([`04_MARKETPLACE.md`](04_MARKETPLACE.md) §8), unchanged.

---

## 7. Entities new in P2

| Entity                | Purpose                       | Notes                                                                 |
| --------------------- | ----------------------------- | --------------------------------------------------------------------- |
| `PickupPoint`         | Named collection location     | `AdminArea`-anchored, geography column, **holds no stock** (ADR-25)   |
| `DeliveryRoute`       | A planned pooled run          | Groups `DeliveryTrip` stops into a scheduled route with a service day |
| `ListingPriceBand`    | Volume pricing                | Only if Q2-4 resolves to (b)                                          |
| `InventoryAdjustment` | Spoilage and correction audit | Append-only; reason required                                          |

Entities **specified in P1 and now activated**: `Listing`, `ListingReservation`, `Cart`,
`OrderQuote`, `Order`, `OrderItem`, `OrderEvent`, `Delivery`, `DeliveryTrip`, `TripStop`,
`TripCostItem`, `Payment`, `Refund`, `Settlement`, `Review`, `Dispute`, `PriceObservation`,
`OrderEconomics`, `BaselineSnapshot`, plus the ledger.

---

## 8. Invariants P2 must preserve

1. Money is integer poisha; no floating point anywhere near it.
2. Quantity is integer base units; no floating point.
3. The client never supplies an authoritative price — it supplies a quote reference.
4. Inventory can never oversell; the atomic `UPDATE` plus CHECK guarantees it.
5. Order status changes only through `transition()`, and every change appends an `OrderEvent`.
6. Every financial operation is idempotent at both the request and ledger level.
7. Every ledger transaction balances; entries are immutable.
8. Fault is explicit on every non-happy terminal state.
9. Authorization is server-side, exhaustive, and fails closed.
10. Every economic claim traces to a stored observation with a stated method.
