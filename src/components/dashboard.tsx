"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Bell, CalendarDays, Check, ChevronDown, Clock3, DoorOpen, Laptop, Plus, Settings2, Users, X } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import { createBookingAction, createResourceAction, reviewBookingAction } from "@/app/actions";
import { AvailabilityCalendar } from "@/components/availability-calendar";
import type { Booking, Notification, Resource } from "@/lib/types";

type Props = { initialResources: Resource[]; initialBookings: Booking[]; configured: boolean; signedIn: boolean; role: "admin" | "member" | null; currentUserId: string | null; userEmail: string | null; initialNow: string };
type Modal = "booking" | "resource" | "auth" | "notifications" | "admin" | null;

const demoResources: Resource[] = [
  { id: "demo-room-1", name: "Juniper Room", description: "A bright room for focused collaboration.", capacity: 8, requires_approval: false, kind: "room" },
  { id: "demo-room-2", name: "The Greenhouse", description: "Our large meeting room, with video conferencing.", capacity: 14, requires_approval: true, kind: "room" },
  { id: "demo-equip-1", name: "Studio kit", description: "Camera, tripod and two wireless microphones.", capacity: 1, requires_approval: false, kind: "equipment" },
];
const demoBookingsFrom = (now: string): Booking[] => {
  const base = new Date(now).getTime();
  return [
    { id: "d1", resource_id: "demo-room-1", user_id: "me", starts_at: new Date(base+3600000).toISOString(), ends_at: new Date(base+7200000).toISOString(), status: "approved", note: "Design sync", resources: { name: "Juniper Room" } },
    { id: "d2", resource_id: "demo-room-2", user_id: "me", starts_at: new Date(base+86400000).toISOString(), ends_at: new Date(base+90000000).toISOString(), status: "pending", note: "Quarterly planning", resources: { name: "The Greenhouse" } },
  ];
};
const time = (iso: string, local = false) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", ...(local ? {} : { timeZone: "UTC" }) }).format(new Date(iso));
const dateTime = (iso: string, local = false) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", ...(local ? {} : { timeZone: "UTC" }) }).format(new Date(iso));
const dateParts = (iso: string, local = false) => ({ day: new Intl.DateTimeFormat("en-US", { day: "2-digit", ...(local ? {} : { timeZone: "UTC" }) }).format(new Date(iso)), month: new Intl.DateTimeFormat("en-US", { month: "short", ...(local ? {} : { timeZone: "UTC" }) }).format(new Date(iso)) });
const sameCalendarDay = (iso: string, now: number, local = false) => {
  const options: Intl.DateTimeFormatOptions = { year: "numeric", month: "2-digit", day: "2-digit", ...(local ? {} : { timeZone: "UTC" }) };
  return new Intl.DateTimeFormat("en-CA", options).format(new Date(iso)) === new Intl.DateTimeFormat("en-CA", options).format(new Date(now));
};
const bookingResourceName = (booking: Booking) => Array.isArray(booking.resources) ? booking.resources[0]?.name : booking.resources?.name;

const localInputValue = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};
const subscribeHydration = () => () => {};
const getClientHydration = () => true;
const getServerHydration = () => false;

