import { Suspense } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { AuthForm } from '@/components/auth/AuthForm';

async function SignInContent() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) redirect('/dashboard');

  return <AuthForm mode="sign-in" />;
}

export default function SignInPage() {
  return (
    <Suspense fallback={<div role="status" className="text-muted-foreground">Loading sign in…</div>}>
      <SignInContent />
    </Suspense>
  );
}
