import { z } from "zod";
import { ObjectId } from "mongodb";

export const TicketStatus = z.enum(["active", "in_progress", "closed"]);
export const TicketPriority = z.enum(["low", "medium", "high"]);
export const MessageType = z.enum(["text", "image", "file", "system"]);

export const SupportTicketSchema = z.object({
  userId: z.string().or(z.instanceof(ObjectId)),
  subject: z.string().min(3),
  description: z.string().min(10),
  category: z.string(),
  status: TicketStatus.default("active"),
  priority: TicketPriority.default("medium"),
  mediaUrl: z.string().optional(),
  lastMessageAt: z.date().default(() => new Date()),
  createdAt: z.date().default(() => new Date()),
  updatedAt: z.date().default(() => new Date()),
});

export const MessageStatus = z.enum(["sent", "delivered", "read"]);

export const SupportMessageSchema = z.object({
  ticketId: z.string().or(z.instanceof(ObjectId)),
  senderId: z.string().or(z.instanceof(ObjectId)),
  senderType: z.enum(["user", "admin"]),
  content: z.string(),
  type: MessageType.default("text"),
  mediaUrl: z.string().optional(),
  status: MessageStatus.default("sent"),
  createdAt: z.date().default(() => new Date()),
});

export type SupportTicket = z.infer<typeof SupportTicketSchema> & { _id?: ObjectId };
export type SupportMessage = z.infer<typeof SupportMessageSchema> & { _id?: ObjectId };
