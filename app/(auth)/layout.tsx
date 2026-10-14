import type { ReactNode } from 'react';
import Link from 'next/link';
import { Layers3 } from 'lucide-react';
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-background px-4 py-12"><div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-gradient-to-b from-teal-500/10 to-transparent"/><Link href="/" className="relative mb-8 flex items-center gap-2 text-2xl font-bold tracking-tight"><span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Layers3 className="size-5"/></span>Consavro</Link><div className="relative w-full max-w-md">{children}</div><p className="relative mt-8 text-center text-xs text-muted-foreground">A better way to run your consignment business.</p></main>;
}
