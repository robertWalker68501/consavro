import { z } from 'zod';

export const createBusinessSchema = z.object({
  name: z.string().trim().min(2, 'Business name must be at least 2 characters').max(100, 'Business name must be at most 100 characters'),
});
export type CreateBusinessValues = z.infer<typeof createBusinessSchema>;
