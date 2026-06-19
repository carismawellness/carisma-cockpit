"use client";

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import type { AdsApiResponse, BrandSlug } from "@/lib/types/ads";

async function fetchAds(
  platform: "meta" | "google",
  brand: BrandSlug,
  dateFrom: Date,
  dateTo: Date,
): Promise<AdsApiResponse> {
  const params = new URLSearchParams({
    brand,
    from: format(dateFrom, "yyyy-MM-dd"),
    to: format(dateTo, "yyyy-MM-dd"),
  });

  const res = await fetch(`/api/ads/${platform}?${params}`);
  const json: AdsApiResponse = await res.json();

  if (!res.ok && !json.error) {
    throw new Error(`API returned ${res.status}`);
  }

  return json;
}

export function useMetaCampaigns(
  brand: BrandSlug,
  dateFrom: Date,
  dateTo: Date,
) {
  return useQuery({
    queryKey: [
      "meta-campaigns",
      brand,
      format(dateFrom, "yyyy-MM-dd"),
      format(dateTo, "yyyy-MM-dd"),
    ],
    queryFn: () => fetchAds("meta", brand, dateFrom, dateTo),
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 1,
  });
}

export function useGoogleCampaigns(
  brand: BrandSlug,
  dateFrom: Date,
  dateTo: Date,
) {
  return useQuery({
    queryKey: [
      "google-campaigns",
      brand,
      format(dateFrom, "yyyy-MM-dd"),
      format(dateTo, "yyyy-MM-dd"),
    ],
    queryFn: () => fetchAds("google", brand, dateFrom, dateTo),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

// ---------------------------------------------------------------------------
// Supabase-backed hooks — read from meta_campaigns_daily / google_campaigns_daily
// These use peak_ctr stored by the ETL for accurate creative fatigue scoring
// and enable YoY comparison via historical data.
// ---------------------------------------------------------------------------

async function fetchAdsFromDb(
  platform: "meta-db" | "google-db",
  brand: BrandSlug,
  dateFrom: Date,
  dateTo: Date,
): Promise<AdsApiResponse> {
  const params = new URLSearchParams({
    brand,
    from: format(dateFrom, "yyyy-MM-dd"),
    to:   format(dateTo, "yyyy-MM-dd"),
  });

  const res = await fetch(`/api/ads/${platform}?${params}`);
  const json: AdsApiResponse = await res.json();

  if (!res.ok && !json.error) {
    throw new Error(`DB API returned ${res.status}`);
  }

  return json;
}

export function useMetaCampaignsFromDb(
  brand: BrandSlug,
  dateFrom: Date,
  dateTo: Date,
) {
  return useQuery({
    queryKey: [
      "meta-campaigns-db",
      brand,
      format(dateFrom, "yyyy-MM-dd"),
      format(dateTo, "yyyy-MM-dd"),
    ],
    queryFn: () => fetchAdsFromDb("meta-db", brand, dateFrom, dateTo),
    staleTime: 10 * 60 * 1000, // 10 min — DB data changes only on ETL runs
    retry: 1,
  });
}

export function useGoogleCampaignsFromDb(
  brand: BrandSlug,
  dateFrom: Date,
  dateTo: Date,
) {
  return useQuery({
    queryKey: [
      "google-campaigns-db",
      brand,
      format(dateFrom, "yyyy-MM-dd"),
      format(dateTo, "yyyy-MM-dd"),
    ],
    queryFn: () => fetchAdsFromDb("google-db", brand, dateFrom, dateTo),
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
}
