import { z } from 'zod';
export const pickupItemSchema = z.object({
  kind: z.enum(['CATALOG_SET','UNIDENTIFIED_SET','BULK_LOT']),
  legoSetId: z.string().trim().max(100).optional().nullable(),
  name: z.string().trim().min(1).max(200),
  setNumber: z.string().trim().max(40).optional().nullable(),
  theme: z.string().trim().max(120).optional().nullable(),
  quantity: z.number().int().min(1).max(100000),
  description: z.string().trim().max(10000).optional().nullable(),
  condition: z.enum(['UNKNOWN','NEW','USED']).default('UNKNOWN'),
  completeness: z.enum(['UNKNOWN','COMPLETE','INCOMPLETE']).default('UNKNOWN'),
  inspectionNotes: z.string().trim().max(10000).optional().nullable(),
  estimatedValue: z.string().regex(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/, 'Enter a valid non-negative amount with up to two decimal places.').optional().nullable(),
  askingPrice: z.string().regex(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/, 'Enter a valid non-negative amount with up to two decimal places.').optional().nullable(),
}).superRefine((v,ctx)=>{
  if(v.kind==='CATALOG_SET' && !v.legoSetId) ctx.addIssue({code:'custom',path:['legoSetId'],message:'Select a catalog set.'});
  if(v.kind!=='CATALOG_SET' && v.legoSetId) ctx.addIssue({code:'custom',path:['legoSetId'],message:'Only identified sets can reference the catalog.'});
});
