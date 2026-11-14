'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import {
  Button,
  CHOICE_INPUT_CLASSES,
  CHOICE_ROW_CLASSES,
  Drawer,
  Field,
  Select,
  TabPanel,
  Tabs,
  TextArea,
  TextInput,
} from '../../../../components';
import type { AiAgentItem } from '../../../../lib/trpc-types';
import { AgentOrgsTab } from './agent-orgs-tab';
import { AgentUsageTab } from './agent-usage-tab';

type Tab = 'config' | 'orgs' | 'usage';
type Model = 'haiku' | 'sonnet';
type Status = 'active' | 'stub' | 'disabled';

const ID_PREFIX = 'agent-drawer';

interface AgentDetailDrawerProps {
  agent: AiAgentItem;
  onClose: () => void;
  onSuccess: () => void;
}

/** Inspect and edit one agent beside the registry (shared Drawer: focus trap, Escape, focus return). */
export function AgentDetailDrawer({ agent, onClose, onSuccess }: AgentDetailDrawerProps) {
  const { t } = useI18n();
  const ai = t.aiAgents;
  const [tab, setTab] = useState<Tab>('config');

  const [editModel, setEditModel] = useState<Model>(agent.model as Model);
  const [editCache, setEditCache] = useState(agent.cacheTtlSeconds);
  const [editBatch, setEditBatch] = useState(agent.batchEligible);
  const [editStatus, setEditStatus] = useState<Status>(agent.status as Status);
  const [editDescription, setEditDescription] = useState(agent.description);

  const updateAgent = trpc.platform.updateAiAgent.useMutation({
    onSuccess: () => {
      toast(ai.updated, { type: 'success' });
      onSuccess();
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });

  // Both reads start when the drawer opens, as before; the tabs only render them.
  const agentDetail = trpc.platform.getAiAgent.useQuery({ id: agent.id });
  const usage = trpc.platform.getAiAgentUsage.useQuery({ agentId: agent.id, days: 30 });

  const dirty =
    editModel !== agent.model ||
    editCache !== agent.cacheTtlSeconds ||
    editBatch !== agent.batchEligible ||
    editStatus !== agent.status ||
    editDescription !== agent.description;

  const save = () =>
    updateAgent.mutate({
      id: agent.id,
      model: editModel,
      cacheTtlSeconds: editCache,
      batchEligible: editBatch,
      status: editStatus,
      description: editDescription,
    });

  const tabs = [
    { id: 'config', label: ai.tabConfig },
    { id: 'orgs', label: ai.tabOrgs, count: agent._count.orgConfigs },
    { id: 'usage', label: ai.tabUsage },
  ];

  return (
    <Drawer
      title={agent.name}
      subtitle={<span className="font-mono">{agent.slug}</span>}
      onClose={onClose}
      size="lg"
      dirty={dirty}
      header={
        <Tabs
          label={ai.drawerTabsLabel}
          tabs={tabs}
          selectedId={tab}
          onSelect={(id) => setTab(id as Tab)}
          idPrefix={ID_PREFIX}
          className="border-b-0"
        />
      }
      footer={
        tab === 'config' ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              {t.common.cancel}
            </Button>
            <Button onClick={save} loading={updateAgent.isPending} loadingLabel={t.common.saving}>
              {ai.saveChanges}
            </Button>
          </>
        ) : undefined
      }
    >
      <TabPanel idPrefix={ID_PREFIX} tabId={tab}>
        {tab === 'config' && (
          <div className="space-y-4">
            <Field label={ai.statusLabel}>
              <Select value={editStatus} onChange={(e) => setEditStatus(e.target.value as Status)}>
                <option value="active">{ai.statusActive}</option>
                <option value="stub">{ai.statusStub}</option>
                <option value="disabled">{ai.statusDisabled}</option>
              </Select>
            </Field>
            <Field label={ai.modelLabel}>
              <Select value={editModel} onChange={(e) => setEditModel(e.target.value as Model)}>
                <option value="haiku">{ai.modelHaiku}</option>
                <option value="sonnet">{ai.modelSonnet}</option>
              </Select>
            </Field>
            <Field label={ai.cacheTtlLabel} help={ai.cacheTtlHelp}>
              <TextInput
                type="number"
                min={0}
                inputMode="numeric"
                value={editCache}
                onChange={(e) => setEditCache(Number(e.target.value))}
                className="tabular-nums"
              />
            </Field>
            <label className={CHOICE_ROW_CLASSES}>
              <input
                type="checkbox"
                className={CHOICE_INPUT_CLASSES}
                checked={editBatch}
                onChange={(e) => setEditBatch(e.target.checked)}
              />
              {ai.batchLabel}
            </label>
            <Field label={ai.descriptionLabel}>
              <TextArea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={3} />
            </Field>
          </div>
        )}
        {tab === 'orgs' && <AgentOrgsTab agent={agent} detail={agentDetail} />}
        {tab === 'usage' && <AgentUsageTab usage={usage} />}
      </TabPanel>
    </Drawer>
  );
}
