import "server-only";
import { inShop } from "./auth";
import type { Session } from "./session";
import type { Role } from "./permissions";

export type Coworker = { id: string; full_name: string; role: Role };

/** Everyone else active at this shop — the picker for starting a new DM. */
export function listCoworkers(session: Session) {
  return inShop(session, (tx) => tx<Coworker[]>`
    SELECT id, full_name, role
    FROM grip.users
    WHERE is_active AND id != ${session.userId}
    ORDER BY full_name`);
}

export type ThreadRow = {
  id: string;
  other_id: string;
  other_name: string;
  other_role: Role;
  last_message_at: Date;
  last_message_body: string | null;
  last_message_sender_id: string | null;
  unread: boolean;
};

/**
 * One row per conversation this user is in, newest first. `unread` compares
 * the latest message against *this* side's own last-read mark — whichever
 * side of user_a/user_b the signed-in user happens to be.
 */
export function listThreads(session: Session) {
  return inShop(session, (tx) => tx<ThreadRow[]>`
    SELECT
      t.id,
      other.id AS other_id,
      other.full_name AS other_name,
      other.role AS other_role,
      t.last_message_at,
      m.body AS last_message_body,
      m.sender_id AS last_message_sender_id,
      (m.created_at > coalesce(
        CASE WHEN t.user_a_id = ${session.userId} THEN t.user_a_last_read_at
             ELSE t.user_b_last_read_at END,
        '-infinity'::timestamptz)
       AND m.sender_id != ${session.userId}) AS unread
    FROM grip.message_threads t
    JOIN grip.users other ON other.id = (
      CASE WHEN t.user_a_id = ${session.userId} THEN t.user_b_id ELSE t.user_a_id END)
    LEFT JOIN LATERAL (
      SELECT body, sender_id, created_at FROM grip.messages
      WHERE thread_id = t.id ORDER BY created_at DESC LIMIT 1
    ) m ON true
    WHERE ${session.userId} IN (t.user_a_id, t.user_b_id)
    ORDER BY t.last_message_at DESC`);
}

/** Total unread DMs, for the nav badge. Mirrors unreadNotificationCount's shape. */
export async function unreadMessageCount(session: Session): Promise<number> {
  const [row] = await inShop(session, (tx) => tx<{ count: string }[]>`
    SELECT count(*) FROM grip.messages m
    JOIN grip.message_threads t ON t.id = m.thread_id
    WHERE ${session.userId} IN (t.user_a_id, t.user_b_id)
      AND m.sender_id != ${session.userId}
      AND m.created_at > coalesce(
        CASE WHEN t.user_a_id = ${session.userId} THEN t.user_a_last_read_at
             ELSE t.user_b_last_read_at END,
        '-infinity'::timestamptz)`);
  return Number(row.count);
}

export type MessageRow = { id: string; sender_id: string; body: string; created_at: Date };
export type ThreadDetail = { other_id: string; other_name: string; other_role: Role } | null;

/** The other participant's name/role, or null if this thread isn't visible to the caller (RLS). */
export function threadParticipant(session: Session, threadId: string) {
  return inShop(session, async (tx) => {
    const [row] = await tx<{ other_id: string; other_name: string; other_role: Role }[]>`
      SELECT other.id AS other_id, other.full_name AS other_name, other.role AS other_role
      FROM grip.message_threads t
      JOIN grip.users other ON other.id = (
        CASE WHEN t.user_a_id = ${session.userId} THEN t.user_b_id ELSE t.user_a_id END)
      WHERE t.id = ${threadId}`;
    return row ?? null;
  });
}

export function threadMessages(session: Session, threadId: string) {
  return inShop(session, (tx) => tx<MessageRow[]>`
    SELECT id, sender_id, body, created_at
    FROM grip.messages
    WHERE thread_id = ${threadId}
    ORDER BY created_at ASC
    LIMIT 500`);
}
