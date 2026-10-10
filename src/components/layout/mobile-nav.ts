import { createContext, useContext } from 'react';

/** Lets the page header (rendered by each page) open the layout's navigation drawer on phones. */
export interface MobileNav {
  open: () => void;
  isOpen: boolean;
}

export const MobileNavContext = createContext<MobileNav | null>(null);

export const useMobileNav = () => useContext(MobileNavContext);
