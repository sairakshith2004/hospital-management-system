import { DOSAGE_FORMS, ROUTES, STRENGTH_UNITS, type Ingredient } from '@hospitalos/shared';
import { useState } from 'react';
import { Alert } from '../../components/ui/alert';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { FormField } from '../../components/ui/form-field';
import { Input } from '../../components/ui/input';
import { PageHeader } from '../../components/ui/page-header';
import { Select } from '../../components/ui/select';
import { Tabs } from '../../components/ui/tabs';
import { useAction, useApi } from '../../lib/use-api';

/** Add ingredients, medicines (brand + ingredients + strength + form) and general items. */
export function CataloguePage() {
  const [tab, setTab] = useState<'medicine' | 'item' | 'ingredient'>('medicine');
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Catalogue"
        crumbs={[{ label: 'Stock', to: '/inventory/stock' }, { label: 'Catalogue' }]}
        description="One ingredient can have many brands, strengths and forms; each is its own product."
      />
      <Tabs
        label="Add to catalogue"
        value={tab}
        onChange={(v) => {
          setTab(v);
          setNotice(null);
        }}
        tabs={[
          { value: 'medicine', label: 'Medicine' },
          { value: 'item', label: 'General item' },
          { value: 'ingredient', label: 'Ingredient' },
        ]}
      />
      {notice && <Alert tone="success">{notice}</Alert>}
      {tab === 'medicine' && <MedicineForm onDone={setNotice} />}
      {tab === 'item' && <ItemForm onDone={setNotice} />}
      {tab === 'ingredient' && <IngredientForm onDone={setNotice} />}
    </div>
  );
}

function IngredientForm({ onDone }: { onDone(m: string): void }) {
  const [name, setName] = useState('');
  const save = useAction<{ name: string }>('POST', '/api/ingredients', {
    invalidate: ['/api/ingredients'],
    onSuccess: (_r, b) => {
      onDone(`Ingredient "${b.name}" added.`);
      setName('');
    },
  });
  return (
    <Card>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.run({ name });
        }}
      >
        <FormField id="ing-name" label="Ingredient (generic name)" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <Button type="submit" disabled={!name.trim() || save.pending}>
          Add
        </Button>
      </form>
      {save.error && (
        <Alert tone="error" className="mt-2">
          {save.error}
        </Alert>
      )}
    </Card>
  );
}

