'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { FormFieldControl } from '@/components/form-fields/FormFieldControl';
import { addTeamMemberSchema, type AddTeamMemberValues } from '@/lib/validations/team';
import { addTeamMember, changeTeamMemberRole, removeTeamMember } from '@/app/(dashboard)/dashboard/businesses/[businessId]/team/actions';

type Member = { id: string; userId: string; role: 'OWNER' | 'MANAGER' | 'STAFF'; user: { name: string; email: string } };
type Props = { businessId: string; currentUserId: string; canManage: boolean; members: Member[] };

export function TeamManagement({ businessId, currentUserId, canManage, members }: Props) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const form = useForm<AddTeamMemberValues>({ resolver: zodResolver(addTeamMemberSchema), defaultValues: { email: '', role: 'STAFF' } });

  async function add(values: AddTeamMemberValues) {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await addTeamMember(businessId, values);
      if (!result.ok) { setError(result.error); return; }
      form.reset(); setNotice('Team member added.'); router.refresh();
    } catch { setError('Unable to add team member.'); }
    finally { setBusy(false); }
  }

  async function update(membershipId: string, role: Member['role']) {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await changeTeamMemberRole(businessId, { membershipId, role });
      if (!result.ok) { setError(result.error); return; }
      setNotice('Role updated.'); router.refresh();
    } catch { setError('Unable to update role.'); }
    finally { setBusy(false); }
  }

  async function remove(membershipId: string) {
    if (!window.confirm('Remove this member from the business?')) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await removeTeamMember(businessId, { membershipId });
      if (!result.ok) { setError(result.error); return; }
      setNotice('Team member removed.'); router.refresh();
    } catch { setError('Unable to remove team member.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="mt-8 space-y-8">
      {canManage && <section aria-label="Add team member" className="space-y-4 rounded-lg border p-5">
        <h2 className="text-lg font-semibold">Add existing account</h2>
        <p className="text-sm text-muted-foreground">The person must already have a verified Consavro account. Invitations are coming later.</p>
        <form noValidate onSubmit={form.handleSubmit(add)} className="space-y-4">
          <FormFieldControl control={form.control} name="email" label="Member email" type="email" required />
          <FormFieldControl control={form.control} name="role" label="Business role" type="select" required options={[{ label: 'Staff', value: 'STAFF' }, { label: 'Manager', value: 'MANAGER' }]} />
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Add member'}</Button>
        </form>
      </section>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      <section aria-label="Team members" className="space-y-3">
        <h2 className="text-lg font-semibold">Team members ({members.length})</h2>
        <ul className="space-y-3">
          {members.map(member => <li key={member.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
            <div><p className="font-medium">{member.user.name}{member.userId === currentUserId ? ' (you)' : ''}</p><p className="text-sm text-muted-foreground">{member.user.email}</p></div>
            <div className="flex items-center gap-3">
              {canManage && member.userId !== currentUserId ? <>
                <label className="sr-only" htmlFor={`role-${member.id}`}>Role for {member.user.name}</label>
                <select id={`role-${member.id}`} aria-label={`Role for ${member.user.name}`} className="rounded-md border bg-background px-2 py-2 text-sm" value={member.role} disabled={busy} onChange={(event) => void update(member.id, event.target.value as Member['role'])}>
                  <option value="OWNER">Owner</option><option value="MANAGER">Manager</option><option value="STAFF">Staff</option>
                </select>
                <Button type="button" variant="outline" disabled={busy} onClick={() => void remove(member.id)}>Remove {member.user.name}</Button>
              </> : <span className="text-sm">{member.role}</span>}
            </div>
          </li>)}
        </ul>
      </section>
    </div>
  );
}
