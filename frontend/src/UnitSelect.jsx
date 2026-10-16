import { useEffect, useState } from 'react';

const API_URL = 'http://localhost:5000/api';

// Used only when the unit list cannot be loaded (backend not reachable / not updated yet),
// so screens keep working on the standard unit instead of showing an empty dropdown.
const FALLBACK_UNITS = [{ UNIT_ID: 341, UNIT_CODE: 'AMS', UNIT_NAME: 'AMS', IS_DEFAULT: 'Y', ACTIVE: 'Y', _fallback: true }];

// One shared fetch of the Production Unit LOV; the setup screen calls reloadUnits() after a change.
let unitsPromise = null;
const listeners = new Set();

const fetchUnits = () => {
  if (!unitsPromise) {
    unitsPromise = fetch(`${API_URL}/production-units`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    })
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => [])
      .then((rows) => (Array.isArray(rows) && rows.length ? rows : FALLBACK_UNITS));
    // let a later call retry if the request failed
    unitsPromise.then((rows) => { if (rows === FALLBACK_UNITS) unitsPromise = null; });
  }
  return unitsPromise;
};

export const reloadUnits = () => {
  unitsPromise = null;
  fetchUnits().then((rows) => listeners.forEach((fn) => fn(rows)));
};

export const unitLabel = (u) => (u ? `${u.UNIT_CODE} (${u.UNIT_ID})` : '');

// { units, defaultUnit, loaded }
export function useUnits() {
  const [units, setUnits] = useState([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    const set = (rows) => { if (alive) { setUnits(rows); setLoaded(true); } };
    fetchUnits().then(set);
    listeners.add(set);
    return () => { alive = false; listeners.delete(set); };
  }, []);
  return { units, defaultUnit: units.find((u) => u.IS_DEFAULT === 'Y') || units[0] || null, loaded };
}

/**
 * Production Unit dropdown used wherever a unit is entered or filtered.
 * value / onChange work with the unit id as a string (e.g. "341").
 * - autoDefault: when value is empty, pick the default unit (AMS) once the list arrives.
 * - allowAll: show an extra "all units" option with value "" (filters); disables autoDefault.
 * - allowBlank: show an empty option (optional fields).
 * A stored value that is not (or no longer) in the list is still shown, so old records keep their unit.
 */
export default function UnitSelect({
  value, onChange, allowAll, allowBlank, autoDefault = true, id, className, style, disabled, name, required,
}) {
  const { units, defaultUnit, loaded } = useUnits();
  const current = value === null || value === undefined ? '' : String(value);

  useEffect(() => {
    if (autoDefault && !allowAll && !allowBlank && loaded && !current && defaultUnit) onChange(String(defaultUnit.UNIT_ID));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, current, defaultUnit, autoDefault, allowAll, allowBlank]);

  const known = units.some((u) => String(u.UNIT_ID) === current);

  return (
    <select
      id={id}
      name={name}
      className={className}
      style={style}
      disabled={disabled}
      required={required}
      value={current}
      onChange={(e) => onChange(e.target.value)}
    >
      {allowAll && <option value="">{allowAll === true ? 'All units' : allowAll}</option>}
      {allowBlank && <option value="">—</option>}
      {!loaded && !current && !allowAll && !allowBlank && <option value="">Loading…</option>}
      {current && !known && <option value={current}>{current}{loaded ? ' (not in unit list)' : ''}</option>}
      {units.map((u) => (
        <option key={u.UNIT_ID} value={String(u.UNIT_ID)} title={u.UNIT_NAME || ''}>
          {unitLabel(u)}{u.UNIT_NAME && u.UNIT_NAME !== u.UNIT_CODE ? ` · ${u.UNIT_NAME}` : ''}
        </option>
      ))}
    </select>
  );
}
