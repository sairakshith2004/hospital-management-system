import { SETTINGS } from '@hospitalos/shared';
import { useState } from 'react';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Input } from '../../components/ui/input';
import { PageHeader } from '../../components/ui/page-header';
import { Spinner } from '../../components/ui/spinner';
import { Table, Td, Th } from '../../components/ui/table';
import { useAction, useApi } from '../../lib/use-api';
import { useAuth } from '../auth/auth-context';

const GROUP: Record<string, string> = {
  'system_settings:manage': 'System (Super Admin)',
  'security_settings:manage': 'Security (Super Admin)',
  'operational_settings:manage': 'Operational (Administrator)',
};

/** Each setting can be changed only with its own permission; changes are audited. */
export function SettingsPage() {
  const { can } = useAuth();
  const q = useApi<{ settings: Record<string, string | number | boolean | null> }>(
    '/api/admin/settings',
  );
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const save = useAction<{ key: string; value: string | number | boolean; reason: string }>(
    'POST',
    '/api/admin/settings',
    {
      invalidate: ['/api/admin/settings'],
      onSuccess: () => setEditing(null),
    },
  );
  if (q.isPending) return <Spinner />;
  if (q.isError) return <Alert tone="error">{q.error.message}</Alert>;
  const s = q.data.settings;
  const def = editing ? SETTINGS[editing]! : null;
  return (
    <div className="space-y-4">
      <PageHeader
        title="Settings"
        description={`Time zone ${s.timezone} · currency ${s.currency}`}
      />
      <Table aria-label="Settings">
        <thead>
          <tr>
            <Th>Setting</Th>
            <Th>Value</Th>
            <Th>Changed by</Th>
            <Th></Th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(SETTINGS).map(([key, d]) => (
            <tr key={key}>
              <Td>{d.label}</Td>
              <Td className="tabular-nums">
                {d.type === 'time'
                  ? String(s[key] ?? '').slice(0, 5)
                  : d.type === 'bool'
                    ? s[key]
                      ? 'On'
                      : 'Off'
                    : String(s[key] ?? '—')}
              </Td>
              <Td className="text-xs">{GROUP[d.permission]}</Td>
              <Td>
                {can(d.permission) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditing(key);
                      setValue(
                        SETTINGS[key]!.type === 'time'
                          ? String(s[key] ?? '').slice(0, 5)
                          : String(s[key] ?? ''),
                      );
                    }}
                  >
                    Change
                  </Button>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <ConfirmDialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={def ? `Change: ${def.label}` : ''}
        confirmLabel="Save"
        reasonLabel="Reason (kept in the audit log)"
        pending={save.pending}
        error={save.error}
        onConfirm={(reason) => {
          const v =
            def?.type === 'int'
              ? Number(value)
              : def?.type === 'bool'
                ? value === 'true'
                : def?.type === 'time'
                  ? value.slice(0, 5)
                  : value.trim();
          if (editing) save.run({ key: editing, value: v, reason });
        }}
      >
        {def?.type === 'bool' ? (
          <select
            aria-label="Value"
            className="h-10 w-full rounded-md border px-3"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          >
            <option value="true">On</option>
            <option value="false">Off</option>
          </select>
        ) : (
          <Input
            aria-label="Value"
            type={def?.type === 'time' ? 'time' : def?.type === 'int' ? 'number' : 'text'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        )}
      </ConfirmDialog>
    </div>
  );
}
