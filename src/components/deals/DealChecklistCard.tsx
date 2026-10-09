import { CheckCircle2, AlertTriangle, Send, Loader2, FileCheck2, Sparkles, X, Inbox } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useChecklist, useDealRequests, useRequestDocument, useRequestMissing, useCancelRequest } from '@/hooks/use-autoflow';
import { toast } from '@/hooks/use-toast';
import { ago, cn } from '@/lib/utils';

/** What the deal still needs, what has been asked of the dealer, and one-click requests. */
export function DealChecklistCard({ dealId, staff = true, documentsReading = false }: { dealId: string; staff?: boolean; documentsReading?: boolean }) {
  const { data: items = [], isLoading } = useChecklist(dealId);
  const { data: requests = [] } = useDealRequests(dealId);
  const requestOne = useRequestDocument(dealId);
  const requestAll = useRequestMissing(dealId);
  const cancel = useCancelRequest(dealId);

  const missing = items.filter((i) => !i.satisfied);
  const missingUnrequested = missing.filter((i) => !i.open_request_id);
  const openRequests = requests.filter((r) => r.status === 'open');
  const complete = items.length > 0 && missing.length === 0;

  const onRequest = async (docType: typeof items[number]['doc_types'][number], label: string) => {
    try {
      await requestOne.mutateAsync({ docType, message: 'Missing from submission' });
      toast({ title: 'Requested from dealer', description: label });
    } catch (e) {
      toast({ title: 'Request failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    }
  };

  const onRequestAll = async () => {
    try {
      const n = await requestAll.mutateAsync();
      toast({ title: n ? `Requested ${n} document${n === 1 ? '' : 's'} from the dealer` : 'Nothing new to request' });
    } catch (e) {
      toast({ title: 'Request failed', description: e instanceof Error ? e.message : String(e), variant: 'destructive' });
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileCheck2 className="h-5 w-5" />
            Deal checklist
          </CardTitle>
          {isLoading ? null : documentsReading ? (
            <Badge variant="outline" className="gap-1 text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Checking…</Badge>
          ) : complete ? (
            <Badge className="gap-1 bg-success/10 text-success hover:bg-success/10"><CheckCircle2 className="h-3 w-3" /> Complete</Badge>
          ) : (
            <Badge className="gap-1 bg-warning/10 text-warning hover:bg-warning/10"><AlertTriangle className="h-3 w-3" /> {missing.length} missing</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="divide-y rounded-lg border">
          {items.map((item) => {
            const req = requests.find((r) => r.id === item.open_request_id);
            return (
              <div key={item.item_key} className={cn('flex items-center gap-3 px-3 py-2.5 text-sm', !item.satisfied && 'bg-warning/5')}>
                {item.satisfied
                  ? <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                  : <AlertTriangle className="h-4 w-4 text-warning shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{item.label}</p>
                  {!item.satisfied && (
                    <p className="text-xs text-muted-foreground">
                      {req ? `Requested ${ago(req.created_at, { addSuffix: true })}${req.source === 'automation' ? ' by AutoFlow' : ''}`
                        : 'Missing from submission'}
                    </p>
                  )}
                </div>
                {!item.satisfied && staff && (req ? (
                  <Badge variant="outline" className="text-xs gap-1"><Send className="h-3 w-3" /> Requested</Badge>
                ) : (
                  <Button size="sm" variant="outline" className="h-7 text-xs" disabled={requestOne.isPending}
                    onClick={() => onRequest(item.doc_types[0], item.label)}>
                    <Send className="h-3 w-3 mr-1" /> Request
                  </Button>
                ))}
              </div>
            );
          })}
          {!items.length && !isLoading && <p className="px-3 py-4 text-sm text-muted-foreground">No requirements configured.</p>}
        </div>

        {staff && missingUnrequested.length > 1 && (
          <Button size="sm" className="w-full" onClick={onRequestAll} disabled={requestAll.isPending}>
            {requestAll.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
            Request all missing from dealer
          </Button>
        )}

        {staff && openRequests.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1"><Inbox className="h-3 w-3" /> Waiting on dealer</p>
            {openRequests.map((r) => (
              <div key={r.id} className="flex items-center gap-2 text-xs rounded-md border px-2.5 py-1.5">
                {r.source === 'automation' ? <Sparkles className="h-3 w-3 text-accent shrink-0" /> : <Send className="h-3 w-3 text-muted-foreground shrink-0" />}
                <span className="flex-1 truncate">{r.label}{r.message && r.message !== 'Missing from submission' ? ` — ${r.message}` : ''}</span>
                <span className="text-muted-foreground">{ago(r.created_at, { addSuffix: true })}</span>
                {staff && (
                  <Button variant="ghost" size="icon" className="h-6 w-6" aria-label="Cancel request" onClick={() => cancel.mutate(r.id)}>
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
