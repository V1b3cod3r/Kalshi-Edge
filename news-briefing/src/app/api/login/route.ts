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
    return NextResponse.json({ error: "wrong password" }, { status: 401 });
  }
  await setAuthCookie();
  return NextResponse.json({ ok: true });
}
