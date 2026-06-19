import { NextRequest, NextResponse } from "next/server";
import { runAestheticsEbitdaCheck } from "@/lib/etl/ebitda-check-aesthetics";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let dateFrom: string, dateTo: string;
  try {
    const body = await req.json();
    dateFrom = body.date_from;
    dateTo   = body.date_to;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: "date_from and date_to are required" }, { status: 400 });
  }

  try {
    const result = await runAestheticsEbitdaCheck(dateFrom, dateTo);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
