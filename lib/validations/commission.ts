import { z } from 'zod';

// Percentage of sale price retained by the consignment business, not the consignor.
// Store exact two-decimal percentages, never floating-point fractions.
const percentagePattern = /^(?:100(?:\.0{1,2})?|(?:\d|[1-9]\d)(?:\.\d{1,2})?)$/;
export const commissionPercentageSchema = z.string().trim().regex(
  percentagePattern,
  'Enter a percentage from 0 to 100 with at most two decimal places.',
);
export const optionalCommissionPercentageSchema = z.string().trim().refine(
  value => value === '' || percentagePattern.test(value),
  'Enter a percentage from 0 to 100 with at most two decimal places.',
);
export const businessCommissionSchema = z.object({ defaultCommissionRate: commissionPercentageSchema });
