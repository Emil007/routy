import { NextResponse } from "next/server";

/** Return 304 when If-None-Match matches the current ETag, otherwise JSON with ETag header. */
export function conditionalJson(request: Request, etag: string, body: unknown, status = 200): NextResponse {
  const ifNoneMatch = request.headers.get("if-none-match");
  if (ifNoneMatch && ifNoneMatch.replace(/^W\//, "").replace(/"/g, "") === etag.replace(/"/g, "")) {
    return new NextResponse(null, { status: 304, headers: { ETag: `"${etag}"` } });
  }
  return NextResponse.json(body, { status, headers: { ETag: `"${etag}"` } });
}
