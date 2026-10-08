'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, errorMessage } from '@/components/api';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { Textarea } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';

/** PATCH /api/appointments/[id]/note (US3.3). */
export default function DentistNoteForm({ appointmentId, initialNote }: { appointmentId: number; initialNote: string }) {
  const router = useRouter();
  const toast = useToast();
  const [note, setNote] = useState(initialNote);
  const [saved, setSaved] = useState(initialNote);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = note !== saved;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (note.length > 2000) {
      setError('Too long (2000 characters max)');
      return;
    }
    setSaving(true);
    setError(null);
    const r = await api(`/api/appointments/${appointmentId}/note`, { method: 'PATCH', body: { dentistNote: note } });
    setSaving(false);
    if (r.ok) {
      setSaved(note);
      toast.show({ tone: 'success', title: note.trim() ? 'Dentist note saved' : 'Dentist note cleared' });
      router.refresh();
    } else {
      setError(r.data.issues?.dentistNote ?? errorMessage(r, 'Could not save the note.'));
    }
  }

  return (
    <Card>
      <CardHeader title="Dentist note" description="Visible on the patient's history for the next visit." />
      <form onSubmit={save} className="flex flex-col gap-3 px-4 py-4 sm:px-5">
        <Textarea
          label="Note"
          name="dentistNote"
          rows={4}
          maxLength={2000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Sensitive lower left molar; recheck filling in 6 months"
          error={error}
          hint={`${note.length}/2000`}
        />
        <div className="flex items-center justify-end gap-3">
          {dirty && <span className="text-xs text-slate-500">Unsaved changes</span>}
          <Button type="submit" variant="secondary" loading={saving} disabled={!dirty}>
            Save note
          </Button>
        </div>
      </form>
    </Card>
  );
}
