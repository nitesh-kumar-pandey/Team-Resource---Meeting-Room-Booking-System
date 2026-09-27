import { createEvent } from "ics";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("Invalid booking", { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Sign in required", { status: 401 });
  const { data: booking, error } = await supabase.from("bookings")
    .select("id,user_id,starts_at,ends_at,status,note,resources(name,description)")
    .eq("id", id).eq("user_id", user.id).single();
  if (error || !booking) return new Response("Booking not found", { status: 404 });
  if (booking.status !== "approved") return new Response("Only confirmed bookings can be exported", { status: 409 });
  const resource = Array.isArray(booking.resources) ? booking.resources[0] : booking.resources;
  const start = new Date(booking.starts_at);
  const end = new Date(booking.ends_at);
  const result = createEvent({
    uid: booking.id,
    title: `${resource?.name ?? "Resource booking"}${booking.note ? ` — ${booking.note}` : ""}`,
    description: resource?.description ?? "",
    start: [start.getUTCFullYear(), start.getUTCMonth() + 1, start.getUTCDate(), start.getUTCHours(), start.getUTCMinutes()],
    startInputType: "utc",
    end: [end.getUTCFullYear(), end.getUTCMonth() + 1, end.getUTCDate(), end.getUTCHours(), end.getUTCMinutes()],
    endInputType: "utc",
    status: "CONFIRMED",
    productId: "gather/team-resource-booking",
  });
  if (result.error || !result.value) return new Response("Could not generate calendar file", { status: 500 });
  return new Response(result.value, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="booking-${booking.id}.ics"`,
      "Cache-Control": "private, no-store",
    },
  });
}
