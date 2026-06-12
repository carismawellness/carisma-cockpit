-- Wix eCommerce orders for Carisma Spa (carismaspa.com)
-- One row per order, upserted nightly by /api/etl/wix-orders-sync.
-- Source: Wix eCommerce Orders API (POST /ecom/v1/orders/search)

CREATE TABLE IF NOT EXISTS wix_spa_orders (
    wix_order_id        TEXT PRIMARY KEY,
    order_number        INTEGER NOT NULL,
    created_date        DATE NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL,
    updated_at          TIMESTAMPTZ,
    status              TEXT NOT NULL,
    payment_status      TEXT NOT NULL,
    fulfillment_status  TEXT NOT NULL,
    currency            TEXT NOT NULL DEFAULT 'EUR',
    subtotal            NUMERIC(10, 2) NOT NULL DEFAULT 0,
    discount            NUMERIC(10, 2) NOT NULL DEFAULT 0,
    total               NUMERIC(10, 2) NOT NULL DEFAULT 0,
    item_count          INTEGER NOT NULL DEFAULT 1,
    line_items          JSONB,
    buyer_name          TEXT,
    buyer_email         TEXT,
    channel_type        TEXT,
    etl_synced_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS wix_spa_orders_created_date
    ON wix_spa_orders (created_date DESC);

CREATE INDEX IF NOT EXISTS wix_spa_orders_payment_status
    ON wix_spa_orders (payment_status, created_date DESC);
