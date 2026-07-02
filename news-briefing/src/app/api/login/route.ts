import { NextResponse, type NextRequest } from "next/server";
import { checkPassword, setAuthCookie } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const submitted = typeof body.password === "string" ? body.password : "";
  if (!checkPassword(submitted)) {
    // Serverless functions don't share memory across invocations, so we
    // can't track attempt counts cheaply here. A flat delay raises the
    // cost of brute-forcing without needing external state.
    await new Promise((r) => setTimeout(r, 1000));
    return NextResponse.json({ error: "wrong password" }, { status: 401 });
  }
  await setAuthCookie();
  return NextResponse.json({ ok: true });
}
