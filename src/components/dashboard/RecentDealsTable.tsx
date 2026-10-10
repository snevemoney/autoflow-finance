import { Link, useNavigate } from 'react-router-dom';
import { ago } from '@/lib/utils';
import { StatusBadge } from '@/components/deals/StatusBadge';
import type { Deal } from '@/types/deal';

/** The latest deals (the caller fetches one small page — this component never sorts or slices a full list). */
export function RecentDealsTable({ deals }: { deals: Deal[] }) {
  const navigate = useNavigate();

  if (!deals.length) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No deals yet. Dealers submit from their portal, or use “New deal”.</p>;
  }

  return (
    <>
      <ul className="md:hidden divide-y rounded-lg border">
        {deals.map((deal) => (
          <li key={deal.id}>
            <Link to={`/deals/${deal.id}`} className="flex items-center justify-between gap-3 p-3 hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="min-w-0">
                <span className="block font-medium truncate">{deal.customer.firstName} {deal.customer.lastName}</span>
                <span className="block text-xs text-muted-foreground truncate">{deal.dealNumber} · ${deal.financingTerms.loanAmount.toLocaleString('en-CA')}</span>
              </span>
              <StatusBadge status={deal.status} size="sm" />
            </Link>
          </li>
        ))}
      </ul>
      <div className="hidden md:block overflow-x-auto rounded-lg border">
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
            {deals.map((deal) => (
              <tr key={deal.id} onClick={() => navigate(`/deals/${deal.id}`)} className="cursor-pointer">
                <td className="font-mono text-sm">
                  <Link to={`/deals/${deal.id}`} onClick={(e) => e.stopPropagation()} className="hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">{deal.dealNumber}</Link>
                </td>
                <td>
                  <p className="font-medium">{deal.customer.firstName} {deal.customer.lastName}</p>
                  <p className="text-xs text-muted-foreground">{deal.dealerName}</p>
                </td>
                <td><span className="text-sm">{deal.vehicle.year || ''} {deal.vehicle.make} {deal.vehicle.model}</span></td>
                <td><span className="font-medium">${deal.financingTerms.loanAmount.toLocaleString('en-CA')}</span></td>
                <td><StatusBadge status={deal.status} size="sm" /></td>
                <td className="text-sm text-muted-foreground whitespace-nowrap">{ago(deal.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
