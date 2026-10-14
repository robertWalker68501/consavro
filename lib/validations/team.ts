import { z } from 'zod';

export const addTeamMemberSchema = z.object({
  email: z.email('Enter a valid email address').trim().toLowerCase(),
  role: z.enum(['MANAGER', 'STAFF']),
});

export const changeTeamRoleSchema = z.object({
  membershipId: z.string().min(1),
  role: z.enum(['OWNER', 'MANAGER', 'STAFF']),
});

export const removeTeamMemberSchema = z.object({ membershipId: z.string().min(1) });
export type AddTeamMemberValues = z.infer<typeof addTeamMemberSchema>;
