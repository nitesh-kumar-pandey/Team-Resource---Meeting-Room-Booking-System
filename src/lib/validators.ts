import { z } from "zod";

export const bookingInputSchema = z.object({
  resourceId: z.string().uuid(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  note: z.string().trim().max(500).optional(),
  recurrence: z.object({ weeks: z.number().int().min(1).max(12) }).optional(),
}).refine((v) => new Date(v.endsAt) > new Date(v.startsAt), {
  message: "End time must be after start time", path: ["endsAt"],
}).refine((v) => new Date(v.endsAt).getTime() - new Date(v.startsAt).getTime() <= 24 * 60 * 60 * 1000, {
  message: "A booking can’t be longer than 24 hours", path: ["endsAt"],
});

export const resourceInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).default(""),
  capacity: z.number().int().min(1).max(500),
  requiresApproval: z.boolean(),
  kind: z.enum(["room", "equipment"]),
});

export type BookingInput = z.infer<typeof bookingInputSchema>;
