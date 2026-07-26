import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { resolveTailoredCv } from "@/lib/apply/cv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serve the tailored CV PDF the pdf mode wrote to output/ for a given offer. Inline
// so it opens in the browser. Local-first: reads the user's own output/ dir.
// Delegates matching to resolveTailoredCv so this route and the apply file-upload
// always resolve to the SAME file (previously duplicated here with a stricter
// regex that missed companies whose PDF slug is a truncated prefix of the full
// name, e.g. "Skyappz Software India Private Limited" vs the report's
// "skyappz-software" — the strict match never found the file, resolveTailoredCv's
// first-token fallback does).
export async function GET(req: NextRequest) {
  const company = (req.nextUrl.searchParams.get("company") ?? "").trim();
  if (!company) return new Response("company required", { status: 400 });

  const file = resolveTailoredCv(company);
  if (!file) return new Response("no tailored CV found for this offer", { status: 404 });

  try {
    const buf = fs.readFileSync(file);
    return new Response(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${path.basename(file)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new Response("could not read the PDF", { status: 500 });
  }
}
