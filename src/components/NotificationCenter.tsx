import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Bell, Check, Trash2, ArrowRightLeft, AlertTriangle, CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  details: Record<string, any>;
  read: boolean;
  created_at: string;
}

export default function NotificationCenter() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);

  const unreadCount = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    loadNotifications();

    // Realtime subscription
    const channel = supabase
      .channel("notifications-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications" },
        (payload) => {
          const newNotif = payload.new as Notification;
          setNotifications((prev) => [newNotif, ...prev]);
          toast.info(newNotif.title, { description: newNotif.message });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function loadNotifications() {
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (data) setNotifications(data as Notification[]);
  }

  async function markAllRead() {
    const unreadIds = notifications.filter((n) => !n.read).map((n) => n.id);
    if (unreadIds.length === 0) return;
    await supabase.from("notifications").update({ read: true }).in("id", unreadIds);
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }

  async function clearAll() {
    await supabase.from("notifications").delete().neq("id", "");
    setNotifications([]);
  }

  const getIcon = (type: string) => {
    switch (type) {
      case "swap_success": return <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />;
      case "swap_error": return <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />;
      case "signal": return <ArrowRightLeft className="h-4 w-4 text-neon-cyan shrink-0" />;
      default: return <Bell className="h-4 w-4 text-muted-foreground shrink-0" />;
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-8 w-8">
          <Bell className="h-4 w-4 text-muted-foreground" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-primary text-[9px] font-bold text-primary-foreground flex items-center justify-center">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <span className="text-sm font-semibold">Powiadomienia</span>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={markAllRead} title="Oznacz jako przeczytane">
              <Check className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={clearAll} title="Wyczyść wszystkie">
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
        <ScrollArea className="max-h-[360px]">
          {notifications.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              Brak powiadomień
            </div>
          ) : (
            notifications.map((n) => (
              <div
                key={n.id}
                className={`flex gap-2.5 px-3 py-2.5 border-b border-border/50 last:border-0 ${
                  !n.read ? "bg-primary/5" : ""
                }`}
              >
                <div className="mt-0.5">{getIcon(n.type)}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground">{n.title}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                  <p className="text-[10px] text-muted-foreground/60 mt-1">
                    {new Date(n.created_at).toLocaleString("pl-PL", {
                      day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
                    })}
                  </p>
                </div>
                {!n.read && <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 shrink-0" />}
              </div>
            ))
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
