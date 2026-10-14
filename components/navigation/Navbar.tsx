import { NAV_LINKS } from '@/constants';

import SiteLogo from '../SiteLogo';
import { ThemeToggle } from '../ui/theme-toggle';

import MobileNav from './MobileNav';
import NavLink from './NavLink';

const Navbar = () => {
  return (
    <nav className='flex items-center justify-between'>
      {/* Site logo */}
      <SiteLogo href='/' />

      {/* Desktop nav */}
      <div className='hidden items-center gap-5 md:flex'>
        {NAV_LINKS.map((link) => (
          <NavLink
            key={link.id}
            href={link.href}
            label={link.label}
          />
        ))}
        <ThemeToggle />
      </div>

      {/* Mobile nav */}
      <div className='block md:hidden'>
        <MobileNav />
      </div>
    </nav>
  );
};

export default Navbar;
