"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/browser";
import type { Booking, Resource } from "@/lib/types";

type Props = {
  resources: Resource[];
  initialBookings: Booking[];
  configured: boolean;
  signedIn: boolean;
  onBook: (resourceId: string, startsAt: string, endsAt: string) => void;
  initialDate: string;
  initialNow: string;
};

const dateKey = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};
const parseDate = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
};
const addDays = (date: Date, amount: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
const toLocalInput = (date: Date) => {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};
const subscribeHydration = () => () => {};
const getClientHydration = () => true;
const getServerHydration = () => false;
const rangeLabel = (date: Date, view: "day" | "week") => {
  const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
  if (view === "day") return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(date);
  const start = addDays(date, -((date.getDay() + 6) % 7));
  const end = addDays(start, 6);
  return `${fmt.format(start)} – ${fmt.format(end)}, ${end.getFullYear()}`;
};

export function AvailabilityCalendar({ resources, initialBookings, configured, signedIn, onBook, initialDate, initialNow }: Props) {
  const [resourceId, setResourceId] = useState(resources[0]?.id ?? "");
  const [date, setDate] = useState(initialDate);
  const [view, setView] = useState<"day" | "week">("week");
  const hydrated = useSyncExternalStore(subscribeHydration, getClientHydration, getServerHydration);
  const [renderTimestamp, setRenderTimestamp] = useState(initialNow);
  const [bookings, setBookings] = useState(initialBookings);
  const [loadedKey, setLoadedKey] = useState("");
  const [errorState, setErrorState] = useState<{ key: string; message: string } | null>(null);
  const supabase = useMemo(() => configured ? createClient() : null, [configured]);
  const activeResourceId = resources.some((resource) => resource.id === resourceId) ? resourceId : resources[0]?.id ?? "";
  const queryKey = `${activeResourceId}|${date}|${view}`;
  const loading = hydrated && Boolean(supabase && signedIn && activeResourceId) && loadedKey !== queryKey;
  const loadError = errorState?.key === queryKey ? errorState.message : "";

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const now = new Date();
      setDate(dateKey(now));
      setRenderTimestamp(now.toISOString());
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let active = true;
    if (!hydrated || !supabase || !signedIn || !activeResourceId) return () => { active = false; };
    const anchor = parseDate(date);
    const start = view === "day" ? anchor : addDays(anchor, -((anchor.getDay() + 6) % 7));
    const end = addDays(start, view === "day" ? 1 : 7);
    void supabase.from("bookings")
      .select("id,resource_id,user_id,starts_at,ends_at,status,note,resources(name)")
      .eq("resource_id", activeResourceId)
      .lt("starts_at", end.toISOString())
      .gt("ends_at", start.toISOString())
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setErrorState({ key: queryKey, message: "Could not load this resource’s availability. Try again in a moment." });
        else {
          setBookings((data ?? []) as Booking[]);
          setErrorState(null);
        }
        setLoadedKey(queryKey);
      });
    return () => { active = false; };
  }, [hydrated, supabase, signedIn, activeResourceId, date, view, queryKey]);

  const anchor = parseDate(date);
  const weekStart = addDays(anchor, -((anchor.getDay() + 6) % 7));
  const days = view === "day" ? [anchor] : Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const hours = Array.from({ length: 10 }, (_, index) => index + 8);
  const resource = resources.find((item) => item.id === activeResourceId);
  const renderNow = Date.parse(renderTimestamp);
  const moveRange = (direction: number) => {
    const current = parseDate(date);
    setDate(dateKey(addDays(current, direction * (view === "day" ? 1 : 7))));
  };
  const slotsFor = (day: Date) => hours.map((hour) => {
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour);
    const end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour + 1);
    const booking = bookings.find((item) =>
      item.resource_id === activeResourceId &&
      (item.status === "approved" || item.status === "pending") &&
      new Date(item.starts_at) < end && new Date(item.ends_at) > start
    );
    return { start, end, booking };
  });

  return <section className="panel availability-panel" id="availability">
    <div className="availability-heading">
      <div><h2 className="paneltitle">Resource availability</h2><span className="muted">See open and reserved times by day or week.</span></div>
      <div className="availability-controls">
        <select aria-label="Choose resource" value={activeResourceId} onChange={(event) => setResourceId(event.target.value)} disabled={!resources.length}>
          {!resources.length && <option value="">No resources yet</option>}
          {resources.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <div className="viewtoggle" role="group" aria-label="Calendar view">
          <button className={view === "day" ? "selected" : ""} onClick={() => setView("day")}>Day</button>
          <button className={view === "week" ? "selected" : ""} onClick={() => setView("week")}>Week</button>
        </div>
      </div>
    </div>
    <div className="availability-datebar">
      <div className="range-nav"><button className="iconbutton" aria-label="Previous period" onClick={() => moveRange(-1)}><ChevronLeft size={16}/></button><button className="iconbutton" aria-label="Next period" onClick={() => moveRange(1)}><ChevronRight size={16}/></button><strong>{rangeLabel(anchor, view)}</strong></div>
      <label className="date-picker"><CalendarDays size={14}/><input aria-label="Choose date" type="date" value={date} onChange={(event) => setDate(event.target.value)}/></label>
    </div>
    {!resource ? <div className="empty">An administrator needs to add a resource before its availability can be shown.</div> :
      <div className={view === "week" ? "availability-scroll" : ""}>
        {loadError && <div className="notice error" role="alert">{loadError}</div>}
        {loading && <div className="availability-loading">Loading availability…</div>}
        <div className={view === "week" ? "availability-days week" : "availability-days day"}>
          {days.map((day) => <div className="availability-day" key={dateKey(day)}>
              <div className="availability-day-title"><b>{new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(day)}</b><span>{new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(day)}</span></div>
            <div className="availability-slots">{slotsFor(day).map(({ start, end, booking }) => {
              const pending = booking?.status === "pending";
              return <div className={`availability-slot ${booking ? pending ? "pending" : "booked" : "free"}`} key={start.toISOString()}>
                <time>{new Intl.DateTimeFormat("en-US", { hour: "numeric" }).format(start)}</time>
                {booking ? <span title={booking.note ?? undefined}>{pending ? "Pending" : "Booked"}{booking.note ? ` · ${booking.note}` : ""}</span> :
                    hydrated && start.getTime() < renderNow ? <span className="slot-past">Past</span> :
                    <button onClick={() => onBook(activeResourceId, toLocalInput(start), toLocalInput(end))}>Book this hour</button>}
              </div>;
            })}</div>
          </div>)}
        </div>
      </div>
    }
    <div className="availability-legend"><span><i className="legend-free"/>Free</span><span><i className="legend-booked"/>Booked</span><span><i className="legend-pending"/>Pending approval</span><small>Showing 8:00 AM–6:00 PM in your local time.</small></div>
  </section>;
}

