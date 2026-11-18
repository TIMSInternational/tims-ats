'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { useEvaluation360CreateCycle } from '../../../../lib/platform-api/evaluation360';
import { Button, BUTTON_GROUP_CLASSES, Field, TextInput } from '../../../../components';

interface CreateCycleFormProps {
  onClose: () => void;
}

export function CreateCycleForm({ onClose }: CreateCycleFormProps) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');

  const create = useEvaluation360CreateCycle({
    onSuccess: () => {
      toast(t.evaluation360.cycleCreated, { type: 'success' });
      queryClient.invalidateQueries({ queryKey: ['platform-api', 'evaluation360', 'cycles'] });
      setName('');
      onClose();
    },
    onError: (err) => toast(err.message, { type: 'error' }),
  });

  const canSubmit = !create.isPending && name.trim().length > 0;

  return (
    <form
      aria-labelledby="create-cycle-title"
      className="rounded-xl border border-border bg-white p-5 shadow-card"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) create.mutate({ name: name.trim() });
      }}
    >
      <h2 id="create-cycle-title" className="mb-3 text-heading font-semibold text-brand">
        {t.evaluation360.newCycleTitle}
      </h2>
      <Field label={t.evaluation360.cycleNameLabel} className="mb-4">
        <TextInput
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 200))}
          placeholder={t.evaluation360.cycleNamePlaceholder}
          disabled={create.isPending}
          maxLength={200}
          autoFocus
        />
      </Field>
      <div className={BUTTON_GROUP_CLASSES}>
        <Button variant="secondary" onClick={onClose} disabled={create.isPending}>
          {t.common.cancel}
        </Button>
        <Button type="submit" disabled={!canSubmit} loading={create.isPending} loadingLabel={t.evaluation360.creating}>
          {t.evaluation360.saveButton}
        </Button>
      </div>
    </form>
  );
}
