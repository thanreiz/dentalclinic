'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PhoneInput, toMobileDigits } from '@/components/ui/PhoneInput';
import type { PatientProfile } from '@/lib/types';
import { stripNameChars } from '@/lib/name';
import { api, errorMessage } from '@/components/api';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { FormError, Input } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';

type Values = { fullName: string; contactNumber: string; email: string; birthdate: string };

/** Editable profile (PATCH /api/patients/[id]); duplicate contact (409) is shown inline. */
export default function PatientProfileForm({ patient, today }: { patient: PatientProfile; today: string }) {
  const router = useRouter();
  const toast = useToast();
  const initial: Values = {
    fullName: patient.fullName,
    contactNumber: toMobileDigits(patient.contactNumber),
    email: patient.email ?? '',
    birthdate: patient.birthdate,
  };
  const [values, setValues] = useState<Values>(initial);
  const [baseline, setBaseline] = useState<Values>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const changed = (Object.keys(values) as (keyof Values)[]).filter((k) => values[k].trim() !== baseline[k].trim());
  const dirty = changed.length > 0;

  function set(k: keyof Values, v: string) {
    setValues((s) => ({ ...s, [k]: v }));
    setErrors((e) => {
      const n = { ...e };
      delete n[k];
      return n;
    });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const patch = Object.fromEntries(changed.map((k) => [k, values[k]]));
    const { fieldErrors, patientPatchSchema } = await import('@/lib/validation');
    const parsed = patientPatchSchema.safeParse(patch);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setSaving(true);
    const r = await api(`/api/patients/${patient.patientId}`, { method: 'PATCH', body: patch });
    setSaving(false);
    if (r.ok) {
      setBaseline(values);
      toast.show({ tone: 'success', title: 'Patient details saved' });
      router.refresh();
      return;
    }
    if (r.status === 409) {
      const field = r.data.error === 'duplicate_email' ? 'email' : r.data.error === 'duplicate_name' ? 'fullName' : 'contactNumber';
      setErrors({ [field]: r.data.message ?? 'Already used by another patient' });
      return;
    }
    if (r.status === 400 && r.data.issues) {
      setErrors(r.data.issues);
      return;
    }
    setFormError(errorMessage(r, 'Could not save the changes.'));
  }

  return (
    <Card>
      <CardHeader title="Profile" description="Edit the patient's details. The contact number must be unique." />
      <form onSubmit={save} noValidate className="px-4 py-4 sm:px-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Full name" required value={values.fullName} onChange={(e) => set('fullName', stripNameChars(e.target.value))} error={errors.fullName} maxLength={150} />
          <PhoneInput
            label="Contact number"
            required={baseline.contactNumber !== ''}
            hint={baseline.contactNumber === '' ? 'Saved number is not a PH mobile. Enter a mobile (10 digits starting with 9) to replace it.' : undefined}
            value={values.contactNumber}
            onValueChange={(d) => set('contactNumber', d)}
            error={errors.contactNumber}
          />
          <Input
            label="Email"
            optional
            type="email"
            value={values.email}
            onChange={(e) => set('email', e.target.value)}
            error={errors.email}
            hint="Used for confirmations and reminders."
            maxLength={150}
          />
          <Input label="Birthdate" required type="date" max={today} value={values.birthdate} onChange={(e) => set('birthdate', e.target.value)} error={errors.birthdate} />
        </div>
        <FormError className="mt-4">{formError}</FormError>
        <div className="mt-4 flex items-center justify-end gap-3">
          {dirty && (
            <Button
              variant="ghost"
              onClick={() => {
                setValues(baseline);
                setErrors({});
              }}
              disabled={saving}
            >
              Discard
            </Button>
          )}
          <Button type="submit" loading={saving} loadingText="Saving…" disabled={!dirty}>
            Save changes
          </Button>
        </div>
      </form>
    </Card>
  );
}
