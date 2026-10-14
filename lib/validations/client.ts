import { z } from 'zod';
import { optionalCommissionPercentageSchema } from './commission';

const optionalText = (max: number, label: string) =>
  z.string().trim().max(max, `${label} must be at most ${max} characters`);

export const clientSchema = z.object({
  name: z.string().trim().min(2, 'Client name must be at least 2 characters').max(120, 'Client name must be at most 120 characters'),
  email: z.string().trim().refine(value => !value || z.email().safeParse(value).success, 'Enter a valid email address').max(254, 'Email must be at most 254 characters'),
  phone: optionalText(40, 'Phone'),
  addressLine1: optionalText(200, 'Street address'),
  addressLine2: optionalText(200, 'Apartment or suite'),
  city: optionalText(100, 'City'),
  state: optionalText(100, 'State or region'),
  postalCode: optionalText(30, 'Postal code'),
  country: optionalText(100, 'Country'),
  notes: optionalText(5000, 'Notes'),
  commissionRateOverride: optionalCommissionPercentageSchema,
});
export type ClientValues = z.infer<typeof clientSchema>;
export const clientContactFields = [
  'email', 'phone', 'addressLine1', 'addressLine2', 'city',
  'state', 'postalCode', 'country', 'notes',
] as const;
export type ClientContactField = (typeof clientContactFields)[number];
