'use client';

import { useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { Button, Field, Modal, Select, TextInput } from '../../../../components';

export type ApiKeyEnvironment = 'production' | 'staging' | 'development';

export const DEFAULT_SCOPES = 'assessment:read';
const MAX_SCOPES = 20;
const FORM_ID = 'api-key-create-form';

interface ApiKeyCreateModalProps {
  pending: boolean;
  error: string | null;
  onSubmit: (input: { name: string; environment: ApiKeyEnvironment; scopes: string[] }) => void;
  onClose: () => void;
}

/** "Nueva clave de API": a labelled form in the shared Modal (text-fields.md › Best practices). */
export function ApiKeyCreateModal({ pending, error, onSubmit, onClose }: ApiKeyCreateModalProps) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [environment, setEnvironment] = useState<ApiKeyEnvironment>('production');
  const [scopes, setScopes] = useState(DEFAULT_SCOPES);
  const [scopesError, setScopesError] = useState<string | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || pending) return;
    const parsed = scopes
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (parsed.length > MAX_SCOPES) {
      setScopesError(t.integrations.apiKeyScopesTooMany);
      return;
    }
    setScopesError(null);
    onSubmit({ name: name.trim(), environment, scopes: parsed });
  }

  return (
    <Modal
      title={t.integrations.newApiKey}
      onClose={onClose}
      size="sm"
      dirty={name.trim().length > 0}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            {t.integrations.apiKeyCancel}
          </Button>
          <Button
            type="submit"
            form={FORM_ID}
            disabled={!name.trim()}
            loading={pending}
            loadingLabel={t.integrations.apiKeyCreating}
          >
            {t.integrations.apiKeyCreate}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={submit} className="space-y-4">
        <Field label={t.integrations.apiKeyName} required>
          <TextInput value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label={t.integrations.apiKeyEnv}>
          <Select value={environment} onChange={(e) => setEnvironment(e.target.value as ApiKeyEnvironment)}>
            <option value="production">{t.integrations.apiKeyEnvProduction}</option>
            <option value="staging">{t.integrations.apiKeyEnvStaging}</option>
            <option value="development">{t.integrations.apiKeyEnvDevelopment}</option>
          </Select>
        </Field>
        <Field label={t.integrations.apiKeyScopes} help={t.integrations.apiKeyScopesHelp} error={scopesError}>
          <TextInput
            value={scopes}
            onChange={(e) => {
              setScopes(e.target.value);
              setScopesError(null);
            }}
            className="font-mono"
          />
        </Field>
        {error && (
          <p role="alert" className="text-callout text-danger">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
