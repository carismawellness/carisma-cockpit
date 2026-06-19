"use client";

import { useQuery } from "@tanstack/react-query";

export interface AttendanceRecord {
  id: number;
  employee_id: string;
  employee_name: string;
  date: string;
  clock_in: string | null;
  clock_out: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  is_absent: boolean;
  is_late: boolean;
  left_early: boolean;
  minutes_late: number;
  minutes_early_out: number;
  hours_worked: number | null;
  location_name: string | null;
}

export interface AttendanceSummary {
  total_rostered: number;
  total_absent: number;
  total_late: number;
  total_left_early: number;
}

export interface AttendanceResponse {
  records: AttendanceRecord[];
  summary: AttendanceSummary;
}

export type AttendanceFilter = "all" | "late" | "early" | "issues";

export function useAttendance(from: string, to: string, filter: AttendanceFilter = "all") {
  return useQuery<AttendanceResponse>({
    queryKey: ["attendance", from, to, filter],
    queryFn: async () => {
      const params = new URLSearchParams({ from, to });
      if (filter === "late")   params.set("is_late", "true");
      if (filter === "early")  params.set("left_early", "true");
      if (filter === "issues") params.set("has_issue", "true");
      const res = await fetch(`/api/hr/attendance?${params}`);
      if (!res.ok) throw new Error(`Attendance API error: ${res.status}`);
      return res.json() as Promise<AttendanceResponse>;
    },
    staleTime: 5 * 60 * 1000,
    gcTime:    30 * 60 * 1000,
  });
}
