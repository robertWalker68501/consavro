'use client';

import { Menu } from 'lucide-react';
import { useState } from 'react';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { NAV_LINKS } from '@/constants';

import SiteLogo from '../SiteLogo';
import { ThemeToggle } from '../ui/theme-toggle';

import NavLink from './NavLink';

const MobileNav = () => {
  const [open, setOpen] = useState<boolean>(false);

  const handleOpen = () => {
    setOpen((prev) => !prev);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
    >
      <SheetTrigger>
        <Menu size={22} />
      </SheetTrigger>
      <SheetContent side='left'>
        <SheetHeader>
          <SheetTitle>
            <SiteLogo
              href='/'
              onClick={handleOpen}
            />
          </SheetTitle>
          <SheetDescription>
            consignment management with powerful tools.
          </SheetDescription>
        </SheetHeader>
        <div className='flex flex-col gap-4 px-4'>
          {NAV_LINKS.map((link) => (
            <NavLink
              key={link.id}
              href={link.href}
              label={link.label}
              isMobile
              onClick={handleOpen}
            />
          ))}
        </div>
        <SheetFooter>
          <ThemeToggle />
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
};

export default MobileNav;
