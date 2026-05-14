import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";

const TIMEOUT_MS = 60_000; // 60 s — read-only Zoho call, no upserts

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

  const scriptPath = path.join(process.cwd(), "etl", "etl_ebitda_check.py");
  const etlDir     = path.join(process.cwd(), "etl");

  const args = [scriptPath, "--date-from", dateFrom, "--date-to", dateTo];

  return new Promise<NextResponse>((resolve) => {
    const proc = spawn(findPython(), args, {
      cwd: etlDir, stdio: "pipe", env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (c: Buffer) => { stdout += c.toString(); });
    proc.stderr?.on("data", (c: Buffer) => { stderr += c.toString(); });

    const timer = setTimeout(() => {
      proc.kill();
      resolve(NextResponse.json({ error: "Check timed out after 60s", stderr }, { status: 504 }));
    }, TIMEOUT_MS);

    proc.on("close", (code: number | null) => {
      clearTimeout(timer);
      if (code === 0) {
        try {
          // Script prints JSON to stdout
          const data = JSON.parse(stdout);
          resolve(NextResponse.json(data));
        } catch {
          resolve(NextResponse.json({ error: "Failed to parse check output", raw: stdout }, { status: 500 }));
        }
      } else {
        resolve(NextResponse.json(
          { error: `Check exited with code ${code}`, stdout, stderr },
          { status: 500 },
        ));
      }
    });

    proc.on("error", (err: Error) => {
      clearTimeout(timer);
      resolve(NextResponse.json(
        { error: `Failed to start check: ${err.message}` },
        { status: 500 },
      ));
    });
  });
}
