export type Resource = {
  id: string;
  name: string;
  description: string;
  capacity: number;
  requires_approval: boolean;
  kind: "room" | "equipment";
};

export type BookingStatus = "pending" | "approved" | "rejected" | "cancelled";

export type Booking = {
  id: string;
  resource_id: string;
  user_id: string;
  starts_at: string;
  ends_at: string;
  status: BookingStatus;
  note: string | null;
  resources?: Pick<Resource, "name"> | Pick<Resource, "name">[] | null;
};

export type Notification = {
  id: string;
  user_id: string;
  booking_id: string | null;
  kind: "confirmed" | "rejected" | "conflict" | "pending";
  message: string;
  read_at: string | null;
  created_at: string;
};
