"use server";

import { bookingInputSchema, resourceInputSchema } from "@/lib/validators";
import { createClient } from "@/lib/supabase/server";

export async function createBookingAction(input: unknown) {
  const parsed = bookingInputSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid booking details" };
  const value = parsed.data;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in to book a resource" };
  const { data, error } = await supabase.rpc("create_booking_series", {
    p_resource_id: value.resourceId,
    p_starts_at: value.startsAt,
    p_ends_at: value.endsAt,
    p_weeks: value.recurrence?.weeks ?? 1,
    p_note: value.note || null,
  });
  if (error) {
    if (error.code === "23P01") {
      await supabase.rpc("record_booking_conflict", { p_resource_id: value.resourceId });
      return { error: "That time was just booked. Choose another slot." };
    }
    return { error: error.message };
  }
  return { ids: data ?? [] };
}

export async function createResourceAction(input: unknown) {
  const parsed = resourceInputSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid resource details" };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in as an admin to create resources" };
  const { requiresApproval, ...resourceFields } = parsed.data;
  const { data, error } = await supabase.from("resources").insert({ ...resourceFields, requires_approval: requiresApproval, created_by: user.id }).select("*").single();
  return error ? { error: error.message } : { resource: data };
}

export async function reviewBookingAction(bookingId: string, status: "approved" | "rejected") {
  const id = bookingId;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return { error: "Invalid booking" };
  if (status !== "approved" && status !== "rejected") return { error: "Invalid review status" };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Sign in required" };
  const { error } = await supabase.rpc("review_booking", { p_booking_id: id, p_status: status });
  return error ? { error: error.message } : { ok: true };
}
