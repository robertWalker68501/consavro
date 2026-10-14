'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { FormFieldControl } from '@/components/form-fields/FormFieldControl';
import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth-client';
import { signInSchema, signUpSchema, type SignInValues, type SignUpValues } from '@/lib/validations/auth';

export function AuthForm({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const signUp = mode === 'sign-up';
  const form = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { name: '', email: '', password: '' },
  });
  const loginForm = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  });

  async function submitSignUp(values: SignUpValues) {
    setError(''); setNotice(''); setBusy(true);
    try {
      const result = await authClient.signUp.email({ ...values, callbackURL: '/sign-in' });
      if (result.error) { setError(result.error.message ?? 'Unable to create account'); return; }
      setNotice('Check your email for a verification link, then sign in.');
    } catch { setError('Unable to create account. Please try again.'); }
    finally { setBusy(false); }
  }
  async function submitSignIn(values: SignInValues) {
    setError(''); setBusy(true);
    try {
      const result = await authClient.signIn.email({ ...values, callbackURL: '/dashboard' });
      if (result.error) { setError(result.error.message ?? 'Unable to sign in'); return; }
      router.replace('/dashboard'); router.refresh();
    } catch { setError('Unable to sign in. Please try again.'); }
    finally { setBusy(false); }
  }
  async function social(provider: 'google' | 'github') {
    setError(''); setBusy(true);
    try {
      const result = await authClient.signIn.social({ provider, callbackURL: '/dashboard', errorCallbackURL: '/sign-in' });
      if (result.error) setError(result.error.message ?? 'Social sign-in failed');
    } catch { setError('Unable to start social sign-in'); }
    finally { setBusy(false); }
  }
  return (
    <div className="mx-auto w-full max-w-md rounded-xl border bg-card p-6 shadow-sm">
      <h1 className="text-2xl font-semibold">{signUp ? 'Create an account' : 'Sign in to Consavro'}</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">{signUp ? 'Registration is currently limited to approved email addresses.' : 'Manage your consignments in one place.'}</p>
      {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="mb-4 text-sm text-primary">{notice}</p>}
      {signUp ? (
        <form noValidate onSubmit={form.handleSubmit(submitSignUp)} className="space-y-4">
          <FormFieldControl control={form.control} name="name" type="text" label="Full name" autoComplete="name" required />
          <FormFieldControl control={form.control} name="email" type="email" label="Email" autoComplete="email" required />
          <FormFieldControl control={form.control} name="password" type="password" label="Password" autoComplete="new-password" required />
          <Button type="submit" disabled={busy} className="w-full">{busy ? 'Creating account…' : 'Create account'}</Button>
        </form>
      ) : (
        <form noValidate onSubmit={loginForm.handleSubmit(submitSignIn)} className="space-y-4">
          <FormFieldControl control={loginForm.control} name="email" type="email" label="Email" autoComplete="email" required />
          <FormFieldControl control={loginForm.control} name="password" type="password" label="Password" autoComplete="current-password" required />
          <Button type="submit" disabled={busy} className="w-full">{busy ? 'Signing in…' : 'Sign in'}</Button>
        </form>
      )}
      <div className="mt-5 grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" disabled={busy} onClick={() => social('google')}>Google</Button>
        <Button type="button" variant="outline" disabled={busy} onClick={() => social('github')}>GitHub</Button>
      </div>
      <p className="mt-6 text-center text-sm text-muted-foreground">{signUp ? 'Already have an account?' : 'Have an approved email?'}{' '}
        <Link className="text-primary underline" href={signUp ? '/sign-in' : '/sign-up'}>{signUp ? 'Sign in' : 'Create an account'}</Link>
      </p>
    </div>
  );
}
