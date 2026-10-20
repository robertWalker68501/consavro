import { z } from 'zod';

const optionalText = (max: number) => z.string().trim().max(max).default('');
const optionalMoney = z.union([z.string(), z.number()]).transform(value => String(value).trim()).refine(
  value => value === '' || (/^\d{1,10}(\.\d{1,2})?$/.test(value) && Number(value) <= 9999999999.99),
  'Enter a valid non-negative amount with up to two decimal places',
).default('');

export const inventoryItemSchema = z.object({
  name: z.string().trim().min(2, 'Item name must be at least 2 characters').max(160, 'Item name must be at most 160 characters'),
  sku: optionalText(80),
  status: z.enum(['IN_STOCK', 'RESERVED', 'SOLD']).default('IN_STOCK'),
  quantity: z.coerce.number<number>().int('Quantity must be a whole number').min(0, 'Quantity cannot be negative').max(1_000_000, 'Quantity is too large'),
  description: optionalText(5000),
  setNumber: optionalText(40),
  theme: optionalText(100),
  condition: z.enum(['', 'NEW_SEALED', 'NEW_OPEN_BOX', 'USED']).default(''),
  completeness: z.enum(['', 'COMPLETE', 'INCOMPLETE', 'UNKNOWN']).default(''),
  askingPrice: optionalMoney,
  estimatedValue: optionalMoney,
  clientId: optionalText(100),
  legoSetId: optionalText(100),
});
export type InventoryItemValues = z.input<typeof inventoryItemSchema>;
export type ParsedInventoryItemValues = z.output<typeof inventoryItemSchema>;
