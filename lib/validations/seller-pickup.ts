import { z } from 'zod';

export const pickupSchema = z.object({
  clientId: z.string().min(1, 'Select a seller.'),
  date: z.iso.date(),
  location: z.string().trim().max(500).default(''),
  notes: z.string().trim().max(10000).default(''),
});
