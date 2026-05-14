import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";

const TIMEOUT_MS = 120_000;

function findPython(): string {
  return process.platform === "win32" ? "py" : "python3";
}

export async function POST(req: NextRequest) {
  let dateFrom: string;
  let dateTo: string;

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

  const scriptPath = path.join(process.cwd(), "etl", "etl_slimming_gsheet_sales.py");
  const etlDir     = path.join(process.cwd(), "etl");

  return new Promise<NextResponse>((resolve) => {
    const proc = spawn(findPython(), [scriptPath, "--date-from", dateFrom, "--date-to", dateTo], {
      cwd:   etlDir,
      stdio: "pipe",
      env:   { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (c: Buffer) => { stdout += c.toString(); });
    proc.stderr?.on("data", (c: Buffer) => { stderr += c.toString(); });

    const timer = setTimeout(() => {
      proc.kill();
      resolve(NextResponse.json({ error: "ETL timed out", stderr }, { status: 504 }));
    }, TIMEOUT_MS);

    proc.on("close", (code: number | null) => {
      clearTimeout(timer);
      if (code === 0) {
        try {
          const match = stdout.match(/\{[\s\S]*\}/);
          const data  = match ? JSON.parse(match[0]) : { log: stdout };
          resolve(NextResponse.json({ status: "ok", ...data }));
        } catch {
          resolve(NextResponse.json({ status: "ok", log: stdout }));
        }
      } else {
        resolve(NextResponse.json({ error: `ETL exited with code ${code}`, stdout, stderr }, { status: 500 }));
      }
    });

    proc.on("error", (err: Error) => {
      clearTimeout(timer);
      resolve(NextResponse.json({ error: `Failed to start ETL: ${err.message}` }, { status: 500 }));
    });
  });
}
