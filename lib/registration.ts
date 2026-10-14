/** Server-side registration policy. Invitations will be added in Layer 3. */
export function canRegister(email: string): boolean {
  if (process.env.CONSAVRO_PUBLIC_REGISTRATION === 'true') return true;
  const allowed = (process.env.CONSAVRO_ALLOWED_EMAILS ?? '')
    .split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(email.trim().toLowerCase());
}
