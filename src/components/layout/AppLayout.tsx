import { Outlet } from 'react-router-dom';
import { AppSidebar, DealerSidebar } from './AppSidebar';

export function AppLayout() {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <AppSidebar />
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}

export function DealerLayout() {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <DealerSidebar />
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
