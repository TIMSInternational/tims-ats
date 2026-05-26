import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const hostname = request.headers.get("host") || "";
  const url = request.nextUrl.clone();

  // Extract subdomain
  const subdomain = hostname.split(".")[0];

  // app.tims.com → admin routes
  if (subdomain === "app") {
    // Admin panel — auth required (TODO: implement)
    return NextResponse.next();
  }

  // {client}.tims.com → portal routes
  if (subdomain !== "localhost" && subdomain !== "app" && subdomain !== "www") {
    // Rewrite to portal routes with org context
    url.pathname = `/(portal)${url.pathname}`;
    // TODO: lookup org by slug, inject into headers
    const response = NextResponse.rewrite(url);
    response.headers.set("x-org-slug", subdomain);
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/).*)"],
};
