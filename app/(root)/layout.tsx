import { ReactNode } from 'react';

import Footer from '@/components/layout/Footer';
import Header from '@/components/layout/Header';

const SharedLayout = ({ children }: { children: ReactNode }) => {
  return (
    <div className='flex min-h-dvh flex-col'>
      <Header />
      <main className='flex-1'>{children}</main>
      <Footer />
    </div>
  );
};

export default SharedLayout;
