import { z } from 'zod';

export const inventoryItemSchema = z.object({
  name: z.string().trim().min(2, 'Item name must be at least 2 characters').max(160, 'Item name must be at most 160 characters'),
  sku: z.string().trim().max(80, 'SKU must be at most 80 characters'),
  quantity: z.coerce.number<number>().int('Quantity must be a whole number').min(0, 'Quantity cannot be negative').max(1_000_000, 'Quantity is too large'),
  description: z.string().trim().max(5000, 'Description must be at most 5000 characters'),
});
export type InventoryItemValues = z.infer<typeof inventoryItemSchema>;
