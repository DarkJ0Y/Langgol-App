-- NOTE: `prisma migrate dev` again emitted DROP INDEX for all four hand-authored GIST indexes
-- (addresses_geo_gix, admin_areas_geo_gix, farms_geo_gix, listings_geo_gix). They have been
-- removed by hand, exactly as docs/DEVELOPMENT.md warns.
--
-- Prisma cannot represent a GIST index on an `Unsupported("geography(...)")` column, so it reads
-- them as drift on every single migration. Dropping them silently turns every radius search into
-- a full table scan. This WILL recur; grep each generated migration for DROP INDEX.

-- CreateEnum
CREATE TYPE "DeliveryModel" AS ENUM ('INDIVIDUAL', 'AGGREGATED_ROUTE', 'RETAILER_BULK', 'PICKUP');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('NOT_REQUIRED', 'PENDING_ASSIGNMENT', 'ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'FAILED', 'RETURNED');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'ABORTED');

-- CreateEnum
CREATE TYPE "AllocationMethod" AS ENUM ('WEIGHT_SHARE', 'EQUAL_SHARE', 'DISTANCE_WEIGHTED', 'STANDALONE');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "AccountOwnerType" AS ENUM ('PLATFORM', 'FARMER', 'BUYER', 'AGENT', 'PROVIDER');

-- CreateEnum
CREATE TYPE "LedgerDirection" AS ENUM ('DEBIT', 'CREDIT');





-- CreateTable
CREATE TABLE "deliveries" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "mode" "FulfilmentMode" NOT NULL,
    "delivery_model" "DeliveryModel" NOT NULL,
    "trip_id" UUID,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING_ASSIGNMENT',
    "pickup_distance_meters" INTEGER,
    "delivery_distance_meters" INTEGER,
    "distance_meters" INTEGER,
    "vehicle_type" TEXT,
    "assigned_ops_user_id" UUID,
    "courier_name" TEXT,
    "courier_phone" TEXT,
    "planned_pickup_at" TIMESTAMP(3),
    "planned_delivery_at" TIMESTAMP(3),
    "picked_up_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "failure_reason" TEXT,
    "proof_photo_key" TEXT,
    "delivery_otp_hash" TEXT,
    "actual_cost_poisha" BIGINT,
    "expected_cost_poisha" BIGINT,
    "allocation_numerator" BIGINT,
    "allocation_denominator" BIGINT,
    "reconciled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_trips" (
    "id" UUID NOT NULL,
    "trip_ref" TEXT NOT NULL,
    "delivery_model" "DeliveryModel" NOT NULL,
    "status" "TripStatus" NOT NULL DEFAULT 'PLANNED',
    "vehicle_type" TEXT NOT NULL,
    "vehicle_capacity_base" BIGINT NOT NULL,
    "operated_by_user_id" UUID,
    "district_id" UUID,
    "planned_start_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "pickup_distance_meters" INTEGER NOT NULL DEFAULT 0,
    "delivery_distance_meters" INTEGER NOT NULL DEFAULT 0,
    "route_distance_meters" INTEGER NOT NULL DEFAULT 0,
    "total_weight_base" BIGINT NOT NULL DEFAULT 0,
    "order_count" INTEGER NOT NULL DEFAULT 0,
    "actual_cost_poisha" BIGINT,
    "cost_evidence_key" TEXT,
    "allocation_method" "AllocationMethod" NOT NULL DEFAULT 'WEIGHT_SHARE',
    "costed_by_id" UUID,
    "costed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_stops" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "stop_type" TEXT NOT NULL,
    "order_id" UUID,
    "farm_id" UUID,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "leg_distance_meters" INTEGER,
    "weight_base" BIGINT NOT NULL DEFAULT 0,
    "arrived_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "trip_stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_cost_items" (
    "id" UUID NOT NULL,
    "trip_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "amount_poisha" BIGINT NOT NULL,
    "is_standard_rate" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_cost_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "owner_type" "AccountOwnerType" NOT NULL,
    "owner_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_transactions" (
    "id" UUID NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "reference_type" TEXT,
    "reference_id" TEXT,
    "posted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "transaction_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "amount_poisha" BIGINT NOT NULL,
    "memo" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_order_id_key" ON "deliveries"("order_id");

-- CreateIndex
CREATE INDEX "deliveries_status_planned_delivery_at_idx" ON "deliveries"("status", "planned_delivery_at");

-- CreateIndex
CREATE INDEX "deliveries_trip_id_idx" ON "deliveries"("trip_id");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_trips_trip_ref_key" ON "delivery_trips"("trip_ref");

-- CreateIndex
CREATE INDEX "delivery_trips_status_planned_start_at_idx" ON "delivery_trips"("status", "planned_start_at");

-- CreateIndex
CREATE INDEX "delivery_trips_delivery_model_completed_at_idx" ON "delivery_trips"("delivery_model", "completed_at");

-- CreateIndex
CREATE INDEX "trip_stops_order_id_idx" ON "trip_stops"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "trip_stops_trip_id_sequence_key" ON "trip_stops"("trip_id", "sequence");

-- CreateIndex
CREATE INDEX "trip_cost_items_trip_id_idx" ON "trip_cost_items"("trip_id");

-- CreateIndex
CREATE INDEX "ledger_accounts_code_idx" ON "ledger_accounts"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_code_owner_id_key" ON "ledger_accounts"("code", "owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_transactions_idempotency_key_key" ON "ledger_transactions"("idempotency_key");

-- CreateIndex
CREATE INDEX "ledger_transactions_reference_type_reference_id_idx" ON "ledger_transactions"("reference_type", "reference_id");

-- CreateIndex
CREATE INDEX "ledger_transactions_posted_at_idx" ON "ledger_transactions"("posted_at");

-- CreateIndex
CREATE INDEX "ledger_entries_account_id_created_at_idx" ON "ledger_entries"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "ledger_entries_transaction_id_idx" ON "ledger_entries"("transaction_id");

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "delivery_trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_stops" ADD CONSTRAINT "trip_stops_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "delivery_trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_cost_items" ADD CONSTRAINT "trip_cost_items_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "delivery_trips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================
-- Ledger and trip guarantees
-- ===========================================================================
--
-- docs/06_FINANCIAL_ARCHITECTURE.md §13 lists ten non-negotiables. Four of them are enforced
-- here rather than in application code, because "no unbalanced transaction" and "no mutable
-- ledger entry" are properties that must hold against anyone with a database connection, not
-- just against code that went through review.

-- --------------------------------------------------------------------- ledger

-- Amounts are always POSITIVE; `direction` carries the sign. A negative amount would let two
-- errors cancel out and still balance.
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_amount_positive"
  CHECK (amount_poisha > 0);

/*
 * Every transaction must balance. DEFERRABLE INITIALLY DEFERRED so the entries of one journal
 * can be inserted in any order within a transaction and are checked once at COMMIT — a
 * non-deferred trigger would reject the first entry of every balanced pair.
 */
CREATE OR REPLACE FUNCTION assert_ledger_balanced() RETURNS trigger AS $$
DECLARE d BIGINT; c BIGINT;
BEGIN
  SELECT COALESCE(SUM(amount_poisha) FILTER (WHERE direction = 'DEBIT'), 0),
         COALESCE(SUM(amount_poisha) FILTER (WHERE direction = 'CREDIT'), 0)
    INTO d, c
    FROM ledger_entries
   WHERE transaction_id = NEW.transaction_id;

  IF d <> c THEN
    RAISE EXCEPTION 'Unbalanced ledger transaction %: debits=% credits=%', NEW.transaction_id, d, c;
  END IF;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER ledger_balance_check
  AFTER INSERT OR UPDATE ON "ledger_entries"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_ledger_balanced();

-- Ledger entries are immutable. A correction is a new reversing transaction, never an edit.
CREATE RULE ledger_entries_no_update AS ON UPDATE TO "ledger_entries" DO INSTEAD NOTHING;
CREATE RULE ledger_entries_no_delete AS ON DELETE TO "ledger_entries" DO INSTEAD NOTHING;

-- A platform-owned account has no owner; an owned account must name its owner. Without this,
-- a farmer payable with a NULL owner would silently pool every farmer's money into one bucket.
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_account_owner_consistent" CHECK (
  (owner_type = 'PLATFORM' AND owner_id IS NULL)
  OR (owner_type <> 'PLATFORM' AND owner_id IS NOT NULL)
);

-- ---------------------------------------------------------------------- trips

ALTER TABLE "delivery_trips" ADD CONSTRAINT "trips_sane" CHECK (
  vehicle_capacity_base > 0
  AND total_weight_base >= 0
  AND order_count >= 0
  AND route_distance_meters >= 0
  AND pickup_distance_meters >= 0
  AND delivery_distance_meters >= 0
  AND (actual_cost_poisha IS NULL OR actual_cost_poisha >= 0)
);

-- A completed trip must be costed before its orders can be measured. Without this an
-- uncosted trip would quietly report a contribution margin computed from an expected cost.
ALTER TABLE "delivery_trips" ADD CONSTRAINT "trips_completed_costed" CHECK (
  status <> 'COMPLETED' OR actual_cost_poisha IS NOT NULL
);

ALTER TABLE "trip_cost_items" ADD CONSTRAINT "trip_cost_item_positive"
  CHECK (amount_poisha > 0);

-- ------------------------------------------------------------------ deliveries

ALTER TABLE "deliveries" ADD CONSTRAINT "delivery_costs_nonneg" CHECK (
  (actual_cost_poisha IS NULL OR actual_cost_poisha >= 0)
  AND (expected_cost_poisha IS NULL OR expected_cost_poisha >= 0)
);

-- The allocation share is a rational; a zero denominator is a division by zero waiting to be
-- reported as a cost. Both parts move together or neither is set.
ALTER TABLE "deliveries" ADD CONSTRAINT "delivery_allocation_sane" CHECK (
  (allocation_numerator IS NULL AND allocation_denominator IS NULL)
  OR (allocation_numerator >= 0 AND allocation_denominator > 0
      AND allocation_numerator <= allocation_denominator)
);

-- An order's allocated cost is only meaningful once it has been reconciled against a real trip.
ALTER TABLE "deliveries" ADD CONSTRAINT "delivery_reconciled_has_cost" CHECK (
  reconciled_at IS NULL OR actual_cost_poisha IS NOT NULL
);
