'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { formatContact, normalizeContact } from '@/lib/rules';
import type { PatientProfile } from '@/lib/types';
import { fieldErrors, patientPatchSchema } from '@/lib/validation';
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
    contactNumber: formatContact(patient.contactNumber),
    email: patient.email ?? '',
    birthdate: patient.birthdate,
  };
  const [values, setValues] = useState<Values>(initial);
  const [baseline, setBaseline] = useState<Values>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const changed = (Object.keys(values) as (keyof Values)[]).filter((k) =>
    k === 'contactNumber' ? normalizeContact(values[k]) !== normalizeContact(baseline[k]) || (!normalizeContact(values[k]) && values[k] !== baseline[k]) : values[k].trim() !== baseline[k].trim(),
  );
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
    const parsed = patientPatchSchema.safeParse(patch);
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setSaving(true);
    const r = await api(`/api/patients/${patient.patientId}`, { method: 'PATCH', body: patch });
    setSaving(false);
    if (r.ok) {
      const next = { ...values, contactNumber: normalizeContact(values.contactNumber) ? formatContact(normalizeContact(values.contactNumber)!) : values.contactNumber };
      setValues(next);
      setBaseline(next);
      toast.show({ tone: 'success', title: 'Patient details saved' });
      router.refresh();
      return;
    }
    if (r.status === 409) {
      setErrors({ contactNumber: r.data.message ?? 'Contact number already used by another patient' });
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
          <Input label="Full name" required value={values.fullName} onChange={(e) => set('fullName', e.target.value)} error={errors.fullName} maxLength={150} />
          <Input
            label="Contact number"
            required
            type="tel"
            inputMode="tel"
            value={values.contactNumber}
            onChange={(e) => set('contactNumber', e.target.value)}
            error={errors.contactNumber}
            maxLength={30}
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
