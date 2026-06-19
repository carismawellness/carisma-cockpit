export interface CrmDailyRow {
  date: string;
  brand_id: number;
  total_leads: number | null;
  leads_meta: number | null;
  leads_crm: number | null;
  total_sales: number | null;
  deposit_pct: number | null;
  avg_daily_sales: number | null;
  speed_to_lead_median_min: number | null;
  speed_to_lead_mean_min: number | null;
  conversion_rate_pct: number | null;
  total_calls: number | null;
  appointments_booked: number | null;
  unreplied_crm: number | null;
  unreplied_whatsapp: number | null;
  unreplied_email: number | null;
  unworked_leads: number | null;
}

export interface CrmByRepRow {
  date: string;
  staff_id: number;
  brand_id: number;
  team_type: 'sdr' | 'chat' | null;
  total_sales: number | null;
  dials: number | null;
  bookings: number | null;
  conversations: number | null;
  leads_assigned: number | null;
  calls_made: number | null;
  appointments_booked: number | null;
  conversion_rate_pct: number | null;
  deposit_pct: number | null;
  missed_pct: number | null;
  speed_to_lead_avg_min: number | null;
}

export interface BookingMixRow {
  date: string;
  brand_id: number;
  treatment_name: string;
  count: number;
}

export interface LeadReconRow {
  date: string;
  brand_id: number;
  leads_meta: number;
  leads_crm: number;
  delta: number;
}
