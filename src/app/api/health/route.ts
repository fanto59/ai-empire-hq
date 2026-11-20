/**
 * Liveness probe for cloud hosts and load balancers.
 * Deliberately reveals nothing about configuration, versions, or secrets.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    { status: "ok" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
