import { z } from 'zod';

export const recordPayoutSchema = z.object({
  paidAt: z.iso.date(),
  method: z.enum(['CASH', 'CHECK', 'BANK_TRANSFER', 'ZELLE', 'VENMO', 'OTHER']),
  reference: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(5000).optional(),
});