export function Dashboard({ initialResources, initialBookings, configured, signedIn, role, currentUserId, userEmail, initialNow }: Props) {
  const isAdmin = role === "admin";
  const hydrated = useSyncExternalStore(subscribeHydration, getClientHydration, getServerHydration);
  const [renderTimestamp, setRenderTimestamp] = useState(initialNow);
  const [resources, setResources] = useState(initialResources.length ? initialResources : configured ? [] : demoResources);
  const [bookings, setBookings] = useState(initialBookings.length ? initialBookings : configured ? [] : demoBookingsFrom(initialNow));
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [modal, setModal] = useState<Modal>(null);
  const [selectedResource, setSelectedResource] = useState("");
  const [bookingStart, setBookingStart] = useState("");
  const [bookingEnd, setBookingEnd] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [tab, setTab] = useState("Overview");
  const ownBookings = bookings.filter((booking) => booking.user_id === currentUserId || (!configured && booking.user_id === "me"));
  const supabase = useMemo(() => configured ? createClient() : null, [configured]);
  const renderNow = Date.parse(renderTimestamp);
  const nextHour = Math.ceil((renderNow + 3_600_000) / 1_800_000) * 1_800_000;
  const minimumBookingTime = localInputValue(new Date(renderNow));
  const defaultBookingStart = bookingStart || localInputValue(new Date(nextHour));
  const defaultBookingEnd = bookingEnd || localInputValue(new Date(nextHour + 3_600_000));

  useEffect(() => {
    const timer = window.setTimeout(() => setRenderTimestamp(new Date().toISOString()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!supabase || !signedIn) return;
    let channel = supabase.channel("user-notifications");
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return;
      const uid = data.user.id;
      supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(30).then(({ data: items }) => setNotifications((items ?? []) as Notification[]));
      channel = channel.on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${uid}` }, (payload) => setNotifications((n) => [payload.new as Notification, ...n]));
      channel.subscribe();
    });
    return () => { void supabase.removeChannel(channel); };
  }, [supabase, signedIn]);

  const openBooking = (resourceId = "", startsAt = "", endsAt = "") => { setSelectedResource(resourceId); setBookingStart(startsAt); setBookingEnd(endsAt); setError(""); setMessage(""); setModal("booking"); };
  const book = async (form: FormData) => {
    setLoading(true); setError(""); setMessage("");
    const resourceId = String(form.get("resourceId"));
    const startsAt = String(form.get("startsAt"));
    const endsAt = String(form.get("endsAt"));
    const weeks = Number(form.get("weeks") || 1);
    if (!startsAt || !endsAt || new Date(endsAt) <= new Date(startsAt) || new Date(endsAt).getTime() - new Date(startsAt).getTime() > 24 * 60 * 60 * 1000) { setError("Choose a valid time range of 24 hours or less."); setLoading(false); return; }
    if (!supabase || !signedIn) { setMessage("Connect Supabase and sign in to save a booking. This preview is ready to configure."); setLoading(false); return; }
    const result = await createBookingAction({ resourceId, startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(), recurrence: weeks > 1 ? { weeks } : undefined, note: String(form.get("note") || "").trim() || undefined });
    if (result.error) {
      setError(result.error);
      setLoading(false); return;
    }
    setMessage(`${weeks > 1 ? `${weeks} weekly bookings were` : "Booking was"} submitted${resources.find((r) => r.id === resourceId)?.requires_approval ? " for approval" : ""}.`);
    const { data: fresh } = await supabase.from("bookings").select("id,resource_id,user_id,starts_at,ends_at,status,note,resources(name)").in("id", result.ids);
    if (fresh) setBookings((old) => [...old, ...(fresh as Booking[])]);
    setModal(null);
    setLoading(false);
  };
  const auth = async (form: FormData) => {
    if (!supabase) return;
    setLoading(true); setError("");
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    const result = form.get("mode") === "signup" ? await supabase.auth.signUp({ email, password }) : await supabase.auth.signInWithPassword({ email, password });
    if (result.error) setError(result.error.message); else if (form.get("mode") === "signup") setMessage("Check your inbox to confirm your account, then sign in."); else window.location.reload();
    setLoading(false);
  };
  const signOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    window.location.reload();
  };
  const decide = async (bookingId: string, decision: "approved" | "rejected") => {
    if (!supabase) return;
    const result = await reviewBookingAction(bookingId, decision);
    if (result.error) setError(result.error); else { setBookings((b) => b.map((item) => item.id === bookingId ? { ...item, status: decision } : item)); setMessage(`Booking ${decision}.`); }
  };
  const addResource = async (form: FormData) => {
    if (!supabase || !signedIn) { setError("Sign in as an admin to create resources."); return; }
    setLoading(true); setError("");
    const result = await createResourceAction({ name: String(form.get("name")), description: String(form.get("description") || ""), capacity: Number(form.get("capacity")), requiresApproval: form.get("approval") === "on", kind: String(form.get("kind")) });
    if (result.error) setError(result.error); else if (result.resource) { setResources((r) => [...r, result.resource as Resource]); setMessage("Resource created."); setModal(null); }
    setLoading(false);
  };

  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="brandmark">g</span> gather</div>
      <div className="workspace">Northstar Studio <ChevronDown size={14}/></div>
      <div><p className="navlabel">Workspace</p>{[["Overview", <CalendarDays size={16} key="overview"/>], ["Bookings", <Clock3 size={16} key="bookings"/>], ["Resources", <DoorOpen size={16} key="resources"/>], ...(isAdmin ? [["Admin review", <Settings2 size={16} key="admin"/>] as [string, React.ReactNode]] : [])].map(([name, icon]) => <button className={`navitem ${tab === name ? "active" : ""}`} key={String(name)} onClick={() => { setTab(String(name)); if (name === "Admin review") setModal("admin"); if (name === "Bookings") document.getElementById("bookings")?.scrollIntoView({ behavior: "smooth" }); if (name === "Resources") document.getElementById("resources")?.scrollIntoView({ behavior: "smooth" }); }}>{icon}{name}</button>)}</div>
      <div className="sidebar-bottom"><p className="navlabel">Your team</p><button className="navitem"><Users size={16}/> Members</button><div className="profile"><span className="avatar">{userEmail?.slice(0,1).toUpperCase() ?? (signedIn ? "M" : "G")}</span><span style={{minWidth:0}}><b>{isAdmin ? "Administrator" : signedIn ? "Team member" : "Guest preview"}</b><small style={{display:"block",color:"#9aa198",marginTop:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:135}}>{userEmail ?? (signedIn ? "Member" : "Northstar Studio")}</small></span><button className="smalllink" style={{marginLeft:"auto"}} onClick={() => setModal("auth")}>{signedIn ? "Account" : "Sign in"}</button></div></div>
    </aside>
    <main className="main">
      <div className="topbar"><span className="crumb">Workspace <span style={{padding:"0 7px",color:"#c3c9c1"}}>/</span> {tab}</span><div className="topactions"><span className="muted">{new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", ...(hydrated ? {} : { timeZone: "UTC" }) }).format(new Date(renderNow))}</span><button className="iconbutton" aria-label="Notifications" onClick={() => setModal("notifications")}><Bell size={17}/>{notifications.length > 0 && <i className="dot"/>}</button><span className="avatar">{userEmail?.slice(0,1).toUpperCase() ?? (signedIn ? "M" : "G")}</span></div></div>
      <div className="intro"><div><span className="eyebrow">{new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", ...(hydrated ? {} : { timeZone: "UTC" }) }).format(new Date(renderNow))}</span><h1>Make room for good work.</h1><p className="subhead">Find a space, book your time, and get back to what matters.</p></div><button className="primary" onClick={() => openBooking()}><Plus size={16}/> New booking</button></div>
      {!configured && <div className="notice">You’re viewing a live preview. Add Supabase credentials to enable sign in, saved bookings, and live notifications. <button className="smalllink" onClick={() => setModal("auth")}>Set up access →</button></div>}
      {message && <div className="notice">{message}<button className="smalllink" onClick={() => setMessage("")} style={{float:"right"}}>Dismiss</button></div>}{error && <div className="notice error">{error}<button className="smalllink" onClick={() => setError("")} style={{float:"right"}}>Dismiss</button></div>}
      <div className="stats"><div className="stat"><span className="statlabel">Bookable resources</span><div className="statvalue">{resources.length}</div><div className="statnote">Available to your team</div></div><div className="stat"><span className="statlabel">Your upcoming bookings</span><div className="statvalue">{ownBookings.filter((b) => b.status === "approved" || b.status === "pending").length.toString().padStart(2,"0")}</div><div className="statnote">Confirmed and awaiting approval</div></div><div className="stat"><span className="statlabel">Awaiting approval</span><div className="statvalue">{(isAdmin ? bookings : ownBookings).filter((b) => b.status === "pending").length.toString().padStart(2,"0")}</div><div className="statnote">{isAdmin ? "Across the team" : "Your requests"}</div></div></div>
      <div className="sectionhead" id="resources"><h2>Find your space</h2>{isAdmin && <button className="smalllink" onClick={() => { setError(""); setModal("resource"); }}>Manage resources →</button>}</div>
      <div className="resourcegrid">{resources.map((r) => { const busy = bookings.some((b) => b.resource_id === r.id && b.status !== "rejected" && new Date(b.starts_at) < new Date(renderNow+7200000) && new Date(b.ends_at) > new Date(renderNow)); return <article className="resource" key={r.id}><div><div className="res-top"><span className="resicon">{r.kind === "equipment" ? <Laptop size={17}/> : <DoorOpen size={17}/>}</span><span className={`availability ${busy ? "busy" : ""}`}>{busy ? "In use soon" : "Available today"}</span></div><div className="resname">{r.name}</div><div className="resmeta">{r.kind === "equipment" ? "Equipment" : `Meeting room · ${r.capacity} seats`}{r.requires_approval ? " · approval required" : ""}</div></div><div className="resbottom"><span className="resmeta">{r.description}</span><button className="booklink" onClick={() => openBooking(r.id)}>Book <span aria-hidden>↗</span></button></div></article>; })}{resources.length === 0 && <div className="empty">No resources yet. An admin can add your first room or shared item.</div>}</div>
      <div className="sectionhead"><h2>Plan ahead</h2></div>
      <AvailabilityCalendar resources={resources} initialBookings={bookings} configured={configured} signedIn={signedIn} onBook={openBooking} initialDate={initialNow.slice(0,10)} initialNow={initialNow} />
      <div className="sectionhead" id="bookings"><h2>Your upcoming bookings</h2><button className="smalllink" onClick={() => setTab("Bookings")}>View calendar →</button></div>
      <div className="contentgrid"><section className="panel"><div className="sectionhead" style={{margin:"0 0 4px"}}><div><p className="paneltitle">Coming up</p><span className="muted">Your confirmed and pending reservations</span></div><button className="secondary"><CalendarDays size={14}/> This week</button></div>
        {ownBookings.filter((b) => b.status !== "rejected" && b.status !== "cancelled").sort((a,b)=>a.starts_at.localeCompare(b.starts_at)).slice(0,5).map((b) => { const d=dateParts(b.starts_at,hydrated); const name=bookingResourceName(b) || resources.find((r)=>r.id===b.resource_id)?.name;return <div className="bookingrow" key={b.id}><div className="datebox"><strong>{d.day}</strong><span>{d.month}</span></div><div><div className="bookingtitle">{b.note || name || "Resource booking"}</div><div className="bookingmeta">{name} · {time(b.starts_at,hydrated)} – {time(b.ends_at,hydrated)}</div></div><div style={{display:"grid",justifyItems:"end",gap:5}}><span className={`badge ${b.status === "pending" ? "pending" : ""}`}>{b.status}</span>{signedIn && b.status === "approved" && !b.id.startsWith("d") && <a className="smalllink" href={`/api/bookings/${b.id}/calendar`}>Download .ics</a>}</div></div>; })}
        {ownBookings.length===0 && <div className="empty" style={{marginTop:14}}>Nothing on your calendar yet. Book a room or shared resource to get started.</div>}
      </section><aside className="today"><span className="eyebrow">A little heads-up</span><h3>Today in your workspace</h3>{bookings.filter((b)=>sameCalendarDay(b.starts_at,renderNow,hydrated) && b.status !== "rejected").slice(0,3).map((b)=><div className="todayline" key={b.id}><span>{time(b.starts_at,hydrated)}</span>{bookingResourceName(b) || resources.find((r)=>r.id===b.resource_id)?.name || "Team booking"}</div>)}{bookings.filter((b)=>sameCalendarDay(b.starts_at,renderNow,hydrated)).length===0 && <p className="muted" style={{color:"#ced9ce",margin:"0 0 9px"}}>Your day is open. Make it count.</p>}<button className="secondary" onClick={()=>openBooking()}>Plan your day <span>→</span></button></aside></div>
    </main>
    {modal && <div className="overlay" onMouseDown={(e)=>{if(e.target===e.currentTarget)setModal(null)}}><div className="dialog"><div className="dialoghead"><h2>{modal==="booking"?"Book a resource":modal==="resource"?"Add a resource":modal==="auth"?"Your team account":modal==="admin"?"Approval queue":"Notifications"}</h2><button className="close" aria-label="Close" onClick={()=>setModal(null)}><X size={18}/></button></div>
      {error && <div className="notice error" role="alert">{error}</div>}
      {modal==="booking" && <form action={book}><label className="field">Resource<select name="resourceId" required defaultValue={selectedResource} disabled={resources.length===0}><option value="" disabled>{resources.length ? "Choose a room or item" : "No resources available yet"}</option>{resources.map((r)=><option key={r.id} value={r.id}>{r.name}{r.requires_approval?" · approval required":""}</option>)}</select></label>{resources.length===0 && <p className="muted">Ask an administrator to add a bookable resource first.</p>}<div className="formrow"><label className="field">Starts<input type="datetime-local" name="startsAt" min={minimumBookingTime} defaultValue={defaultBookingStart} required/></label><label className="field">Ends<input type="datetime-local" name="endsAt" min={minimumBookingTime} defaultValue={defaultBookingEnd} required/></label></div><label className="field">What’s it for?<input name="note" maxLength={500} placeholder="e.g. Product planning"/></label><label className="field">Repeat weekly<select name="weeks"><option value="1">Does not repeat</option>{Array.from({length:12},(_,i)=><option value={i+2} key={i}>{i+2} weeks (same weekday and time)</option>)}</select></label><p className="muted">Each week is stored as its own booking. The database checks every slot for conflicts.</p><div className="dialogactions"><button type="button" className="secondary" onClick={()=>setModal(null)}>Cancel</button><button disabled={loading || resources.length===0} className="primary"><Plus size={14}/>{loading?"Booking…":"Request booking"}</button></div></form>}
      {modal==="resource" && <form action={addResource}><label className="field">Name<input name="name" required minLength={2} maxLength={80} placeholder="e.g. Cedar meeting room"/></label><label className="field">Description<input name="description" maxLength={300} placeholder="A short description for your team"/></label><div className="formrow"><label className="field">Type<select name="kind"><option value="room">Meeting room</option><option value="equipment">Equipment</option></select></label><label className="field">Capacity<input name="capacity" type="number" min="1" max="500" defaultValue="6" required/></label></div><label className="checkrow"><input name="approval" type="checkbox"/> Require admin approval for bookings</label><div className="dialogactions"><button type="button" className="secondary" onClick={()=>setModal(null)}>Cancel</button><button className="primary" disabled={loading}>Create resource</button></div></form>}
      {modal==="auth" && (signedIn ? <div><p className="muted">Signed in as <b>{userEmail ?? "unknown account"}</b><br/>Role: <b>{role ?? "not assigned"}</b></p><div className="dialogactions"><button className="secondary" onClick={signOut}>Sign out</button><button className="primary" onClick={()=>setModal(null)}>Done</button></div></div> : <form action={auth}><p className="muted">Sign in or create an account using your team email.</p><label className="field">Email<input name="email" type="email" required placeholder="you@company.com"/></label><label className="field">Password<input name="password" type="password" minLength={8} required placeholder="At least 8 characters"/></label><label className="field">Account action<select name="mode"><option value="signin">Sign in</option><option value="signup">Create account</option></select></label><div className="dialogactions"><button disabled={loading} className="primary">{loading?"Working…":"Continue"}</button></div></form>)}
      {modal==="notifications" && <div>{notifications.length===0?<div className="empty">You’re all caught up. Booking updates will show here as they happen.</div>:notifications.map((n)=><div className="feeditem" key={n.id}>{n.message}<small>{new Date(n.created_at).toLocaleString()}</small></div>)}</div>}
      {modal==="admin" && <div>{bookings.filter((b)=>b.status==="pending").length===0?<div className="empty">No bookings need approval right now.</div>:bookings.filter((b)=>b.status==="pending").map((b)=><div className="feeditem" key={b.id}><b>{b.note || "Booking request"}</b><small>{bookingResourceName(b) || resources.find((r)=>r.id===b.resource_id)?.name} · {dateTime(b.starts_at,hydrated)} – {time(b.ends_at,hydrated)}</small><div className="dialogactions" style={{marginTop:10}}><button className="secondary" onClick={()=>decide(b.id,"rejected")}><X size={13}/> Reject</button><button className="primary" onClick={()=>decide(b.id,"approved")}><Check size={13}/> Approve</button></div></div>)}</div>}
    </div></div>}
  </div>;
}
