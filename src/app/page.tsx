import { createClient } from "@/lib/supabase/server";
import { Dashboard } from "@/components/dashboard";
import type { Booking, Resource } from "@/lib/types";

export default async function Home() {
  const initialNow = new Date();
  let resources: Resource[] = [];
  let bookings: Booking[] = [];
  let user: { id: string } | null = null;
  let userEmail: string | null = null;
  let role: "admin" | "member" | null = null;
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (configured) {
    const supabase = await createClient();
    const auth = await supabase.auth.getUser();
    user = auth.data.user;
    userEmail = auth.data.user?.email ?? null;
    const [profileData, resourceData, bookingData] = await Promise.all([
      user ? supabase.from("profiles").select("role").eq("id", user.id).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from("resources").select("*").order("name"),
      supabase.from("bookings").select("id,resource_id,user_id,starts_at,ends_at,status,note,resources(name)").gte("ends_at", initialNow.toISOString()).order("starts_at").limit(100),
    ]);
    role = profileData.data?.role ?? null;
    resources = (resourceData.data ?? []) as Resource[];
    bookings = (bookingData.data ?? []) as Booking[];
  }
  return <Dashboard initialResources={resources} initialBookings={bookings} configured={configured} signedIn={Boolean(user)} role={role} currentUserId={user?.id ?? null} userEmail={userEmail} initialNow={initialNow.toISOString()} />;
}
