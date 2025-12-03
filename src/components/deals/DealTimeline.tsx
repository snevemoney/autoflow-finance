import { TimelineEvent } from '@/types/deal';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import {
  ArrowRight,
  FileText,
  MessageSquare,
  UserPlus,
  Mail,
} from 'lucide-react';

interface DealTimelineProps {
  events: TimelineEvent[];
}

export function DealTimeline({ events }: DealTimelineProps) {
  const getEventIcon = (type: TimelineEvent['type']) => {
    switch (type) {
      case 'status_change':
        return <ArrowRight className="h-3 w-3" />;
      case 'document_upload':
        return <FileText className="h-3 w-3" />;
      case 'note_added':
        return <MessageSquare className="h-3 w-3" />;
      case 'assignment':
        return <UserPlus className="h-3 w-3" />;
      case 'email_sent':
        return <Mail className="h-3 w-3" />;
      default:
        return <ArrowRight className="h-3 w-3" />;
    }
  };

  const getEventColor = (type: TimelineEvent['type']) => {
    switch (type) {
      case 'status_change':
        return 'bg-info';
      case 'document_upload':
        return 'bg-success';
      case 'note_added':
        return 'bg-warning';
      case 'assignment':
        return 'bg-accent';
      case 'email_sent':
        return 'bg-primary';
      default:
        return 'bg-muted-foreground';
    }
  };

  const sortedEvents = [...events].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return (
    <div className="space-y-0">
      {sortedEvents.map((event, index) => (
        <div key={event.id} className="timeline-item">
          <div
            className={cn(
              'timeline-dot flex items-center justify-center text-primary-foreground',
              getEventColor(event.type)
            )}
          >
            {getEventIcon(event.type)}
          </div>
          <div className="pb-1">
            <p className="text-sm font-medium">{event.description}</p>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-muted-foreground">
                {format(new Date(event.createdAt), 'MMM d, yyyy h:mm a')}
              </span>
              <span className="text-xs text-muted-foreground">•</span>
              <span className="text-xs text-muted-foreground">
                {event.createdBy}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