function MedicineForm({ onDone }: { onDone(m: string): void }) {
  const ingredients = useApi<{ ingredients: Ingredient[] }>('/api/ingredients?q=');
  const [f, setF] = useState({
    sku: '',
    brandName: '',
    manufacturer: '',
    dosageForm: 'tablet',
    route: 'oral',
    packSize: '',
    baseUnit: 'tablet',
    reorderLevel: '0',
    rxOnly: true,
  });
  const [parts, setParts] = useState([{ ingredientId: '', strengthValue: '', strengthUnit: 'mg' }]);
  const save = useAction<object, { item: { name: string } }>('POST', '/api/stock/medicines', {
    invalidate: ['/api/stock'],
    onSuccess: (r) => onDone(`${r.item.name} added to the catalogue.`),
  });
  const ok =
    f.sku && f.brandName && parts.every((p) => p.ingredientId && Number(p.strengthValue) > 0);
  return (
    <Card className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField id="m-sku" label="SKU" required hint="Capital letters, digits, dashes">
          <Input
            value={f.sku}
            onChange={(e) => setF({ ...f, sku: e.target.value.toUpperCase() })}
          />
        </FormField>
        <FormField id="m-brand" label="Brand name" required>
          <Input value={f.brandName} onChange={(e) => setF({ ...f, brandName: e.target.value })} />
        </FormField>
        <FormField id="m-mfr" label="Manufacturer">
          <Input
            value={f.manufacturer}
            onChange={(e) => setF({ ...f, manufacturer: e.target.value })}
          />
        </FormField>
        <FormField id="m-form" label="Dosage form">
          <Select value={f.dosageForm} onChange={(e) => setF({ ...f, dosageForm: e.target.value })}>
            {DOSAGE_FORMS.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </Select>
        </FormField>
        <FormField id="m-route" label="Route">
          <Select value={f.route} onChange={(e) => setF({ ...f, route: e.target.value })}>
            {ROUTES.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </Select>
        </FormField>
        <FormField id="m-pack" label="Pack size">
          <Input
            value={f.packSize}
            onChange={(e) => setF({ ...f, packSize: e.target.value })}
            placeholder="e.g. strip of 10"
          />
        </FormField>
        <FormField id="m-unit" label="Stock unit" required>
          <Input value={f.baseUnit} onChange={(e) => setF({ ...f, baseUnit: e.target.value })} />
        </FormField>
        <FormField id="m-reorder" label="Reorder level">
          <Input
            inputMode="numeric"
            value={f.reorderLevel}
            onChange={(e) => setF({ ...f, reorderLevel: e.target.value })}
          />
        </FormField>
        <label className="flex items-center gap-2 pt-6 text-sm">
          <input
            type="checkbox"
            checked={f.rxOnly}
            onChange={(e) => setF({ ...f, rxOnly: e.target.checked })}
          />{' '}
          Prescription only
        </label>
      </div>
      <h3 className="text-sm font-medium">Ingredients and strength</h3>
      {parts.map((p, i) => (
        <div key={i} className="grid gap-2 sm:grid-cols-[1fr_8rem_8rem_auto]">
          <Select
            aria-label="Ingredient"
            value={p.ingredientId}
            onChange={(e) =>
              setParts(parts.map((x, j) => (j === i ? { ...x, ingredientId: e.target.value } : x)))
            }
          >
            <option value="">Choose ingredient…</option>
            {ingredients.data?.ingredients.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </Select>
          <Input
            aria-label="Strength"
            inputMode="decimal"
            value={p.strengthValue}
            onChange={(e) =>
              setParts(parts.map((x, j) => (j === i ? { ...x, strengthValue: e.target.value } : x)))
            }
          />
          <Select
            aria-label="Unit"
            value={p.strengthUnit}
            onChange={(e) =>
              setParts(parts.map((x, j) => (j === i ? { ...x, strengthUnit: e.target.value } : x)))
            }
          >
            {STRENGTH_UNITS.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </Select>
          <Button
            variant="ghost"
            size="sm"
            disabled={parts.length === 1}
            onClick={() => setParts(parts.filter((_, j) => j !== i))}
          >
            Remove
          </Button>
        </div>
      ))}
      <Button
        variant="secondary"
        size="sm"
        onClick={() =>
          setParts([...parts, { ingredientId: '', strengthValue: '', strengthUnit: 'mg' }])
        }
      >
        Add ingredient
      </Button>
      {save.error && <Alert tone="error">{save.error}</Alert>}
      <div className="flex justify-end">
        <Button
          disabled={!ok || save.pending}
          onClick={() =>
            save.run({
              ...f,
              reorderLevel: Number(f.reorderLevel) || 0,
              ingredients: parts.map((p) => ({
                ingredientId: p.ingredientId,
                strengthValue: Number(p.strengthValue),
                strengthUnit: p.strengthUnit,
              })),
            })
          }
        >
          Add medicine
        </Button>
      </div>
    </Card>
  );
}

function ItemForm({ onDone }: { onDone(m: string): void }) {
  const [f, setF] = useState({
    sku: '',
    name: '',
    category: '',
    baseUnit: 'piece',
    tracksExpiry: false,
    reorderLevel: '0',
  });
  const save = useAction<object, { item: { name: string } }>('POST', '/api/stock/items', {
    invalidate: ['/api/stock'],
    onSuccess: (r) => onDone(`${r.item.name} added to the catalogue.`),
  });
  return (
    <Card className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField id="i-sku" label="SKU" required>
          <Input
            value={f.sku}
            onChange={(e) => setF({ ...f, sku: e.target.value.toUpperCase() })}
          />
        </FormField>
        <FormField id="i-name" label="Name" required>
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </FormField>
        <FormField id="i-cat" label="Category">
          <Input
            value={f.category}
            onChange={(e) => setF({ ...f, category: e.target.value })}
            placeholder="e.g. Consumables"
          />
        </FormField>
        <FormField id="i-unit" label="Stock unit" required>
          <Input value={f.baseUnit} onChange={(e) => setF({ ...f, baseUnit: e.target.value })} />
        </FormField>
        <FormField id="i-reorder" label="Reorder level">
          <Input
            inputMode="numeric"
            value={f.reorderLevel}
            onChange={(e) => setF({ ...f, reorderLevel: e.target.value })}
          />
        </FormField>
        <label className="flex items-center gap-2 pt-6 text-sm">
          <input
            type="checkbox"
            checked={f.tracksExpiry}
            onChange={(e) => setF({ ...f, tracksExpiry: e.target.checked })}
          />{' '}
          Has expiry dates
        </label>
      </div>
      {save.error && <Alert tone="error">{save.error}</Alert>}
      <div className="flex justify-end">
        <Button
          disabled={!f.sku || !f.name || save.pending}
          onClick={() => save.run({ ...f, reorderLevel: Number(f.reorderLevel) || 0 })}
        >
          Add item
        </Button>
      </div>
    </Card>
  );
}
