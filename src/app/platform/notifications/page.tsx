import { requirePlatformAdmin } from "@/lib/auth";
import { listNotifications } from "@/lib/platform-queries";
import { card, btnGhost } from "@/components/ui";
import { dateTime } from "@/lib/format";
import { ActionForm } from "@/components/ActionForm";
import { markAllNotificationsRead, markNotificationRead } from "./actions";

export const dynamic = "force-dynamic";

const KIND_STYLE: Record<string, string> = {
  support_request: "bg-blue-50 text-blue-700",
  security_event: "bg-red-50 text-red-700",
};

export default async function NotificationsPage() {
  const session = await requirePlatformAdmin();
  const notifications = await listNotifications(session);
  const unread = notifications.filter((n) => !n.is_read);

  return (
    <div className="space-y-4">
      {unread.length > 0 && (
        <div className="flex justify-end">
          <ActionForm action={markAllNotificationsRead}>
            <button className={btnGhost}>Mark all read</button>
          </ActionForm>
        </div>
      )}

      <div className="space-y-2">
        {notifications.map((n) => (
          <div key={n.id} className={`${card} flex items-start justify-between gap-4 p-4 ${n.is_read ? "opacity-60" : ""}`}>
            <div>
              <div className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${KIND_STYLE[n.kind]}`}>
                  {n.kind === "support_request" ? "Support" : "Security"}
                </span>
                {n.shop_name && <span className="text-xs text-steel">{n.shop_name}</span>}
                <span className="text-xs text-steel">{dateTime(n.created_at)}</span>
              </div>
              <div className="mt-1 font-medium">{n.title}</div>
              <p className="mt-0.5 text-sm text-steel">{n.body}</p>
            </div>
            {!n.is_read && (
              <ActionForm action={markNotificationRead} className="shrink-0">
                <input type="hidden" name="id" value={n.id} />
                <button className={btnGhost}>Mark read</button>
              </ActionForm>
            )}
          </div>
        ))}
        {notifications.length === 0 && (
          <p className={`${card} px-5 py-4 text-sm text-steel`}>No notifications yet.</p>
        )}
      </div>
    </div>
  );
}
