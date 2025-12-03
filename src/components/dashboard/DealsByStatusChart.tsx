import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import { mockDeals } from '@/data/mockData';
import { DealStatus, DEAL_STATUS_CONFIG } from '@/types/deal';

export function DealsByStatusChart() {
  const statusCounts = mockDeals.reduce((acc, deal) => {
    acc[deal.status] = (acc[deal.status] || 0) + 1;
    return acc;
  }, {} as Record<DealStatus, number>);

  const data = Object.entries(statusCounts).map(([status, count]) => ({
    name: DEAL_STATUS_CONFIG[status as DealStatus].label,
    value: count,
    status: status as DealStatus,
  }));

  const COLORS: Record<DealStatus, string> = {
    new_submission: 'hsl(200, 80%, 50%)',
    document_review: 'hsl(38, 92%, 50%)',
    credit_review: 'hsl(38, 92%, 50%)',
    income_verification: 'hsl(38, 92%, 50%)',
    funding_review: 'hsl(200, 80%, 50%)',
    approved: 'hsl(160, 60%, 40%)',
    funded: 'hsl(175, 60%, 40%)',
    declined: 'hsl(0, 72%, 51%)',
    incomplete: 'hsl(215, 15%, 50%)',
  };

  return (
    <div className="h-[300px]">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={100}
            paddingAngle={2}
            dataKey="value"
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[entry.status]} />
            ))}
          </Pie>
          <Tooltip
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                const data = payload[0].payload;
                return (
                  <div className="bg-popover border rounded-lg shadow-lg p-3">
                    <p className="font-medium text-sm">{data.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {data.value} deals
                    </p>
                  </div>
                );
              }
              return null;
            }}
          />
          <Legend
            layout="vertical"
            align="right"
            verticalAlign="middle"
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: '12px' }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
