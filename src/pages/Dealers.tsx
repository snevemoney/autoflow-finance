import { AppHeader } from '@/components/layout/AppHeader';
import { mockDealers } from '@/data/mockData';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Search, Plus, MoreHorizontal, Building2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useState } from 'react';
import { cn } from '@/lib/utils';

export default function Dealers() {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredDealers = mockDealers.filter(
    (dealer) =>
      dealer.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      dealer.code.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full">
      <AppHeader
        title="Dealers"
        subtitle={`${mockDealers.length} registered dealers`}
      />

      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Actions Bar */}
        <div className="p-6 pb-4 border-b bg-card flex items-center justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search dealers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            Add Dealer
          </Button>
        </div>

        {/* Dealers Grid */}
        <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredDealers.map((dealer) => (
              <div
                key={dealer.id}
                className="bg-card rounded-xl border p-6 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                      <Building2 className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <h3 className="font-semibold">{dealer.name}</h3>
                      <p className="text-xs text-muted-foreground font-mono">
                        {dealer.code}
                      </p>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem>View Details</DropdownMenuItem>
                      <DropdownMenuItem>Edit Dealer</DropdownMenuItem>
                      <DropdownMenuItem>View Deals</DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive">
                        Suspend Dealer
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="space-y-3 mb-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Contact</span>
                    <span>{dealer.contactName}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Email</span>
                    <span className="truncate ml-2">{dealer.email}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Phone</span>
                    <span>{dealer.phone}</span>
                  </div>
                </div>

                <div className="pt-4 border-t grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-lg font-bold">{dealer.activeDeals}</p>
                    <p className="text-xs text-muted-foreground">Active</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold">{dealer.totalDeals}</p>
                    <p className="text-xs text-muted-foreground">Total</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-success">
                      {dealer.approvalRate}%
                    </p>
                    <p className="text-xs text-muted-foreground">Approval</p>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between">
                  <Badge
                    className={cn(
                      dealer.status === 'active' && 'bg-success/10 text-success',
                      dealer.status === 'suspended' &&
                        'bg-destructive/10 text-destructive',
                      dealer.status === 'pending' && 'bg-warning/10 text-warning'
                    )}
                    variant="secondary"
                  >
                    {dealer.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {dealer.address.city}, {dealer.address.state}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
