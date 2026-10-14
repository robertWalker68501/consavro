import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { nextCookies } from 'better-auth/next-js';
import { Resend } from 'resend';
import prisma from '@/lib/prisma';
import { canRegister } from '@/lib/registration';

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 8,
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: false,
    async sendVerificationEmail({ user, url }) {
      // Local E2E email sink: never enabled in production. No real email is sent.
      if (process.env.NODE_ENV !== 'production' && process.env.CONSAVRO_E2E_EMAIL_DIR) {
        const { mkdir, writeFile } = await import('node:fs/promises');
        const { createHash } = await import('node:crypto');
        const { join } = await import('node:path');
        const directory = process.env.CONSAVRO_E2E_EMAIL_DIR;
        const key = createHash('sha256').update(user.email.toLowerCase()).digest('hex');
        await mkdir(directory, { recursive: true });
        await writeFile(join(directory, `${key}.json`), JSON.stringify({ url }), { mode: 0o600 });
        return;
      }
      if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
        throw new Error('Email delivery is not configured');
      }
      const resend = new Resend(process.env.RESEND_API_KEY);
      const { error } = await resend.emails.send({
        from: process.env.EMAIL_FROM,
        to: user.email,
        subject: 'Verify your Consavro email',
        text: `Verify your email address using this link: ${url}`,
      });
      if (error) throw new Error('Unable to send verification email');
    },
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          // Applies to both password sign-up and first-time OAuth sign-in.
          if (!canRegister(user.email)) return false;
          return { data: user };
        },
      },
    },
  },
  socialProviders: {
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? {
      google: { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET },
    } : {}),
    ...(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET ? {
      github: { clientId: process.env.GITHUB_CLIENT_ID, clientSecret: process.env.GITHUB_CLIENT_SECRET },
    } : {}),
  },
  plugins: [nextCookies()],
});
