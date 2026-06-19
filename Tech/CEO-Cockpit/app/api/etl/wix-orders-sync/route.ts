/**
 * POST /api/etl/wix-orders-sync
 *
 * Syncs Carisma Spa Wix eCommerce orders into wix_spa_orders.
 * Body: { date_from?: "YYYY-MM-DD", date_to?: "YYYY-MM-DD" }
 * Defaults to last 60 days.
 *
 * Uses the Wix eCommerce Orders Search API with cursor pagination.
 * WIX_API_KEY + WIX_SPA_SITE_ID must be set in env.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

const WIX_SPA_SITE_ID = "6c3d60a1-e14f-4628-bfc8-93cc3d00fca0";
const ORDERS_URL = "https://www.wixapis.com/ecom/v1/orders/search";
const PAGE_SIZE = 100;

interface WixLineItem {
  id: string;
  productName?: { original?: string };
  quantity?: number;
  price?: { amount?: string };
  totalPrice?: { amount?: string };
  catalogReference?: { catalogItemId?: string };
  descriptionLines?: Array<{
    name?: { original?: string };
    plainText?: { original?: string };
  }>;
}

interface WixOrder {
  id: string;
  number: number | string;
  createdDate: string;
  updatedDate?: string;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  currency: string;
  priceSummary?: {
    subtotal?: { amount?: string };
    discount?: { amount?: string };
    total?: { amount?: string };
  };
  lineItems?: WixLineItem[];
  billingInfo?: { contactDetails?: { firstName?: string; lastName?: string } };
  buyerInfo?: { email?: string };
  channelInfo?: { type?: string };
}

async function fetchOrdersPage(
  apiKey: string,
  siteId: string,
  dateFrom: string,
  dateTo: string,
  cursor?: string,
): Promise<{ orders: WixOrder[]; nextCursor?: string }> {
  // Wix requires $and for date range — combined { $gte, $lte } in one object is rejected
  const body: Record<string, unknown> = {
    search: {
      filter: {
        $and: [
          { createdDate: { $gte: `${dateFrom}T00:00:00.000Z` } },
          { createdDate: { $lte: `${dateTo}T23:59:59.999Z` } },
        ],
      },
      sort: [{ fieldName: "createdDate", order: "DESC" }],
      cursorPaging: { limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) },
    },
  };

  const res = await fetch(ORDERS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: apiKey,
      "wix-site-id": siteId,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Wix orders ${res.status}: ${txt.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    orders?: WixOrder[];
    metadata?: { hasNext?: boolean; cursors?: { next?: string } };
  };

  const nextCursor =
    json.metadata?.hasNext && json.metadata.cursors?.next
      ? json.metadata.cursors.next
      : undefined;

  return { orders: json.orders ?? [], nextCursor };
}

function toSupabaseRow(o: WixOrder) {
  const createdAt = new Date(o.createdDate);
  const lineItems = (o.lineItems ?? []).map((li) => ({
    id: li.id,
    name: li.productName?.original ?? "",
    quantity: li.quantity ?? 1,
    price: parseFloat(li.price?.amount ?? "0"),
    totalPrice: parseFloat(li.totalPrice?.amount ?? li.price?.amount ?? "0"),
    productId: li.catalogReference?.catalogItemId,
    options: (li.descriptionLines ?? []).map((d) => ({
      name: d.name?.original,
      value: d.plainText?.original,
    })),
  }));

  const buyer = o.billingInfo?.contactDetails;
  const buyerName = [buyer?.firstName, buyer?.lastName].filter(Boolean).join(" ") || null;
  const itemCount = lineItems.reduce((sum, li) => sum + (li.quantity ?? 1), 0);

  return {
    wix_order_id: o.id,
    order_number: typeof o.number === "string" ? parseInt(o.number, 10) : o.number,
    created_date: createdAt.toISOString().slice(0, 10),
    created_at: o.createdDate,
    updated_at: o.updatedDate ?? null,
    status: o.status,
    payment_status: o.paymentStatus,
    fulfillment_status: o.fulfillmentStatus,
    currency: o.currency ?? "EUR",
    subtotal: parseFloat(o.priceSummary?.subtotal?.amount ?? "0"),
    discount: parseFloat(o.priceSummary?.discount?.amount ?? "0"),
    total: parseFloat(o.priceSummary?.total?.amount ?? "0"),
    item_count: itemCount,
    line_items: lineItems,
    buyer_name: buyerName,
    buyer_email: o.buyerInfo?.email ?? null,
    channel_type: o.channelInfo?.type ?? null,
    etl_synced_at: new Date().toISOString(),
  };
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.WIX_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "WIX_API_KEY not configured" }, { status: 500 });
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body ok */ }

  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setDate(defaultFrom.getDate() - 60);

  const dateFrom = typeof body.date_from === "string" ? body.date_from
    : defaultFrom.toISOString().slice(0, 10);
  const dateTo = typeof body.date_to === "string" ? body.date_to
    : now.toISOString().slice(0, 10);

  const supabase = getAdminClient();
  const log: string[] = [];
  let totalFetched = 0;
  let totalUpserted = 0;

  try {
    let cursor: string | undefined;
    do {
      const { orders, nextCursor } = await fetchOrdersPage(
        apiKey, WIX_SPA_SITE_ID, dateFrom, dateTo, cursor,
      );
      cursor = nextCursor;
      totalFetched += orders.length;

      if (orders.length === 0) break;

      const rows = orders.map(toSupabaseRow);
      const { error } = await supabase
        .from("wix_spa_orders")
        .upsert(rows, { onConflict: "wix_order_id" });

      if (error) {
        log.push(`Upsert error: ${error.message}`);
      } else {
        totalUpserted += rows.length;
      }
    } while (cursor);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg, date_from: dateFrom, date_to: dateTo }, { status: 500 });
  }

  log.push(`Fetched ${totalFetched} orders, upserted ${totalUpserted} (${dateFrom} → ${dateTo})`);

  return NextResponse.json({
    status: "ok",
    date_from: dateFrom,
    date_to: dateTo,
    orders_fetched: totalFetched,
    rows_upserted: totalUpserted,
    log: log.join("\n"),
  });
}
