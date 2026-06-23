import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function clearSession(response: NextResponse) {
  response.cookies.set("fhdc_recalldesk_session", "", {
    path: "/",
    maxAge: 0,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  response.cookies.set("session", "", {
    path: "/",
    maxAge: 0,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

export async function POST() {
  const response = NextResponse.json({ ok: true });
  clearSession(response);
  return response;
}

export async function GET() {
  const response = NextResponse.redirect(new URL("/login?loggedOut=1", "https://fhdc-recalldesk.onrender.com"));
  response.headers.set("Location", "/login?loggedOut=1");
  clearSession(response);
  return response;
}
