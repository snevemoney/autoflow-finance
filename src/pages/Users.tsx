import { AppHeader } from '@/components/layout/AppHeader';
import { mockUsers } from '@/data/mockData';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Search, Plus, MoreHorizontal, User } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

const ROLE_CONFIG = {
  admin: { label: 'Admin', color: 'bg-primary/10 text-primary' },
  credit_analyst: { label: 'Credit Analyst', color: 'bg-info/10 text-info' },
  income_verifier: { label: 'Income Verifier', color: 'bg-warning/10 text-warning' },
  funding_manager: { label: 'Funding Manager', color: 'bg-success/10 text-success' },
  dealer: { label: 'Dealer', color: 'bg-muted text-muted-foreground' },
};

export default function Users() {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredUsers = mockUsers.filter(
    (user) =>
      user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full">
      <AppHeader
        title="Users"
        subtitle={`${mockUsers.length} registered users`}
      />

      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Actions Bar */}
        <div className="p-6 pb-4 border-b bg-card flex items-center justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search users..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            Add User
          </Button>
        </div>

        {/* Users Table */}
        <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
          <div className="rounded-lg border overflow-hidden">
            <table className="data-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Department</th>
                  <th>Status</th>
                  <th>Last Login</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
                          <User className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <p className="font-medium">{user.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {user.email}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td>
                      <Badge
                        variant="secondary"
                        className={cn(ROLE_CONFIG[user.role].color)}
                      >
                        {ROLE_CONFIG[user.role].label}
                      </Badge>
                    </td>
                    <td className="capitalize">{user.department || '-'}</td>
                    <td>
                      <Badge
                        variant="secondary"
                        className={cn(
                          user.isActive
                            ? 'bg-success/10 text-success'
                            : 'bg-muted text-muted-foreground'
                        )}
                      >
                        {user.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="text-sm text-muted-foreground">
                      {user.lastLogin
                        ? format(new Date(user.lastLogin), 'MMM d, yyyy h:mm a')
                        : 'Never'}
                    </td>
                    <td>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem>Edit User</DropdownMenuItem>
                          <DropdownMenuItem>Reset Password</DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive">
                            Deactivate
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
