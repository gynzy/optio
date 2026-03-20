import { StateBadge } from "./state-badge";
import { formatRelativeTime } from "@/lib/utils";

interface TimelineEvent {
  id: string;
  fromState?: string;
  toState: string;
  trigger: string;
  message?: string;
  createdAt: string;
}

export function EventTimeline({ events }: { events: TimelineEvent[] }) {
  return (
    <div className="space-y-3">
      {events.map((event) => (
        <div key={event.id} className="flex items-start gap-3">
          <div className="mt-1">
            <div className="w-2 h-2 rounded-full bg-border" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              {event.fromState && (
                <>
                  <StateBadge state={event.fromState} />
                  <span className="text-text-muted text-xs">→</span>
                </>
              )}
              <StateBadge state={event.toState} />
            </div>
            <div className="text-xs text-text-muted mt-1">
              {event.trigger}
              {event.message && <span className="opacity-70"> — {event.message}</span>}
            </div>
            <div className="text-xs text-text-muted/50 mt-0.5">
              {formatRelativeTime(event.createdAt)}
            </div>
          </div>
        </div>
      ))}
      {events.length === 0 && (
        <div className="text-center text-text-muted text-sm py-4">No events yet</div>
      )}
    </div>
  );
}
