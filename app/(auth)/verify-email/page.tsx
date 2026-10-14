import Link from 'next/link';
export default function VerifyEmailPage() {
  return <div className="w-full max-w-md rounded-xl border bg-card p-6 text-center">
    <h1 className="text-2xl font-semibold">Verify your email</h1>
    <p className="mt-3 text-muted-foreground">Check your inbox for a verification link. You must verify your address before using Consavro.</p>
    <Link className="mt-5 inline-block text-primary underline" href="/sign-in">Back to sign in</Link>
  </div>;
}
