import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";

const ETL_TIMEOUT_MS = 300_000; // 5 minutes (Lapis fetch + Zoho P&L per month)

function findPython(): string {
  return process.platform === "win32" ? "py" : "python3";
}

export async function POST(req: NextRequest) {
  let dateFrom: string;
  let dateTo: string;
  let force = false;

  try {
    const body = await req.json();
    dateFrom = body.date_from;
    dateTo   = body.date_to;
    force    = body.force === true;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!dateFrom || !dateTo) {
    return NextResponse.json({ error: "date_from and date_to are required" }, { status: 400 });
  }

  const scriptPath = path.join(process.cwd(), "etl", "etl_lapis_spa_revenue.py");
  const etlDir     = path.join(process.cwd(), "etl");
  const pythonBin  = findPython();

  const args = [
    scriptPath,
    "--date-from", dateFrom,
    "--date-to",   dateTo,
    ...(force ? ["--force"] : []),
  ];

  return new Promise<NextResponse>((resolve) => {
    const proc = spawn(pythonBin, args, {
      cwd:   etlDir,
      stdio: "pipe",
      env:   { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    const timer = setTimeout(() => {
      proc.kill();
      resolve(NextResponse.json(
        { error: "ETL timed out after 5 minutes", stdout, stderr },
        { status: 504 }
      ));
    }, ETL_TIMEOUT_MS);

    proc.on("close", (code: number | null) => {
      clearTimeout(timer);
      if (code === 0) {
        const match = stdout.match(/(\d+)\s+total rows upserted/);
        const rows  = match ? parseInt(match[1], 10) : null;
        resolve(NextResponse.json({ status: "ok", rows_upserted: rows, log: stdout }));
      } else {
        resolve(NextResponse.json(
          { error: `ETL exited with code ${code}`, stdout, stderr },
          { status: 500 }
        ));
      }
    });

    proc.on("error", (err: Error) => {
      clearTimeout(timer);
      resolve(NextResponse.json(
        { error: `Failed to start ETL: ${err.message}`, stderr },
        { status: 500 }
      ));
    });
  });
}
