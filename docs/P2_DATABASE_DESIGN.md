# P2 — Database Design

> **Status:** Design proposal. **No migrations written.** · **Baseline:** [`02_DATABASE.md`](02_DATABASE.md)

---

## 1. What already exists

[`02_DATABASE.md`](02_DATABASE.md) specifies the full marketplace schema; P1 implemented only the
foundation (12 tables). **Most of P2 is activating already-designed tables, not inventing new
ones** — `Listing`, `ListingReservation`, `Cart`, `OrderQuote`, `Order`, `OrderItem`, `OrderEvent`,
`Delivery`, `DeliveryTrip`, `TripStop`, `TripCostItem`, `Payment`, `Refund`, `Settlement`,
`SettlementItem`, `Review`, `Dispute`, `PriceObservation`, `OrderEconomics`, `BaselineSnapshot`,
`Experiment`, `PilotBudget`, and the ledger.

---

## 2. Tables new in P2

| Table                   | Purpose                                  | Key columns                                                                                                |
| ----------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `pickup_points`         | Named collection locations (ADR-25)      | `adminAreaId`, `name`, `lat/lng`, `geo`, `openingHours`, `operatorUserId?`, `isActive`. **Holds no stock** |
| `delivery_routes`       | A planned pooled run                     | `districtId`, `serviceDay`, `status`, `plannedVehicleType`, `capacityBase`, `serviceableFrom/To`           |
| `inventory_adjustments` | Spoilage and correction audit            | `listingId`, `deltaBase`, `reason`, `actorUserId`, append-only                                             |
| `listing_price_bands`   | Volume pricing (only if Q2-4 = option b) | `listingId`, `minQuantityBase`, `unitPricePoisha`                                                          |

`delivery_trips` gains `routeId?` so trips belong to a route.

---

## 3. Modifications to P1 tables

| Table             | Change                                                                                                             | Why                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| `listings`        | `+ preparationHours`, `+ pickupPointId?`, `+ quantitySpoiledBase`, `+ deliveryAreaIds`, status `+ PENDING_HARVEST` | Forward listings, pickup, spoilage tracking      |
| `orders`          | status `+ AWAITING_HARVEST`                                                                                        | Forward orders must not burn preparation SLA     |
| `farmer_profiles` | `+ preferredPickupPointId?`                                                                                        | Farmer's default drop-off                        |
| _(none other)_    | —                                                                                                                  | The P1 foundation tables are otherwise untouched |

**No change to** `users`, `sessions`, `otp_challenges`, `admin_areas`, `addresses`,
`platform_configs`, `audit_logs`, `notifications`, `outbox_events`, `idempotency_records`.

---

## 4. Constraints (beyond those already specified in `02` §12)

```sql
-- Inventory can never oversell, and spoilage is part of the identity.
ALTER TABLE listings ADD CONSTRAINT listings_inventory_identity CHECK (
  quantity_available_base >= 0 AND quantity_reserved_base >= 0 AND quantity_spoiled_base >= 0
  AND quantity_available_base + quantity_reserved_base + quantity_spoiled_base
      <= quantity_total_base
);

-- A forward listing must say when it is expected.
ALTER TABLE listings ADD CONSTRAINT listings_pending_harvest_dated CHECK (
  status <> 'PENDING_HARVEST' OR expected_harvest_at IS NOT NULL
);

-- Preparation time must be plausible.
ALTER TABLE listings ADD CONSTRAINT listings_preparation_sane CHECK (
  preparation_hours >= 0 AND preparation_hours <= 336
);

-- A pickup point must be locatable.
ALTER TABLE pickup_points ADD CONSTRAINT pickup_point_located CHECK (
  latitude IS NOT NULL AND longitude IS NOT NULL
);

-- Spoilage is a write-off with a reason, always.
ALTER TABLE inventory_adjustments ADD CONSTRAINT inventory_adjustment_reasoned CHECK (
  length(reason) > 0 AND delta_base <> 0
);
CREATE RULE inventory_adjustments_no_update AS ON UPDATE TO inventory_adjustments DO INSTEAD NOTHING;
CREATE RULE inventory_adjustments_no_delete AS ON DELETE TO inventory_adjustments DO INSTEAD NOTHING;

-- Price bands must be ordered and non-overlapping at the same minimum.
ALTER TABLE listing_price_bands ADD CONSTRAINT price_band_sane CHECK (
  min_quantity_base > 0 AND unit_price_poisha > 0
);
CREATE UNIQUE INDEX price_band_unique ON listing_price_bands (listing_id, min_quantity_base);
```

Plus every money/quantity CHECK already specified for orders, ledger entries and settlements.

---

## 5. Indexes

| Query               | Index                                                                             |
| ------------------- | --------------------------------------------------------------------------------- |
| Radius discovery    | `listings USING GIST (geo)` + `(status, available_to)`                            |
| Product filter      | `listings (product_id, status)`                                                   |
| Farmer's listings   | `listings (farmer_profile_id, status)`                                            |
| Forward supply      | `listings (status, expected_harvest_at) WHERE status = 'PENDING_HARVEST'`         |
| Reservation sweeper | `listing_reservations (status, expires_at)`                                       |
| Farmer order inbox  | `orders (seller_farmer_profile_id, status, placed_at)`                            |
| Acceptance timeout  | `orders (status, acceptance_deadline)`                                            |
| Route assembly      | `delivery_trips (route_id, status)`, `delivery_routes (district_id, service_day)` |
| Pickup discovery    | `pickup_points USING GIST (geo)`                                                  |
| Segment reporting   | `order_economics (basket_band, delivery_model, buyer_segment)`                    |

---

## 6. Concurrency

Unchanged and central: the atomic conditional `UPDATE` on `listings`
([`P2_DOMAIN_MODEL.md`](P2_DOMAIN_MODEL.md) §5.1), optimistic `version` on listings and orders,
`IdempotencyRecord(scope, key)` unique, `LedgerTransaction.idempotencyKey` unique,
`Payment(provider, providerRef)` unique, `Settlement(batchRef, farmerProfileId)` unique.

**Merge-blocking tests:** two buyers on the last unit → exactly one succeeds; every transition
replayed twice → one ledger transaction; reservation expiry restores inventory exactly.

---

## 7. Append-only and audit

Already immutable: `audit_logs`, `order_events`, `ledger_entries`, `platform_configs`,
`order_economics`. **Added in P2:** `inventory_adjustments`.

Every privileged or financial action writes an `AuditLog` row with actor, role, action, entity,
before/after, reason, IP and request id. Agent actions additionally record the user acted for.

---

## 8. Migration sequence proposed

1. `pickup_points` + PostGIS trigger and GIST index
2. `delivery_routes`, `delivery_trips.route_id`
3. `listings` column additions and constraints; `PENDING_HARVEST`
4. `inventory_adjustments` with append-only rules
5. `orders` `AWAITING_HARVEST`
6. `listing_price_bands` — **only if Q2-4 resolves to option (b)**

Each with its guarantee-script additions, verified by both scripts before merge.
