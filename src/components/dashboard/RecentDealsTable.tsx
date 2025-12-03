import { mockDeals } from '@/data/mockData';
import { StatusBadge } from '@/components/deals/StatusBadge';
import { formatDistanceToNow } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';

export function RecentDealsTable() {
  const navigate = useNavigate();
  const recentDeals = [...mockDeals]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 8);

  return (
    <div className="overflow-hidden rounded-lg border">
      <table className="data-table">
        <thead>
          <tr>
            <th>Deal #</th>
            <th>Customer</th>
            <th>Vehicle</th>
            <th>Amount</th>
            <th>Status</th>
            <th>Submitted</th>
          </tr>
        </thead>
        <tbody>
          {recentDeals.map((deal) => (
            <tr
              key={deal.id}
              onClick={() => navigate(`/deals/${deal.id}`)}
              className="cursor-pointer"
            >
              <td className="font-mono text-sm">{deal.dealNumber}</td>
              <td>
                <div>
                  <p className="font-medium">
                    {deal.customer.firstName} {deal.customer.lastName}
                  </p>
                  <p className="text-xs text-muted-foreground">{deal.dealerName}</p>
                </div>
              </td>
              <td>
                <span className="text-sm">
                  {deal.vehicle.year} {deal.vehicle.make} {deal.vehicle.model}
                </span>
              </td>
              <td>
                <span className="font-medium">
                  ${deal.financingTerms.loanAmount.toLocaleString()}
                </span>
              </td>
              <td>
                <StatusBadge status={deal.status} size="sm" />
              </td>
              <td className="text-sm text-muted-foreground">
                {formatDistanceToNow(new Date(deal.createdAt), { addSuffix: true })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
