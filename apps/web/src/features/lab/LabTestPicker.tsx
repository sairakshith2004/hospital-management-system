import type { LabTestView } from '@hospitalos/shared';
import { useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { matchesLabTest } from './lab-test-search';

/** One order holds at most 20 tests (createLabOrderSchema). */
const MAX_TESTS = 20;

/**
 * The doctor's lab test chooser: tests of the doctor's own department first, then general
 * tests every department uses. Other departments' tests appear when searching or on request.
 */
export function LabTestPicker({
  tests,
  departmentId,
  selected,
  onChange,
}: {
  tests: LabTestView[];
  departmentId: string | null;
  selected: string[];
  onChange(ids: string[]): void;
}) {
  const [search, setSearch] = useState('');
  const [showOthers, setShowOthers] = useState(false);
  const visible = tests.filter(
    (t) => t.active && (selected.includes(t.id) || matchesLabTest(t, search)),
  );
  const own = visible.filter((t) => departmentId && t.department?.id === departmentId);
  const general = visible.filter((t) => !t.department);
  const others = visible.filter((t) => t.department && t.department.id !== departmentId);
  const othersShown = showOthers || search.trim() !== '';
  const othersHiddenSelected = others.filter((t) => selected.includes(t.id));

  const group = (title: string, list: LabTestView[], label: (t: LabTestView) => string) =>
    list.length > 0 && (
      <div className="space-y-1">
        <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase">
          {title} ({list.length})
        </h3>
        <div className="flex flex-wrap gap-2">
          {list.map((t) => (
            <label
              key={t.id}
              className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1 text-sm dark:border-slate-700"
            >
              <input
                type="checkbox"
                checked={selected.includes(t.id)}
                disabled={!selected.includes(t.id) && selected.length >= MAX_TESTS}
                onChange={(ev) =>
                  onChange(
                    ev.target.checked ? [...selected, t.id] : selected.filter((x) => x !== t.id),
                  )
                }
              />
              {label(t)}
            </label>
          ))}
        </div>
      </div>
    );

  if (tests.length === 0)
    return <p className="text-sm text-slate-600">No lab tests are set up yet.</p>;
  return (
    <div className="space-y-2">
      <Input
        type="search"
        aria-label="Search lab tests"
        placeholder="Search all tests by name, code or sample"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="max-h-72 space-y-3 overflow-y-auto">
        {group(
          own[0]?.department ? `${own[0].department.name} tests` : 'Your department',
          own,
          (t) => t.name,
        )}
        {group('General tests', general, (t) => t.name)}
        {othersShown
          ? group('Other departments', others, (t) => `${t.name} · ${t.department!.name}`)
          : group('Other departments (selected)', othersHiddenSelected, (t) => t.name)}
        {visible.length === 0 && (
          <p className="text-sm text-slate-600">No tests match “{search}”.</p>
        )}
      </div>
      {!othersShown && others.length > othersHiddenSelected.length && (
        <Button size="sm" variant="ghost" onClick={() => setShowOthers(true)}>
          Show other departments' tests ({others.length - othersHiddenSelected.length})
        </Button>
      )}
    </div>
  );
}
