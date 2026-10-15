import { z } from 'zod';

export const createSaleSchema = z.object({
  inventoryItemId: z.string().min(1, 'Choose an inventory item.'),
  salePrice: z.string().trim().regex(/^\d{1,10}(\.\d{1,2})?$/, 'Enter a valid sale price with up to two decimal places.'),
  soldAt: z.iso.date('Enter a valid sale date.'),
  notes: z.string().trim().max(5000, 'Notes must be 5,000 characters or fewer.').default(''),
});
export type CreateSaleValues = z.input<typeof createSaleSchema>;
