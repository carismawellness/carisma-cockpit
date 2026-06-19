"use client";

import { useQuery } from "@tanstack/react-query";

interface PeerRankBadgeProps {
  brand: string;
  slug: string;
  dateFrom: Date;
  dateTo: Date;
}

function pad(n: number) { return String(n).padStart(2, "0"); }
function toDateStr(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function getRankLabel(rank: number): string {
  if (rank === 1) return "🥇 #1";
  if (rank === 2) return "🥈 #2";
  if (rank === 3) return "🥉 #3";
  return `#${rank}`;
}

function getRankColors(rank: number, total: number): string {
  const pct = rank / total;
  if (rank <= 3) return "bg-amber-50 border-amber-300 text-amber-700";
  if (pct <= 0.33) return "bg-emerald-50 border-emerald-300 text-emerald-700";
  if (pct <= 0.66) return "bg-sky-50 border-sky-200 text-sky-700";
  return "bg-slate-50 border-slate-200 text-slate-600";
}

export function PeerRankBadge({ brand, slug, dateFrom, dateTo }: PeerRankBadgeProps) {
  const from = toDateStr(dateFrom);
  const to = toDateStr(dateTo);

  const { data, isLoading } = useQuery({
    queryKey: ["employee-rank", brand, slug, from, to],
    queryFn: async () => {
      const res = await fetch(
        `/api/sales/employee-rank?brand=${brand}&slug=${encodeURIComponent(slug)}&from=${from}&to=${to}`,
      );
      if (!res.ok) return null;
      return res.json() as Promise<{ rank: number | null; totalEmployees: number | null }>;
    },
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) return <div className="h-6 w-28 animate-pulse rounded-full bg-white/20" />;
  if (!data?.rank || !data?.totalEmployees || data.totalEmployees < 2) return null;

  const { rank, totalEmployees } = data;

  return (
    <div className="flex flex-col items-end gap-0.5">
      <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${getRankColors(rank, totalEmployees)}`}>
        {getRankLabel(rank)} of {totalEmployees}
      </span>
      {rank === 1 && (
        <span className="text-[10px] text-amber-300 font-semibold">Top earner!</span>
      )}
      {rank <= Math.ceil(totalEmployees * 0.33) && rank > 1 && (
        <span className="text-[10px] text-emerald-300 font-semibold">Top third!</span>
      )}
    </div>
  );
}
