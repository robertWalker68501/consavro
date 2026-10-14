'use server';

import { revalidatePath } from 'next/cache';
import { Prisma } from '@/app/generated/prisma/client';
import prisma from '@/lib/prisma';
import { requireBusinessPermission } from '@/lib/business-access';
import { addTeamMemberSchema, changeTeamRoleSchema, removeTeamMemberSchema } from '@/lib/validations/team';

type Result = { ok: true } | { ok: false; error: string };
const fail = (error: string): Result => ({ ok: false, error });

export async function addTeamMember(businessId: string, input: unknown): Promise<Result> {
  await requireBusinessPermission(businessId, 'members:manage');
  const parsed = addTeamMemberSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? 'Invalid member details.');
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email }, select: { id: true, emailVerified: true } });
  if (!user || !user.emailVerified) return fail('No verified account exists for that email. Invitations will be supported later.');
  try {
    await prisma.businessMember.create({ data: { businessId, userId: user.id, role: parsed.data.role } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return fail('This user already belongs to the business.');
    throw error;
  }
  revalidatePath(`/dashboard/businesses/${businessId}/team`);
  return { ok: true };
}

export async function changeTeamMemberRole(businessId: string, input: unknown): Promise<Result> {
  const { user } = await requireBusinessPermission(businessId, 'members:manage');
  const parsed = changeTeamRoleSchema.safeParse(input);
  if (!parsed.success) return fail('Invalid membership or role.');
  try {
    const result = await prisma.$transaction(async (tx) => {
      const member = await tx.businessMember.findFirst({ where: { id: parsed.data.membershipId, businessId } });
      if (!member) return fail('Team member not found.');
      if (member.userId === user.id) return fail('You cannot change your own role.');
      if (member.role === 'OWNER' && parsed.data.role !== 'OWNER') {
        const owners = await tx.businessMember.count({ where: { businessId, role: 'OWNER' } });
        if (owners <= 1) return fail('The last OWNER cannot be demoted.');
      }
      await tx.businessMember.update({ where: { id: member.id }, data: { role: parsed.data.role } });
      return { ok: true } as Result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (result.ok) revalidatePath(`/dashboard/businesses/${businessId}/team`);
    return result;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') return fail('Membership changed concurrently. Please retry.');
    throw error;
  }
}

export async function removeTeamMember(businessId: string, input: unknown): Promise<Result> {
  const { user } = await requireBusinessPermission(businessId, 'members:manage');
  const parsed = removeTeamMemberSchema.safeParse(input);
  if (!parsed.success) return fail('Invalid membership.');
  try {
    const result = await prisma.$transaction(async (tx) => {
      const member = await tx.businessMember.findFirst({ where: { id: parsed.data.membershipId, businessId } });
      if (!member) return fail('Team member not found.');
      if (member.userId === user.id) return fail('You cannot remove yourself from the business.');
      if (member.role === 'OWNER') {
        const owners = await tx.businessMember.count({ where: { businessId, role: 'OWNER' } });
        if (owners <= 1) return fail('The last OWNER cannot be removed.');
      }
      await tx.businessMember.delete({ where: { id: member.id } });
      return { ok: true } as Result;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (result.ok) revalidatePath(`/dashboard/businesses/${businessId}/team`);
    return result;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') return fail('Membership changed concurrently. Please retry.');
    throw error;
  }
}
