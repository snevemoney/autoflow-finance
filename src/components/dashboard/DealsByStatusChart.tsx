import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { DealStatus, DEAL_STATUS_CONFIG, type Deal } from '@/types/deal';

const COLORS: Record<DealStatus, string> = {
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

export function DealsByStatusChart({ deals }: { deals: Deal[] }) {
  const counts = deals.reduce((acc, deal) => {
    acc[deal.status] = (acc[deal.status] || 0) + 1;
    return acc;
  }, {} as Record<DealStatus, number>);

  const data = (Object.keys(DEAL_STATUS_CONFIG) as DealStatus[])
    .filter((s) => counts[s])
    .map((status) => ({ name: DEAL_STATUS_CONFIG[status].label, value: counts[status], status }));

  if (!data.length) {
    return <div className="h-[300px] flex items-center justify-center text-sm text-muted-foreground">No deals yet</div>;
  }

  return (
    <div className="h-[300px]">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2} dataKey="value">
            {data.map((entry) => <Cell key={entry.status} fill={COLORS[entry.status]} />)}
          </Pie>
          <Tooltip
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                const d = payload[0].payload;
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
          <Legend layout="vertical" align="right" verticalAlign="middle" iconType="circle" iconSize={8} wrapperStyle={{ fontSize: '12px' }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
