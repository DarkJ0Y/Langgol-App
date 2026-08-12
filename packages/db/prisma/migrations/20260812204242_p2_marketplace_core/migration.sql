-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SettlementRail" AS ENUM ('AGENT_CASH', 'MFS', 'BANK', 'REGULATED_PROVIDER');

-- CreateEnum
CREATE TYPE "BaseUnit" AS ENUM ('MILLIGRAM', 'MILLILITRE', 'PIECE');

-- CreateEnum
CREATE TYPE "SaleUnit" AS ENUM ('MILLIGRAM', 'GRAM', 'KG', 'SEER', 'MON', 'TONNE', 'MILLILITRE', 'LITRE', 'PIECE', 'HALI', 'DOZEN');

-- CreateEnum
CREATE TYPE "PerishabilityClass" AS ENUM ('HIGHLY_PERISHABLE', 'PERISHABLE', 'SEMI_DURABLE', 'DURABLE');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'PAUSED', 'SOLD_OUT', 'EXPIRED', 'REMOVED');

-- CreateEnum
CREATE TYPE "QualityGrade" AS ENUM ('A', 'B', 'C', 'UNGRADED');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('HELD', 'COMMITTED', 'RELEASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "FulfilmentMode" AS ENUM ('BUYER_PICKUP', 'SELLER_DELIVERY', 'LANGGOL_DELIVERY');

-- CreateEnum
CREATE TYPE "DeliveryFundingModel" AS ENUM ('COST_RECOVERING', 'PROMOTIONAL_SUBSIDY', 'FREE_DELIVERY', 'RETAILER_FUNDED', 'SELLER_FUNDED', 'SHARED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'IN_TRANSIT', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'FAILED', 'REFUNDED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH_ON_DELIVERY', 'MFS', 'CARD', 'BANK_TRANSFER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'AUTHORIZED', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'FAILED');

-- CreateEnum
CREATE TYPE "CancelledBy" AS ENUM ('BUYER', 'SELLER', 'SYSTEM', 'ADMIN');

-- CreateEnum
CREATE TYPE "FaultParty" AS ENUM ('BUYER', 'SELLER', 'PLATFORM', 'LOGISTICS', 'FORCE_MAJEURE', 'UNDETERMINED');

-- CreateEnum
CREATE TYPE "BuyerSegment" AS ENUM ('CONSUMER', 'RETAILER');

-- NOTE: `prisma migrate dev` generated two DROP INDEX statements here, for `addresses_geo_gix`
-- and `admin_areas_geo_gix`. They have been removed deliberately.
--
-- Prisma cannot represent a GIST index on an `Unsupported("geography(...)")` column, so it does
-- not see those indexes in the datamodel, concludes they are drift, and drops them. Dropping
-- them would silently turn every radius search into a full table scan.
--
-- Any future `migrate dev` will re-emit these DROPs. They must be removed from the generated
-- migration every time. See docs/DEVELOPMENT.md.

-- CreateTable
CREATE TABLE "farmer_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "bio" TEXT,
    "verification_status" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verified_at" TIMESTAMP(3),
    "nid_hash" TEXT,
    "settlement_rail" "SettlementRail" NOT NULL DEFAULT 'AGENT_CASH',
    "payout_account_ref" TEXT,
    "payout_account_name" TEXT,
    "payout_verified_at" TIMESTAMP(3),
    "payout_changed_at" TIMESTAMP(3),
    "risk_tier" TEXT NOT NULL DEFAULT 'NEW',
    "settlement_hold_hours_override" INTEGER,
    "rating_sum_stars_milli" INTEGER NOT NULL DEFAULT 0,
    "rating_count" INTEGER NOT NULL DEFAULT 0,
    "orders_accepted" INTEGER NOT NULL DEFAULT 0,
    "orders_completed" INTEGER NOT NULL DEFAULT 0,
    "orders_cancelled_by_seller" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "farmer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consumer_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "default_address_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consumer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retailer_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "business_name" TEXT NOT NULL,
    "business_type" TEXT,
    "trade_licence_number" TEXT,
    "bin_number" TEXT,
    "verification_status" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retailer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farms" (
    "id" UUID NOT NULL,
    "farmer_profile_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "admin_area_id" UUID NOT NULL,
    "village_or_area" TEXT,
    "address_line" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "precision" "LocationPrecision" NOT NULL DEFAULT 'AREA_CENTROID',
    "land_area_decimals" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "farms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_categories" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_bn" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_bn" TEXT NOT NULL,
    "search_terms" TEXT[],
    "base_unit" "BaseUnit" NOT NULL,
    "default_sale_unit" "SaleUnit" NOT NULL,
    "perishability" "PerishabilityClass" NOT NULL,
    "default_shelf_life_hours" INTEGER NOT NULL,
    "image_key" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_varieties" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "name_en" TEXT NOT NULL,
    "name_bn" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "product_varieties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listings" (
    "id" UUID NOT NULL,
    "farm_id" UUID NOT NULL,
    "farmer_profile_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variety_id" UUID,
    "grade" "QualityGrade" NOT NULL DEFAULT 'UNGRADED',
    "title" TEXT,
    "description" TEXT,
    "sale_unit" TEXT NOT NULL,
    "sale_unit_in_base_units" BIGINT NOT NULL,
    "unit_price_poisha" BIGINT NOT NULL,
    "quantity_total_base" BIGINT NOT NULL,
    "quantity_available_base" BIGINT NOT NULL,
    "quantity_reserved_base" BIGINT NOT NULL DEFAULT 0,
    "min_order_base" BIGINT NOT NULL DEFAULT 0,
    "allows_partial_fill" BOOLEAN NOT NULL DEFAULT false,
    "harvested_at" TIMESTAMP(3),
    "expected_harvest_at" TIMESTAMP(3),
    "available_from" TIMESTAMP(3) NOT NULL,
    "available_to" TIMESTAMP(3) NOT NULL,
    "shelf_life_hours" INTEGER,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "admin_area_id" UUID NOT NULL,
    "precision" "LocationPrecision" NOT NULL DEFAULT 'AREA_CENTROID',
    "offers_pickup" BOOLEAN NOT NULL DEFAULT true,
    "offers_seller_delivery" BOOLEAN NOT NULL DEFAULT false,
    "seller_delivery_radius_m" INTEGER,
    "offers_funded_delivery" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "moderation_flag" TEXT,
    "published_at" TIMESTAMP(3),
    "created_by_user_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_reservations" (
    "id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "order_id" UUID,
    "buyer_user_id" UUID NOT NULL,
    "quantity_base" BIGINT NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'HELD',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "released_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_quotes" (
    "id" UUID NOT NULL,
    "buyer_user_id" UUID NOT NULL,
    "seller_farmer_profile_id" UUID NOT NULL,
    "delivery_address_id" UUID,
    "fulfilment_mode" "FulfilmentMode" NOT NULL,
    "lines" JSONB NOT NULL,
    "subtotal_poisha" BIGINT NOT NULL,
    "delivery_fee_poisha" BIGINT NOT NULL DEFAULT 0,
    "handling_fee_poisha" BIGINT NOT NULL DEFAULT 0,
    "platform_fee_poisha" BIGINT NOT NULL DEFAULT 0,
    "buyer_total_poisha" BIGINT NOT NULL,
    "seller_gross_poisha" BIGINT NOT NULL,
    "commission_poisha" BIGINT NOT NULL,
    "commission_bps" INTEGER NOT NULL,
    "seller_net_poisha" BIGINT NOT NULL,
    "delivery_funding_model" "DeliveryFundingModel" NOT NULL DEFAULT 'COST_RECOVERING',
    "delivery_tariff_poisha" BIGINT NOT NULL DEFAULT 0,
    "delivery_funded_by_seller_poisha" BIGINT NOT NULL DEFAULT 0,
    "delivery_funded_by_retailer_poisha" BIGINT NOT NULL DEFAULT 0,
    "promotional_subsidy_poisha" BIGINT NOT NULL DEFAULT 0,
    "subsidy_reason" TEXT,
    "contribution_margin_poisha" BIGINT NOT NULL,
    "expected_cost_poisha" BIGINT NOT NULL,
    "distance_meters" INTEGER,
    "distance_source" TEXT,
    "breakdown" JSONB NOT NULL,
    "payment_method" TEXT,
    "pricing_version" TEXT NOT NULL,
    "config_versions" JSONB NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "consumed_by_order_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "order_number" TEXT NOT NULL,
    "buyer_user_id" UUID NOT NULL,
    "seller_farmer_profile_id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "fulfilment_mode" "FulfilmentMode" NOT NULL,
    "buyer_segment" "BuyerSegment" NOT NULL,
    "payment_method" "PaymentMethod" NOT NULL,
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "subtotal_poisha" BIGINT NOT NULL,
    "delivery_fee_poisha" BIGINT NOT NULL,
    "handling_fee_poisha" BIGINT NOT NULL,
    "platform_fee_poisha" BIGINT NOT NULL,
    "buyer_total_poisha" BIGINT NOT NULL,
    "seller_gross_poisha" BIGINT NOT NULL,
    "commission_poisha" BIGINT NOT NULL,
    "commission_bps" INTEGER NOT NULL,
    "seller_net_poisha" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "delivery_funding_model" "DeliveryFundingModel" NOT NULL DEFAULT 'COST_RECOVERING',
    "delivery_tariff_poisha" BIGINT NOT NULL DEFAULT 0,
    "delivery_funded_by_seller_poisha" BIGINT NOT NULL DEFAULT 0,
    "delivery_funded_by_retailer_poisha" BIGINT NOT NULL DEFAULT 0,
    "promotional_subsidy_poisha" BIGINT NOT NULL DEFAULT 0,
    "subsidy_reason" TEXT,
    "subsidy_approved_by_id" UUID,
    "contribution_margin_poisha" BIGINT NOT NULL,
    "fault_party" "FaultParty",
    "fault_note" TEXT,
    "cancellation_fee_poisha" BIGINT NOT NULL DEFAULT 0,
    "cancellation_fee_to_farmer_poisha" BIGINT NOT NULL DEFAULT 0,
    "cancellation_fee_to_platform_poisha" BIGINT NOT NULL DEFAULT 0,
    "delivery_recipient_name" TEXT,
    "delivery_recipient_phone" TEXT,
    "delivery_address_line" TEXT,
    "delivery_area_id" UUID,
    "delivery_latitude" DECIMAL(9,6),
    "delivery_longitude" DECIMAL(9,6),
    "distance_meters" INTEGER,
    "acceptance_deadline" TIMESTAMP(3) NOT NULL,
    "placed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),
    "ready_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by" "CancelledBy",
    "cancellation_reason" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_name_en" TEXT NOT NULL,
    "product_name_bn" TEXT NOT NULL,
    "variety_name" TEXT,
    "grade" "QualityGrade" NOT NULL,
    "farm_name" TEXT NOT NULL,
    "sale_unit" TEXT NOT NULL,
    "sale_unit_in_base_units" BIGINT NOT NULL,
    "unit_price_poisha" BIGINT NOT NULL,
    "quantity_base" BIGINT NOT NULL,
    "line_total_poisha" BIGINT NOT NULL,
    "harvested_at" TIMESTAMP(3),
    "delivered_quantity_base" BIGINT,
    "adjustment_poisha" BIGINT,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_events" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "from_status" "OrderStatus",
    "to_status" "OrderStatus" NOT NULL,
    "actor_user_id" UUID,
    "actor_role" "Role",
    "reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "farmer_profiles_user_id_key" ON "farmer_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "farmer_profiles_nid_hash_key" ON "farmer_profiles"("nid_hash");

-- CreateIndex
CREATE INDEX "farmer_profiles_verification_status_idx" ON "farmer_profiles"("verification_status");

-- CreateIndex
CREATE UNIQUE INDEX "consumer_profiles_user_id_key" ON "consumer_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "retailer_profiles_user_id_key" ON "retailer_profiles"("user_id");

-- CreateIndex
CREATE INDEX "farms_farmer_profile_id_idx" ON "farms"("farmer_profile_id");

-- CreateIndex
CREATE INDEX "farms_admin_area_id_idx" ON "farms"("admin_area_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_categories_slug_key" ON "product_categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");

-- CreateIndex
CREATE INDEX "products_category_id_is_active_idx" ON "products"("category_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "product_varieties_product_id_name_en_key" ON "product_varieties"("product_id", "name_en");

-- CreateIndex
CREATE INDEX "listings_status_available_to_idx" ON "listings"("status", "available_to");

-- CreateIndex
CREATE INDEX "listings_product_id_status_idx" ON "listings"("product_id", "status");

-- CreateIndex
CREATE INDEX "listings_farmer_profile_id_status_idx" ON "listings"("farmer_profile_id", "status");

-- CreateIndex
CREATE INDEX "listings_admin_area_id_status_idx" ON "listings"("admin_area_id", "status");

-- CreateIndex
CREATE INDEX "listing_reservations_listing_id_status_idx" ON "listing_reservations"("listing_id", "status");

-- CreateIndex
CREATE INDEX "listing_reservations_status_expires_at_idx" ON "listing_reservations"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "order_quotes_consumed_by_order_id_key" ON "order_quotes"("consumed_by_order_id");

-- CreateIndex
CREATE INDEX "order_quotes_buyer_user_id_created_at_idx" ON "order_quotes"("buyer_user_id", "created_at");

-- CreateIndex
CREATE INDEX "order_quotes_expires_at_idx" ON "order_quotes"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");

-- CreateIndex
CREATE UNIQUE INDEX "orders_quote_id_key" ON "orders"("quote_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_idempotency_key_key" ON "orders"("idempotency_key");

-- CreateIndex
CREATE INDEX "orders_buyer_user_id_status_placed_at_idx" ON "orders"("buyer_user_id", "status", "placed_at");

-- CreateIndex
CREATE INDEX "orders_seller_farmer_profile_id_status_placed_at_idx" ON "orders"("seller_farmer_profile_id", "status", "placed_at");

-- CreateIndex
CREATE INDEX "orders_status_acceptance_deadline_idx" ON "orders"("status", "acceptance_deadline");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_items_listing_id_idx" ON "order_items"("listing_id");

-- CreateIndex
CREATE INDEX "order_events_order_id_created_at_idx" ON "order_events"("order_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "order_events_order_id_sequence_key" ON "order_events"("order_id", "sequence");

-- AddForeignKey
ALTER TABLE "farmer_profiles" ADD CONSTRAINT "farmer_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consumer_profiles" ADD CONSTRAINT "consumer_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retailer_profiles" ADD CONSTRAINT "retailer_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farms" ADD CONSTRAINT "farms_farmer_profile_id_fkey" FOREIGN KEY ("farmer_profile_id") REFERENCES "farmer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "farms" ADD CONSTRAINT "farms_admin_area_id_fkey" FOREIGN KEY ("admin_area_id") REFERENCES "admin_areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_varieties" ADD CONSTRAINT "product_varieties_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_farm_id_fkey" FOREIGN KEY ("farm_id") REFERENCES "farms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_farmer_profile_id_fkey" FOREIGN KEY ("farmer_profile_id") REFERENCES "farmer_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_admin_area_id_fkey" FOREIGN KEY ("admin_area_id") REFERENCES "admin_areas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_reservations" ADD CONSTRAINT "listing_reservations_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_reservations" ADD CONSTRAINT "listing_reservations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "order_quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================
-- Phase 2 database guarantees
-- ===========================================================================
--
-- Everything below is hand-authored because Prisma cannot express it. These objects are part of
-- the SECURITY MODEL, not a convenience: they are the last line of defence when application code
-- has a bug, and they enforce two approved product decisions that a busy ops interface would
-- otherwise skip -- no unexplained subsidy, and no unattributed failure.
--
-- docs/02_DATABASE.md 12, 13; docs/04_MARKETPLACE.md 3.1, 9; docs/07_SECURITY.md 2

-- --------------------------------------------------------------------- geography
--
-- Listings and farms are discovered by radius, so they carry a PostGIS point kept in step with
-- latitude/longitude by the same trigger function the Phase 1 tables use.

ALTER TABLE "farms"    ADD COLUMN "geo" geography(Point, 4326);
ALTER TABLE "listings" ADD COLUMN "geo" geography(Point, 4326);

CREATE TRIGGER farms_sync_geo
  BEFORE INSERT OR UPDATE OF latitude, longitude ON "farms"
  FOR EACH ROW EXECUTE FUNCTION langgol_sync_geo_from_latlng();

CREATE TRIGGER listings_sync_geo
  BEFORE INSERT OR UPDATE OF latitude, longitude ON "listings"
  FOR EACH ROW EXECUTE FUNCTION langgol_sync_geo_from_latlng();

-- Radius discovery: ST_DWithin against a GIST index. Haversine in SQL cannot use an index and
-- degenerates to a full scan. Named to match the Phase 1 convention. docs/02_DATABASE.md 14.
CREATE INDEX listings_geo_gix ON "listings" USING GIST ("geo");
CREATE INDEX farms_geo_gix    ON "farms"    USING GIST ("geo");

-- ------------------------------------------------------------------- inventory
--
-- Inventory can never go negative or over-reserve. The atomic conditional UPDATE in
-- docs/02_DATABASE.md 13 is the primary mechanism; this CHECK is the backstop if that query is
-- ever bypassed. Overselling destroys farmer trust faster than any bug.

ALTER TABLE "listings" ADD CONSTRAINT "listings_qty_sane" CHECK (
  quantity_available_base >= 0
  AND quantity_reserved_base >= 0
  AND quantity_available_base + quantity_reserved_base <= quantity_total_base
  AND unit_price_poisha > 0
  AND sale_unit_in_base_units > 0
  AND min_order_base >= 0
);

ALTER TABLE "listings" ADD CONSTRAINT "listings_window_sane" CHECK (available_to > available_from);

ALTER TABLE "listing_reservations" ADD CONSTRAINT "reservations_qty_positive"
  CHECK (quantity_base > 0);

-- Only one live reservation per (listing, order).
CREATE UNIQUE INDEX "reservations_active_unique"
  ON "listing_reservations" (listing_id, order_id)
  WHERE status IN ('HELD', 'COMMITTED') AND order_id IS NOT NULL;

-- --------------------------------------------------------------------- quotes
--
-- The quote is the pricing authority and the anti-tampering mechanism, so its guarantees are
-- enforced by the database rather than trusted to the checkout code path. docs/04 8.

ALTER TABLE "order_quotes" ADD CONSTRAINT "quotes_amounts_nonneg" CHECK (
  subtotal_poisha >= 0 AND delivery_fee_poisha >= 0 AND handling_fee_poisha >= 0
  AND platform_fee_poisha >= 0 AND buyer_total_poisha >= 0
  AND seller_gross_poisha >= 0 AND commission_poisha >= 0 AND seller_net_poisha >= 0
  AND delivery_tariff_poisha >= 0 AND delivery_funded_by_seller_poisha >= 0
  AND delivery_funded_by_retailer_poisha >= 0 AND promotional_subsidy_poisha >= 0
);

ALTER TABLE "order_quotes" ADD CONSTRAINT "quotes_total_consistent" CHECK (
  buyer_total_poisha
    = subtotal_poisha + delivery_fee_poisha + handling_fee_poisha + platform_fee_poisha
);

ALTER TABLE "order_quotes" ADD CONSTRAINT "quotes_seller_net_consistent" CHECK (
  seller_net_poisha = seller_gross_poisha - commission_poisha - delivery_funded_by_seller_poisha
);

-- The funding invariant, in the database: what the buyer pays, what the seller and retailer
-- fund, and what the platform subsidises must reconcile to the tariff exactly. docs/04 3.1.
ALTER TABLE "order_quotes" ADD CONSTRAINT "quotes_funding_balances" CHECK (
  delivery_tariff_poisha
    = delivery_fee_poisha + delivery_funded_by_seller_poisha
      + delivery_funded_by_retailer_poisha + promotional_subsidy_poisha
);

-- No unexplained subsidy. An approved decision, expressed where it cannot be skipped.
ALTER TABLE "order_quotes" ADD CONSTRAINT "quotes_subsidy_requires_reason" CHECK (
  promotional_subsidy_poisha = 0 OR subsidy_reason IS NOT NULL
);

-- And the reason must come from the controlled vocabulary. docs/10_ECONOMIC_MEASUREMENT 9.3.
ALTER TABLE "order_quotes" ADD CONSTRAINT "quotes_subsidy_reason_vocabulary" CHECK (
  subsidy_reason IS NULL OR subsidy_reason IN (
    'MARKET_SEEDING', 'BASKET_SIZE_EXPERIMENT', 'DELIVERY_MODEL_EXPERIMENT',
    'NEW_BUYER_ACQUISITION', 'NEW_FARMER_ACTIVATION', 'SERVICE_RECOVERY',
    'OPS_ERROR', 'ROUTE_DENSITY_BUILD'
  )
);

ALTER TABLE "order_quotes" ADD CONSTRAINT "quotes_funding_model_consistent" CHECK (
  (delivery_funding_model <> 'SELLER_FUNDED'   OR delivery_funded_by_seller_poisha   > 0) AND
  (delivery_funding_model <> 'RETAILER_FUNDED' OR delivery_funded_by_retailer_poisha > 0) AND
  (delivery_funding_model <> 'FREE_DELIVERY'   OR delivery_fee_poisha = 0)
);

-- Every quote must be reproducible: the pricing version and the config versions it used are
-- not optional. docs/04 8.
ALTER TABLE "order_quotes" ADD CONSTRAINT "quotes_reproducible" CHECK (
  length(pricing_version) > 0 AND config_versions IS NOT NULL
);

-- A quote is single-use. consumed_at and consumed_by_order_id move together or not at all; the
-- UNIQUE index on consumed_by_order_id makes a second order against the same quote impossible.
ALTER TABLE "order_quotes" ADD CONSTRAINT "quotes_consumption_atomic" CHECK (
  (consumed_at IS NULL AND consumed_by_order_id IS NULL)
  OR (consumed_at IS NOT NULL AND consumed_by_order_id IS NOT NULL)
);

-- --------------------------------------------------------------------- orders

ALTER TABLE "orders" ADD CONSTRAINT "orders_amounts_nonneg" CHECK (
  subtotal_poisha >= 0 AND delivery_fee_poisha >= 0 AND handling_fee_poisha >= 0
  AND platform_fee_poisha >= 0 AND buyer_total_poisha >= 0
  AND seller_gross_poisha >= 0 AND commission_poisha >= 0 AND seller_net_poisha >= 0
);

ALTER TABLE "orders" ADD CONSTRAINT "orders_total_consistent" CHECK (
  buyer_total_poisha
    = subtotal_poisha + delivery_fee_poisha + handling_fee_poisha + platform_fee_poisha
);

ALTER TABLE "orders" ADD CONSTRAINT "orders_seller_net_consistent" CHECK (
  seller_net_poisha = seller_gross_poisha - commission_poisha - delivery_funded_by_seller_poisha
);

ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_funding_nonneg" CHECK (
  delivery_tariff_poisha >= 0
  AND delivery_funded_by_seller_poisha >= 0
  AND delivery_funded_by_retailer_poisha >= 0
  AND promotional_subsidy_poisha >= 0
);

ALTER TABLE "orders" ADD CONSTRAINT "orders_funding_balances" CHECK (
  delivery_tariff_poisha
    = delivery_fee_poisha + delivery_funded_by_seller_poisha
      + delivery_funded_by_retailer_poisha + promotional_subsidy_poisha
);

ALTER TABLE "orders" ADD CONSTRAINT "orders_subsidy_requires_reason" CHECK (
  promotional_subsidy_poisha = 0 OR subsidy_reason IS NOT NULL
);

ALTER TABLE "orders" ADD CONSTRAINT "orders_subsidy_reason_vocabulary" CHECK (
  subsidy_reason IS NULL OR subsidy_reason IN (
    'MARKET_SEEDING', 'BASKET_SIZE_EXPERIMENT', 'DELIVERY_MODEL_EXPERIMENT',
    'NEW_BUYER_ACQUISITION', 'NEW_FARMER_ACTIVATION', 'SERVICE_RECOVERY',
    'OPS_ERROR', 'ROUTE_DENSITY_BUILD'
  )
);

ALTER TABLE "orders" ADD CONSTRAINT "orders_funding_model_consistent" CHECK (
  (delivery_funding_model <> 'SELLER_FUNDED'   OR delivery_funded_by_seller_poisha   > 0) AND
  (delivery_funding_model <> 'RETAILER_FUNDED' OR delivery_funded_by_retailer_poisha > 0) AND
  (delivery_funding_model <> 'FREE_DELIVERY'   OR delivery_fee_poisha = 0)
);

ALTER TABLE "orders" ADD CONSTRAINT "orders_cancellation_fee_allocated" CHECK (
  cancellation_fee_poisha
    = cancellation_fee_to_farmer_poisha + cancellation_fee_to_platform_poisha
);

-- No unattributed failure. The second approved decision the database refuses to let anyone skip.
ALTER TABLE "orders" ADD CONSTRAINT "orders_fault_required" CHECK (
  status NOT IN ('CANCELLED', 'FAILED', 'REFUNDED') OR fault_party IS NOT NULL
);

ALTER TABLE "orders" ADD CONSTRAINT "orders_commission_bps_sane" CHECK (
  commission_bps >= 0 AND commission_bps <= 10000
);

-- --------------------------------------------------------------- append-only log
--
-- The order status column is a projection of order_events, so the log itself must be immutable.
-- A rule rather than a permission: it holds for the application role and for anyone with a psql
-- session. docs/02_DATABASE.md 12.

-- Note: order_items deliberately stays mutable. Fresh produce delivered rarely equals fresh
-- produce ordered, and delivered_quantity_base / adjustment_poisha are filled at fulfilment.
CREATE RULE order_events_no_update AS ON UPDATE TO "order_events" DO INSTEAD NOTHING;
CREATE RULE order_events_no_delete AS ON DELETE TO "order_events" DO INSTEAD NOTHING;
