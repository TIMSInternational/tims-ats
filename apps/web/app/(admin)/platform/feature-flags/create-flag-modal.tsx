'use client';

import { useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { Button, CHOICE_INPUT_CLASSES, CHOICE_ROW_CLASSES, Field, Modal, TextInput } from '../../../../components';

interface CreateFlagModalProps {
  isPending: boolean;
  onCreate: (input: { key: string; enabled: boolean }) => void;
  onClose: () => void;
}

/** Create a flag for every organization. The default is a checkbox: nothing applies until "Crear flag". */
export function CreateFlagModal({ isPending, onCreate, onClose }: CreateFlagModalProps) {
  const { t } = useI18n();
  const ff = t.featureFlags;
  const [key, setKey] = useState('');
  const [enabled, setEnabled] = useState(false);

  const submit = () => {
    if (key && !isPending) onCreate({ key, enabled });
  };

  return (
    <Modal
      title={ff.createFlagTitle}
      description={ff.createForAllOrgs}
      onClose={onClose}
      dirty={key.length > 0}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            {t.common.cancel}
          </Button>
          <Button onClick={submit} disabled={!key} loading={isPending} loadingLabel={t.common.saving}>
            {ff.createFlagSubmit}
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label={ff.flagKeyLabel} help={ff.keyHelp} required>
          <TextInput
            autoFocus
            value={key}
            onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
            placeholder={ff.keyPlaceholder}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
        </Field>
        <label className={CHOICE_ROW_CLASSES}>
          <input
            type="checkbox"
            className={CHOICE_INPUT_CLASSES}
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          {ff.enabledByDefault}
        </label>
      </form>
    </Modal>
  );
}
