import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { ALL_DEAL_STATUSES, statusConfig } from '@/types/deal';

const COLORS: Record<string, string> = {
  new_submission: 'hsl(200, 80%, 50%)',
  document_review: 'hsl(38, 92%, 50%)',
  credit_review: 'hsl(28, 85%, 52%)',
  income_verification: 'hsl(45, 90%, 48%)',
  funding_review: 'hsl(215, 70%, 55%)',
  approved: 'hsl(160, 60%, 40%)',
  funded: 'hsl(175, 60%, 40%)',
  declined: 'hsl(0, 72%, 51%)',
  incomplete: 'hsl(215, 15%, 50%)',
};

/** Donut of deal counts per status (counts come from dashboard_metrics().by_status). */
export function DealsByStatusChart({ counts }: { counts: Record<string, number> }) {
  const known = ALL_DEAL_STATUSES as string[];
  const order = [...known, ...Object.keys(counts).filter((s) => !known.includes(s))];
  const data = order
    .filter((s) => (counts[s] ?? 0) > 0)
    .map((status) => ({ name: statusConfig(status).label, value: counts[status], status }));

  if (!data.length) {
    return <div className="h-[260px] sm:h-[300px] flex items-center justify-center text-sm text-muted-foreground">No deals yet</div>;
  }

  return (
    <div className="h-[300px]" role="img" aria-label={`Deals by status: ${data.map((d) => `${d.name} ${d.value}`).join(', ')}`}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={2} dataKey="value">
            {data.map((entry) => <Cell key={entry.status} fill={COLORS[entry.status] ?? 'hsl(215, 15%, 60%)'} />)}
          </Pie>
          <Tooltip
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                const d = payload[0].payload as { name: string; value: number };
                return (
                  <div className="bg-popover border rounded-lg shadow-lg p-3">
                    <p className="font-medium text-sm">{d.name}</p>
                    <p className="text-sm text-muted-foreground">{d.value} deal{d.value === 1 ? '' : 's'}</p>
                  </div>
                );
              }
              return null;
            }}
          />
          <Legend layout="horizontal" align="center" verticalAlign="bottom" iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '12px' }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
