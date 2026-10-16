import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Timeline, DataSet } from 'vis-timeline/standalone';
import 'vis-timeline/styles/vis-timeline-graph2d.min.css';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import './PocSearch.css';
import './PlanningBoard.css';
import UnitSelect, { useUnits, unitLabel } from './UnitSelect';

const API_URL = 'http://localhost:5000/api';

const authHeaders = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${localStorage.getItem('token')}`,
});

const toDateStr = (d) => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const addDaysToStr = (dateStr, days) => {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return toDateStr(d);
};

// deterministic hash -> hue, so the same brand always renders the same color
const brandHue = (brand) => {
  let hash = 0;
  const str = brand || 'Unknown';
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return Math.abs(hash) % 360;
};

const RED = '#ef4444';
const YELLOW = '#eab308';
const DAY_MS = 86400000;
// Zoom presets for the visible window, in days.
const SPANS = [
  { days: 14, label: '2 weeks' },
  { days: 31, label: '1 month' },
  { days: 92, label: '3 months' },
];
const fmtDay = (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

// HSL -> #rrggbb (native <input type="color"> only accepts hex)
const hslToHex = (h, s, l) => {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x) => Math.round(255 * x).toString(16).padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
};
const defaultBrandHex = (brand) => hslToHex(brandHue(brand), 60, 50);

export default function PlanningBoard() {
  const navigate = useNavigate();
  const containerRef = useRef(null);
  const timelineRef = useRef(null);
  const itemsDsRef = useRef(new DataSet());
  const groupsDsRef = useRef(new DataSet());
  const stripsRef = useRef([]);
  const selectedUnitRef = useRef('');
  const monthRowTrackRef = useRef(null);

  const [monthSegments, setMonthSegments] = useState([]);
  const [monthRowLeftOffset, setMonthRowLeftOffset] = useState(0);
  // Visible window, kept in state for the range label and the horizontal scrollbar.
  const [view, setView] = useState({ start: 0, end: 0 });

  const now0 = new Date();
  const [boardMonth, setBoardMonth] = useState(now0.getMonth() + 1);
  const [boardYear, setBoardYear] = useState(now0.getFullYear());
  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  const [selectedUnit, setSelectedUnit] = useState('');
  const { units: unitList } = useUnits();
  const unitText = unitLabel(unitList.find((u) => String(u.UNIT_ID) === String(selectedUnit))) || (selectedUnit ? `Unit ${selectedUnit}` : '');
  const [lineNumbers, setLineNumbers] = useState([]);
  const [strips, setStrips] = useState([]);
  const [brandColors, setBrandColors] = useState({});
  const [selectedStripId, setSelectedStripId] = useState(null);
  const [holidayDates, setHolidayDates] = useState([]);

  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [showAddForm, setShowAddForm] = useState(false);
  const [orderOptions, setOrderOptions] = useState([]);
  const [newStrip, setNewStrip] = useState({ orderSetupId: '', plannedQty: '', lineNo: '', stripStartDate: '' });

  const [showFreezeForm, setShowFreezeForm] = useState(false);
  const [freezeWindows, setFreezeWindows] = useState([]);
  const [freezeForm, setFreezeForm] = useState({ freezeStartDate: '', freezeEndDate: '' });

  const [showColorPicker, setShowColorPicker] = useState(false);

  // Waiting tray: pick a waiting strip, then click (or drop) on a line + day to place it.
  const [pickedId, setPickedId] = useState(null);
  const [trayFilter, setTrayFilter] = useState('');
  const pickedRef = useRef(null);
  const placeRef = useRef(null);
  useEffect(() => { pickedRef.current = pickedId; }, [pickedId]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setPickedId(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---- load reference data ----
  // (the unit picker comes from the Production Unit master; UnitSelect pre-selects the default unit)
  useEffect(() => {
    loadBrandColors();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadBrandColors = async () => {
    try {
      const res = await fetch(`${API_URL}/brand-color`, { headers: authHeaders() });
      const data = await res.json();
      const map = {};
      data.forEach((r) => { map[r.BRAND] = r.COLOR_HEX; });
      setBrandColors(map);
    } catch (err) {
      // non-fatal
    }
  };

  const loadLineNumbers = async (unit) => {
    if (!unit) { setLineNumbers([]); return; }
    try {
      const res = await fetch(`${API_URL}/line-setup?unit=${unit}`, { headers: authHeaders() });
      const data = await res.json();
      const latest = data.sort((a, b) => (b.EFF_START_DATE || '').localeCompare(a.EFF_START_DATE || ''))[0];
      const n = latest ? Number(latest.NO_OF_LINE) || 0 : 0;
      setLineNumbers(Array.from({ length: n }, (_, i) => i + 1));
    } catch (err) {
      setError('Cannot reach server.');
    }
  };

  const loadStrips = async (unit) => {
    if (!unit) { setStrips([]); return; }
    setError('');
    try {
      const res = await fetch(`${API_URL}/strips?unit=${unit}`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) { setError(data.message || 'Failed to load strips'); return; }
      setStrips(data);
    } catch (err) {
      setError('Cannot reach server.');
    }
  };

  const loadFreezeWindows = async (unit) => {
    if (!unit) { setFreezeWindows([]); return; }
    try {
      const res = await fetch(`${API_URL}/freeze-plan?unit=${unit}`, { headers: authHeaders() });
      const data = await res.json();
      setFreezeWindows(data);
    } catch (err) {
      // non-fatal
    }
  };

  const loadHolidayDates = async (unit) => {
    if (!unit) { setHolidayDates([]); return; }
    try {
      const res = await fetch(`${API_URL}/holiday/days?operationUnit=${unit}`, { headers: authHeaders() });
      const data = await res.json();
      if (res.ok) setHolidayDates(data);
    } catch (err) {
      // non-fatal — board still works without holiday shading
    }
  };

  const loadOrderOptions = async (unit) => {
    if (!unit) { setOrderOptions([]); return; }
    try {
      const res = await fetch(`${API_URL}/sewing-orders`, { headers: authHeaders() });
      const data = await res.json();
      setOrderOptions(data.filter((o) => String(o.UNIT) === String(unit)));
    } catch (err) {
      // non-fatal
    }
  };

  useEffect(() => {
    loadLineNumbers(selectedUnit);
    loadStrips(selectedUnit);
    loadFreezeWindows(selectedUnit);
    loadOrderOptions(selectedUnit);
    loadHolidayDates(selectedUnit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUnit]);

  useEffect(() => { stripsRef.current = strips; }, [strips]);
  useEffect(() => { selectedUnitRef.current = selectedUnit; }, [selectedUnit]);

  // ---- color resolution ----
  const colorForStrip = (s) => {
    if (s.COLOR_OVERRIDE === 'RED') return RED;
    if (s.COLOR_OVERRIDE === 'YELLOW') return YELLOW;
    if (brandColors[s.BRAND]) return brandColors[s.BRAND];
    return defaultBrandHex(s.BRAND);
  };

  // ---- synced third "Month" header row (vis-timeline only natively supports 2 tiers) ----
  const recomputeMonthRow = () => {
    const timeline = timelineRef.current;
    const container = containerRef.current;
    if (!timeline || !container) return;

    const leftPanel = container.querySelector('.vis-panel.vis-left');
    const centerPanel = container.querySelector('.vis-panel.vis-center');
    if (!leftPanel || !centerPanel) return;

    setMonthRowLeftOffset(leftPanel.getBoundingClientRect().width);

    const { start, end } = timeline.getWindow();
    const winStart = start.getTime();
    const winEnd = end.getTime();
    const totalMs = winEnd - winStart;
    if (totalMs <= 0) return;

    const segments = [];
    let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    let guard = 0;
    while (cursor.getTime() < winEnd && guard < 60) {
      guard += 1;
      const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      const segStart = Math.max(cursor.getTime(), winStart);
      const segEnd = Math.min(next.getTime(), winEnd);
      if (segEnd > segStart) {
        segments.push({
          key: `${cursor.getFullYear()}-${cursor.getMonth()}`,
          label: cursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
          leftPct: (segStart - winStart) / totalMs,
          widthPct: (segEnd - segStart) / totalMs,
        });
      }
      cursor = next;
    }
    setMonthSegments(segments);
  };

  const setWindowToMonth = (month, year) => {
    if (!timelineRef.current) return;
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 1); // exclusive end = first of next month
    timelineRef.current.setWindow(start, end, { animation: false });
    setTimeout(recomputeMonthRow, 0);
  };

  // Month/Year pickers jump the board; free scrolling then updates the pickers (see 'rangechanged').
  const goToMonth = (month, year) => {
    setBoardMonth(month);
    setBoardYear(year);
    setWindowToMonth(month, year);
  };

  const changeBoardMonth = (delta) => {
    let m = boardMonth + delta;
    let y = boardYear;
    if (m > 12) { m = 1; y += 1; }
    if (m < 1) { m = 12; y -= 1; }
    goToMonth(m, y);
  };

  // ---- free horizontal navigation ----
  const shiftDays = (days) => {
    const t = timelineRef.current;
    if (!t) return;
    const { start, end } = t.getWindow();
    t.setWindow(start.getTime() + days * DAY_MS, end.getTime() + days * DAY_MS, { animation: { duration: 250 } });
  };

  const goToday = () => {
    const t = timelineRef.current;
    if (!t) return;
    const { start, end } = t.getWindow();
    const half = (end - start) / 2;
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    t.setWindow(today.getTime() - half, today.getTime() + half, { animation: { duration: 250 } });
  };

  const setSpan = (days) => {
    const t = timelineRef.current;
    if (!t) return;
    const { start } = t.getWindow();
    const s = new Date(start);
    s.setHours(0, 0, 0, 0);
    t.setWindow(s, s.getTime() + days * DAY_MS, { animation: false });
  };

  const spanDays = Math.round((view.end - view.start) / DAY_MS);

  // Scrollbar range: all strips plus today, with a margin either side.
  const scrollBounds = useMemo(() => {
    const today = Date.now();
    let min = today, max = today;
    strips.forEach((s) => {
      const a = s.STRIP_START_DATE && new Date(s.STRIP_START_DATE).getTime();
      const b = new Date(s.STRIP_END_DATE || s.STRIP_START_DATE || today).getTime();
      if (a && a < min) min = a;
      if (b > max) max = b;
    });
    return { min: min - 60 * DAY_MS, max: max + 90 * DAY_MS };
  }, [strips]);
  const scrollMin = Math.min(scrollBounds.min, view.start || scrollBounds.min);
  const scrollMax = Math.max(scrollBounds.max, view.end || scrollBounds.max);

  const onScrollbar = (e) => {
    const t = timelineRef.current;
    if (!t) return;
    const start = Number(e.target.value);
    t.setWindow(start, start + (view.end - view.start), { animation: false });
  };

  // ---- build timeline once ----
  useEffect(() => {
    if (!containerRef.current || timelineRef.current) return;

    const options = {
      stack: false,
      orientation: 'top',
      margin: { item: 6 },
      // Free horizontal navigation: drag the background, Shift+wheel / touchpad swipe,
      // or the scrollbar and buttons under the toolbar. Ctrl+wheel zooms between 1 week and 1 year.
      moveable: true,
      zoomable: true,
      zoomKey: 'ctrlKey',
      horizontalScroll: true,
      verticalScroll: true,
      zoomMin: 7 * DAY_MS,
      zoomMax: 366 * DAY_MS,
      showCurrentTime: true,
      // Caps and scrolls just the group/content area while the Month/Week/Day header stays fixed on top —
      // the correct way to bound height in vis-timeline (CSS overflow on the container scrolls the header away too).
      maxHeight: 600,
      editable: { updateTime: true, updateGroup: true, remove: false, add: false, overrideItems: false },
      itemsAlwaysDraggable: { item: true, range: true },
      selectable: true,
      snap: (date) => {
        const snapped = new Date(date);
        snapped.setHours(0, 0, 0, 0);
        return snapped;
      },
      showMajorLabels: true,
      showMinorLabels: true,
      // Every day cell shows its date number with the weekday underneath.
      format: {
        minorLabels: (date, scale) => {
          // one line: vis-timeline sizes the axis for a single text line, a <br> gets clipped
          if (scale === 'day' || scale === 'weekday') return `${date.format('D')} <span class="pb-dow">${date.format('dd')}</span>`;
          if (scale === 'week') return date.format('D MMM');
          if (scale === 'month') return date.format('MMM');
          return date.format('D');
        },
        majorLabels: (date, scale) => {
          if (scale === 'day' || scale === 'weekday' || scale === 'week') return date.format('MMMM YYYY');
          return date.format('YYYY');
        },
      },
      onMove: (item, callback) => {
        if (item.type === 'background') return callback(null);
        const strip = stripsRef.current.find((s) => s.STRIP_ID === item.id);
        if (!strip) return callback(null);

        const newLineNo = Number(item.group) === 0 ? null : Number(item.group);
        const startStr = toDateStr(item.start);
        const endExclusive = new Date(item.end);
        endExclusive.setDate(endExclusive.getDate() - 1);
        let endStr = toDateStr(endExclusive);
        // A resize dragged past the other edge would otherwise save an inverted range.
        if (endStr < startStr) endStr = startStr;

        // A line runs one strip at a time — reject the drop instantly if it overlaps
        // another strip already on that line (server re-checks too, as the source of truth).
        if (newLineNo) {
          const overlaps = stripsRef.current.some(
            (s) => s.STRIP_ID !== item.id && s.LINE_NO === newLineNo
              && s.STRIP_START_DATE <= endStr && (s.STRIP_END_DATE || s.STRIP_START_DATE) >= startStr
          );
          if (overlaps) {
            setError(`Line ${newLineNo} already has a strip in that date range.`);
            return callback(null);
          }
        }

        // Recompute the end date when the line changes (new Working Hour) or the strip is moved
        // to other dates (it may now cover different holidays; qty is allocated only on working days).
        // A same-line resize keeps the planner's custom length.
        const lineChanged = newLineNo !== (strip.LINE_NO ?? null);
        const oldSpan = strip.STRIP_START_DATE && strip.STRIP_END_DATE
          ? Math.round((new Date(strip.STRIP_END_DATE) - new Date(strip.STRIP_START_DATE)) / DAY_MS) : null;
        const newSpan = Math.round((new Date(endStr) - new Date(startStr)) / DAY_MS);
        const moved = oldSpan !== null && newSpan === oldSpan && startStr !== strip.STRIP_START_DATE;

        fetch(`${API_URL}/strips/${item.id}`, {
          method: 'PUT',
          headers: authHeaders(),
          body: JSON.stringify({
            lineNo: newLineNo,
            plannedQty: strip.PLANNED_QTY,
            stripStartDate: startStr,
            stripEndDate: endStr,
            colorOverride: strip.COLOR_OVERRIDE,
          }),
        })
          .then(async (res) => {
            if (!res.ok) {
              const data = await res.json().catch(() => ({}));
              throw new Error(data.message || 'Save failed');
            }
            if ((lineChanged || moved) && newLineNo) {
              const rc = await fetch(`${API_URL}/strips/${item.id}/recompute`, { method: 'POST', headers: authHeaders() });
              // 400 = order has no productivity yet: the strip keeps its length
              if (rc.status === 409) { const d = await rc.json().catch(() => ({})); setError(d.message || 'Working days not defined.'); }
            }
          })
          .then(() => loadStrips(selectedUnitRef.current))
          .catch((err) => {
            setError(err.message || 'Failed to save move.');
            loadStrips(selectedUnitRef.current); // revert the optimistic visual move
          });

        callback(item);
      },
    };

    const timeline = new Timeline(containerRef.current, itemsDsRef.current, groupsDsRef.current, options);
    timeline.on('select', (props) => setSelectedStripId(props.items[0] ?? null));
    // With an order picked from the waiting tray, a click on an empty spot of a line places it there.
    timeline.on('click', (props) => {
      if (!pickedRef.current || props.what === 'item' || props.group == null || !props.time) return;
      placeRef.current(pickedRef.current, Number(props.group), toDateStr(props.time));
    });
    // Keep the month banner, range label and scrollbar in step while the board scrolls.
    let raf = 0;
    timeline.on('rangechange', ({ start, end }) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setView({ start: start.getTime(), end: end.getTime() });
        recomputeMonthRow();
      });
    });
    timeline.on('rangechanged', ({ start, end }) => {
      setView({ start: start.getTime(), end: end.getTime() });
      recomputeMonthRow();
      const mid = new Date((start.getTime() + end.getTime()) / 2);
      setBoardMonth(mid.getMonth() + 1);
      setBoardYear(mid.getFullYear());
    });
    timelineRef.current = timeline;
    setWindowToMonth(boardMonth, boardYear);

    const handleResize = () => recomputeMonthRow();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(raf);
      timeline.destroy();
      timelineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- sync groups ----
  useEffect(() => {
    // vis-timeline sizes its left label column by measuring this content's own rendered
    // width, so the min-width has to live IN the content itself (not as CSS applied
    // afterward) or the column comes out too narrow and clips the text.
    const groupLabel = (text) =>
      `<div style="min-width:90px;white-space:nowrap;">${text}</div>`;
    // Waiting strips live in the tray under the board, not as a timeline row.
    const groups = lineNumbers.map((n) => ({ id: n, content: groupLabel(`Line ${n}`) }));
    groupsDsRef.current.clear();
    groupsDsRef.current.update(groups);
  }, [lineNumbers]);

  // ---- sync items ----
  useEffect(() => {
    const items = strips.filter((s) => s.LINE_NO).map((s) => {
      const color = colorForStrip(s);
      const start = s.STRIP_START_DATE || toDateStr(new Date());
      let end = addDaysToStr(s.STRIP_END_DATE || s.STRIP_START_DATE || toDateStr(new Date()), 1);
      // Guard against an inverted/zero-width range (e.g. a resize dragged past the
      // other edge) — that renders as an invisible-but-hoverable ghost bar otherwise.
      if (end <= start) end = addDaysToStr(start, 1);
      const daysLabel = s.DAYS_NEEDED ? `${s.DAYS_NEEDED}d` : '?d';
      return {
        id: s.STRIP_ID,
        group: s.LINE_NO,
        start,
        end,
        content: `${s.STYLE || ''} · ${s.WASH_NAME || ''}/${s.COLOR || ''} · Qty ${s.PLANNED_QTY} · ${daysLabel}`,
        title: `${s.BUYER_NAME || ''} | ${s.SEASON || ''} | ${s.BPO_NUMBER || 'Unconfirmed'} | ${s.ITEM_DESCRIPTION || ''}\n`
          + `Qty ${s.PLANNED_QTY} | Productivity: ${s.PRODUCTIVITY ?? '—'} pcs/hr | Working Hour at start: ${s.WORKING_HOUR_USED ?? '—'} h\n`
          + `Output/day: ${s.AVG_DAILY_OUTPUT ? `≈ ${s.AVG_DAILY_OUTPUT} pcs` : '—'} | Working days needed: ${s.DAYS_NEEDED ?? 'set Productivity to calculate'}`
          + `${s.BUILD_UP_DAYS ? `\nBuild-up ${s.BUILD_UP_DAYS} day(s): ${s.BUILD_UP} pcs/h` : ''}`
          + `${s.COMBINED_ORDERS > 1 ? `\nJoined strip: ${s.COMBINED_ORDERS} orders (Combine #${s.COMBINE_ID})` : ''}`
          + `${s.ORDER_START_DATE ? `\nOrder start date: ${s.ORDER_START_DATE}` : ''}`,
        editable: { updateTime: !s.IS_FROZEN, updateGroup: !s.IS_FROZEN, remove: false },
        style: `background-color:${color}; border-color:${color}; color:#fff;${s.IS_FROZEN ? ' opacity:0.6;' : ''}`,
      };
    });
    // De-dupe defensively: overlapping/misconfigured holiday plans can report the same
    // calendar date more than once, which would otherwise crash DataSet.add().
    const uniqueHolidayDates = [...new Map(holidayDates.map((h) => [h.CALENDAR_DATE, h])).values()];
    const holidayItems = uniqueHolidayDates.map((h) => ({
      id: `holiday-${h.CALENDAR_DATE}`,
      type: 'background',
      start: h.CALENDAR_DATE,
      end: addDaysToStr(h.CALENDAR_DATE, 1),
      content: '',
      title: h.HOLIDAY_DESCRIPTION || 'Holiday',
      className: 'pb-holiday-bg',
    }));

    itemsDsRef.current.clear();
    itemsDsRef.current.update([...holidayItems, ...items]);
    // No auto-fit-to-data: reloading strips must not jump the board away from where the planner scrolled.
    setTimeout(recomputeMonthRow, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strips, brandColors, holidayDates]);

  // ---- waiting tray: place / unplace ----
  const placeStrip = async (stripId, lineNo, startStr) => {
    const s = stripsRef.current.find((x) => x.STRIP_ID === stripId);
    if (!s || !lineNo || !startStr) return;
    setError(''); setMessage('');
    // keep the strip's planned length; the server recompute below refines it from productivity + working hours
    const span = s.STRIP_START_DATE && s.STRIP_END_DATE
      ? Math.max(0, Math.round((new Date(s.STRIP_END_DATE) - new Date(s.STRIP_START_DATE)) / DAY_MS))
      : Math.max(0, (Number(s.DAYS_NEEDED) || 1) - 1);
    const endStr = addDaysToStr(startStr, span);

    const clash = stripsRef.current.find(
      (o) => o.STRIP_ID !== stripId && o.LINE_NO === lineNo
        && o.STRIP_START_DATE <= endStr && (o.STRIP_END_DATE || o.STRIP_START_DATE) >= startStr
    );
    if (clash) { setError(`Line ${lineNo} already has ${clash.STYLE || 'a strip'} from ${clash.STRIP_START_DATE} to ${clash.STRIP_END_DATE}. Pick a free date.`); return; }
    const frozen = freezeWindows.find((f) => String(f.FREEZE_START_DATE).slice(0, 10) <= endStr && String(f.FREEZE_END_DATE).slice(0, 10) >= startStr);
    if (frozen) { setError(`${startStr} – ${endStr} falls in a frozen window (${frozen.FREEZE_START_DATE} → ${frozen.FREEZE_END_DATE}).`); return; }

    try {
      const res = await fetch(`${API_URL}/strips/${stripId}`, {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ lineNo, plannedQty: s.PLANNED_QTY, stripStartDate: startStr, stripEndDate: endStr, colorOverride: s.COLOR_OVERRIDE }),
      });
      const put = await res.json().catch(() => ({}));
      if (!res.ok) { setError(put.message || 'Could not place the strip.'); return; }
      // length from productivity, counting working days only; an order without productivity keeps the length above
      let start = put.stripStartDate || startStr;
      const rc = await fetch(`${API_URL}/strips/${stripId}/recompute`, { method: 'POST', headers: authHeaders() }).catch(() => null);
      const rcData = rc ? await rc.json().catch(() => ({})) : {};
      if (rc && rc.ok && rcData.stripStartDate) start = rcData.stripStartDate;
      setPickedId(null);
      if (rc && rc.status === 409) setError(rcData.message);
      setMessage(`Placed ${s.STYLE || 'strip'} ${s.COLOR ? `(${s.COLOR}) ` : ''}on Line ${lineNo} from ${start}`
        + `${start !== startStr ? ` (${startStr} is a holiday, moved to the next working day)` : ''}.`
        + `${rcData.replanMessage ? ` ${rcData.replanMessage}` : ''}`);
      loadStrips(selectedUnitRef.current);
    } catch (err) { setError('Cannot reach server.'); }
  };
  placeRef.current = placeStrip;

  const sendToWaiting = async () => {
    const s = strips.find((x) => x.STRIP_ID === selectedStripId);
    if (!s) return;
    if (s.IS_FROZEN) { setError('This strip is in a frozen window and cannot be moved.'); return; }
    setError('');
    const res = await fetch(`${API_URL}/strips/${s.STRIP_ID}`, {
      method: 'PUT', headers: authHeaders(),
      body: JSON.stringify({ lineNo: null, plannedQty: s.PLANNED_QTY, stripStartDate: s.STRIP_START_DATE, stripEndDate: s.STRIP_END_DATE, colorOverride: s.COLOR_OVERRIDE }),
    }).catch(() => null);
    if (!res || !res.ok) { setError('Could not move the strip to Waiting.'); return; }
    setSelectedStripId(null);
    setMessage(`${s.STYLE || 'Strip'} moved back to Waiting.`);
    loadStrips(selectedUnit);
  };

  // Drop a tray card onto the board: the drop point gives the line and the start day.
  // vis-timeline's own drop handler stops propagation, so this listens natively in the capture phase.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const onDragOver = (e) => { if (pickedRef.current) e.preventDefault(); };
    const onDrop = (e) => {
      const id = Number(e.dataTransfer.getData('text/plain')) || pickedRef.current;
      const t = timelineRef.current;
      if (!id || !t) return;
      e.preventDefault();
      e.stopPropagation();
      const p = t.getEventProperties(e);
      if (p.group == null || !p.time) { setError('Drop the order on a line row.'); return; }
      placeRef.current(id, Number(p.group), toDateStr(p.time));
    };
    el.addEventListener('dragover', onDragOver, true);
    el.addEventListener('drop', onDrop, true);
    return () => {
      el.removeEventListener('dragover', onDragOver, true);
      el.removeEventListener('drop', onDrop, true);
    };
  }, []);

  const waiting = useMemo(() => {
    const f = trayFilter.trim().toLowerCase();
    return strips
      .filter((s) => !s.LINE_NO)
      .filter((s) => !f || [s.STYLE, s.COLOR, s.WASH_NAME, s.BUYER_NAME, s.BPO_NUMBER, s.SEASON, s.BRAND, s.ORDER_SETUP_ID]
        .some((v) => String(v ?? '').toLowerCase().includes(f)))
      .sort((a, b) => String(a.SHIP_DATE || a.STRIP_START_DATE || '9').localeCompare(String(b.SHIP_DATE || b.STRIP_START_DATE || '9')));
  }, [strips, trayFilter]);
  const waitingTotal = strips.filter((s) => !s.LINE_NO).length;
  const picked = strips.find((s) => s.STRIP_ID === pickedId);

  // ---- toolbar actions ----
  const handlePopulate = async () => {
    if (!selectedUnit) return;
    setError(''); setMessage('');
    try {
      const res = await fetch(`${API_URL}/strips/populate`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ unit: selectedUnit }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || 'Failed'); return; }
      const skipped = [
        data.skippedNoProductivity ? `${data.skippedNoProductivity} without productivity` : '',
        data.skippedNoStartDate ? `${data.skippedNoStartDate} without a sewing start date` : '',
      ].filter(Boolean).join(', ');
      setMessage(`Created ${data.created} strip(s) in the waiting block`
        + `${data.combinedStrips ? ` (${data.combinedStrips} from joined orders)` : ''}.`
        + `${skipped ? ` Skipped orders ${skipped}: complete them in Order Setup.` : ''}`);
      loadStrips(selectedUnit);
    } catch (err) { setError('Cannot reach server.'); }
  };

  const handleDeleteSelected = async () => {
    if (!selectedStripId) return;
    setError('');
    try {
      await fetch(`${API_URL}/strips/${selectedStripId}`, { method: 'DELETE', headers: authHeaders() });
      setSelectedStripId(null);
      loadStrips(selectedUnit);
    } catch (err) { setError('Cannot reach server.'); }
  };

  const openAddForm = () => {
    setShowAddForm((s) => !s);
    if (orderOptions.length) setNewStrip((n) => ({ ...n, orderSetupId: orderOptions[0].ORDER_SETUP_ID }));
  };

  const handleAddStrip = async () => {
    setError('');
    try {
      const res = await fetch(`${API_URL}/strips`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ ...newStrip, unit: selectedUnit, lineNo: newStrip.lineNo || null }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || 'Add failed'); return; }
      setShowAddForm(false);
      setNewStrip({ orderSetupId: '', plannedQty: '', lineNo: '', stripStartDate: '' });
      loadStrips(selectedUnit);
    } catch (err) { setError('Cannot reach server.'); }
  };

  const handleAddFreeze = async () => {
    setError('');
    try {
      const res = await fetch(`${API_URL}/freeze-plan`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ unit: selectedUnit, ...freezeForm }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || 'Failed'); return; }
      setFreezeForm({ freezeStartDate: '', freezeEndDate: '' });
      loadFreezeWindows(selectedUnit);
      loadStrips(selectedUnit);
    } catch (err) { setError('Cannot reach server.'); }
  };

  const handleDeleteFreeze = async (id) => {
    await fetch(`${API_URL}/freeze-plan/${id}`, { method: 'DELETE', headers: authHeaders() });
    loadFreezeWindows(selectedUnit);
    loadStrips(selectedUnit);
  };

  const handleSetOverride = async (value) => {
    if (!selectedStripId) return;
    const strip = strips.find((s) => s.STRIP_ID === selectedStripId);
    if (!strip) return;
    await fetch(`${API_URL}/strips/${selectedStripId}`, {
      method: 'PUT', headers: authHeaders(),
      body: JSON.stringify({
        lineNo: strip.LINE_NO, plannedQty: strip.PLANNED_QTY,
        stripStartDate: strip.STRIP_START_DATE, stripEndDate: strip.STRIP_END_DATE,
        colorOverride: value,
      }),
    });
    loadStrips(selectedUnit);
  };

  const distinctBrands = [...new Set(strips.map((s) => s.BRAND).filter(Boolean))];

  const handleBrandColorChange = async (brand, hex) => {
    setBrandColors((prev) => ({ ...prev, [brand]: hex }));
    await fetch(`${API_URL}/brand-color`, {
      method: 'PUT', headers: authHeaders(), body: JSON.stringify({ brand, colorHex: hex }),
    });
  };

  const exportExcel = () => {
    const rows = strips.map((s) => ({
      Line: s.LINE_NO ?? 'Waiting', Order: s.ORDER_SETUP_ID, Bpo: s.BPO_NUMBER || '',
      Buyer: s.BUYER_NAME || '', Season: s.SEASON || '', Style: s.STYLE || '', Color: s.COLOR || '',
      Wash: s.WASH_NAME || '', Qty: s.PLANNED_QTY, Start: s.STRIP_START_DATE || '', End: s.STRIP_END_DATE || '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Strips');
    XLSX.writeFile(wb, `PlanningBoard_Unit${selectedUnit}.xlsx`);
  };

  const exportPdf = () => {
    const doc = new jsPDF({ orientation: 'landscape' });
    doc.text(`Planning Board - ${unitText}`, 14, 12);
    autoTable(doc, {
      startY: 18,
      styles: { fontSize: 7 },
      head: [['Line', 'Order', 'Bpo', 'Buyer', 'Season', 'Style', 'Color', 'Wash', 'Qty', 'Start', 'End']],
      body: strips.map((s) => [
        s.LINE_NO ?? 'Waiting', s.ORDER_SETUP_ID, s.BPO_NUMBER || '', s.BUYER_NAME || '', s.SEASON || '',
        s.STYLE || '', s.COLOR || '', s.WASH_NAME || '', s.PLANNED_QTY, s.STRIP_START_DATE || '', s.STRIP_END_DATE || '',
      ]),
    });
    doc.save(`PlanningBoard_Unit${selectedUnit}.pdf`);
  };

  return (
    <div className="pb-page">
      <div className="pb-header">
        <div>
          <h1>Stitching Planning Board</h1>
          <div className="pb-header-subtitle">NexPlanning · {unitText || '—'}</div>
        </div>
        <div className="pb-header-stats">
          <span><b>{strips.filter((s) => s.LINE_NO).length}</b> planned</span>
          <span><b>{strips.filter((s) => !s.LINE_NO).length}</b> waiting</span>
          <span><b>{lineNumbers.length}</b> lines</span>
        </div>
      </div>

      <div className="pb-toolbar">
        <div className="pb-group">
          <div className="field">
            <label>Production Unit</label>
            <UnitSelect value={selectedUnit} onChange={setSelectedUnit} />
          </div>
          <div className="field">
            <label>Month</label>
            <select value={boardMonth} onChange={(e) => goToMonth(Number(e.target.value), boardYear)}>
              {MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Year</label>
            <input
              type="number"
              value={boardYear}
              onChange={(e) => { const y = Number(e.target.value); if (y > 1900 && y < 3000) goToMonth(boardMonth, y); else setBoardYear(y); }}
              style={{ width: '80px' }}
            />
          </div>
        </div>

        <div className="pb-group">
          <button type="button" className="save-btn" onClick={handlePopulate}>Populate Strips</button>
          <button type="button" className="regen-btn" onClick={openAddForm}>Add</button>
          <button type="button" className="edit-btn" onClick={() => loadStrips(selectedUnit)}>Save</button>
          <button type="button" className="remove-btn-text" onClick={handleDeleteSelected} disabled={!selectedStripId}>Delete Selected</button>
        </div>

        <div className="pb-group">
          <button type="button" className="regen-btn" onClick={() => setShowFreezeForm((s) => !s)}>Freeze Plan</button>
          <button type="button" className="regen-btn" onClick={() => setShowColorPicker((s) => !s)}>Color Picker</button>
          <button type="button" className="regen-btn" onClick={() => navigate('/line-master')}>Update Line</button>
          <button type="button" className="regen-btn" onClick={() => navigate('/line-master')}>Line Setup</button>
        </div>

        <div className="pb-group">
          <button type="button" className="edit-btn" onClick={exportExcel}>Export Excel</button>
          <button type="button" className="edit-btn" onClick={exportPdf}>Export PDF</button>
        </div>
      </div>

      <div className="pb-body">

      {error && <div className="search-error">{error}</div>}
      {message && <div className="poc-success">{message}</div>}

      {selectedStripId && (
        <div className="pb-inline-form">
          <span>Strip #{selectedStripId} color:</span>
          <button type="button" className="edit-btn" onClick={() => handleSetOverride(null)}>Brand color</button>
          <button type="button" style={{ background: YELLOW, color: '#000', border: 'none', padding: '0.4rem 0.8rem', borderRadius: 6, cursor: 'pointer' }} onClick={() => handleSetOverride('YELLOW')}>Yellow (T&A risk)</button>
          <button type="button" style={{ background: RED, color: '#fff', border: 'none', padding: '0.4rem 0.8rem', borderRadius: 6, cursor: 'pointer' }} onClick={() => handleSetOverride('RED')}>Red (T&A late)</button>
          {strips.some((s) => s.STRIP_ID === selectedStripId && s.LINE_NO) && (
            <button type="button" className="edit-btn" onClick={sendToWaiting}>Send to Waiting ↓</button>
          )}
        </div>
      )}

      {picked && (
        <div className="pb-pick-banner" role="status">
          <span><b>Placing:</b> {picked.STYLE} {picked.COLOR ? `· ${picked.COLOR}` : ''} · Qty {picked.PLANNED_QTY}</span>
          <span>Click a line on the start day (or drag the card onto the board). Esc to cancel.</span>
          <button type="button" onClick={() => setPickedId(null)}>Cancel</button>
        </div>
      )}

      {showAddForm && (
        <div className="pb-inline-form">
          <div className="field">
            <label>Order</label>
            <select value={newStrip.orderSetupId} onChange={(e) => setNewStrip((n) => ({ ...n, orderSetupId: e.target.value }))}>
              {orderOptions.map((o) => (
                <option key={o.ORDER_SETUP_ID} value={o.ORDER_SETUP_ID}>
                  #{o.ORDER_SETUP_ID} {o.STYLE} — {o.WASH_NAME}/{o.COLOR} (Qty {o.ORDER_QTY})
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Planned Qty</label>
            <input type="number" value={newStrip.plannedQty} onChange={(e) => setNewStrip((n) => ({ ...n, plannedQty: e.target.value }))} />
          </div>
          <div className="field">
            <label>Line (optional)</label>
            <select value={newStrip.lineNo} onChange={(e) => setNewStrip((n) => ({ ...n, lineNo: e.target.value }))}>
              <option value="">Waiting</option>
              {lineNumbers.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Start Date</label>
            <input type="date" value={newStrip.stripStartDate} onChange={(e) => setNewStrip((n) => ({ ...n, stripStartDate: e.target.value }))} />
          </div>
          <button type="button" className="save-btn" onClick={handleAddStrip}>Add Strip</button>
          <button type="button" className="remove-btn-text" onClick={() => setShowAddForm(false)}>Cancel</button>
        </div>
      )}

      {showFreezeForm && (
        <div className="pb-inline-form pb-freeze-form">
          <div className="field">
            <label>Freeze Start</label>
            <input type="date" value={freezeForm.freezeStartDate} onChange={(e) => setFreezeForm((f) => ({ ...f, freezeStartDate: e.target.value }))} />
          </div>
          <div className="field">
            <label>Freeze End</label>
            <input type="date" value={freezeForm.freezeEndDate} onChange={(e) => setFreezeForm((f) => ({ ...f, freezeEndDate: e.target.value }))} />
          </div>
          <button type="button" className="save-btn" onClick={handleAddFreeze}>Add Freeze Window</button>
          <div className="pb-freeze-list">
            {freezeWindows.map((f) => (
              <span key={f.FREEZE_ID} className="pb-freeze-chip">
                {f.FREEZE_START_DATE} → {f.FREEZE_END_DATE}
                <button type="button" onClick={() => handleDeleteFreeze(f.FREEZE_ID)}>&times;</button>
              </span>
            ))}
          </div>
        </div>
      )}

      {showColorPicker && (
        <div className="pb-inline-form pb-color-form">
          {distinctBrands.length === 0 && <span className="no-results">No brands loaded yet</span>}
          {distinctBrands.map((brand) => (
            <label key={brand} className="pb-color-row">
              {brand}
              <input
                type="color"
                value={brandColors[brand] || defaultBrandHex(brand)}
                onChange={(e) => handleBrandColorChange(brand, e.target.value)}
              />
            </label>
          ))}
        </div>
      )}

      <div className="pb-nav">
        <div className="pb-nav-buttons">
          <button type="button" onClick={() => changeBoardMonth(-1)} title="Previous month">«</button>
          <button type="button" onClick={() => shiftDays(-7)} title="Back 1 week">‹ Week</button>
          <button type="button" className="pb-today-btn" onClick={goToday}>Today</button>
          <button type="button" onClick={() => shiftDays(7)} title="Forward 1 week">Week ›</button>
          <button type="button" onClick={() => changeBoardMonth(1)} title="Next month">»</button>
        </div>
        <div className="pb-nav-range">
          {view.end > view.start && <>{fmtDay(new Date(view.start))} – {fmtDay(new Date(view.end - 1))}</>}
        </div>
        <div className="pb-nav-zoom" role="group" aria-label="Zoom">
          {SPANS.map((s) => (
            <button
              key={s.days}
              type="button"
              aria-pressed={Math.abs(spanDays - s.days) <= 2}
              onClick={() => setSpan(s.days)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="pb-month-row">
        <div className="pb-month-row-spacer" style={{ width: monthRowLeftOffset }} />
        <div className="pb-month-row-track" ref={monthRowTrackRef}>
          {monthSegments.map((seg) => (
            <div
              key={seg.key}
              className="pb-month-cell"
              style={{ left: `${seg.leftPct * 100}%`, width: `${seg.widthPct * 100}%` }}
            >
              {seg.label}
            </div>
          ))}
        </div>
      </div>
      <div
        ref={containerRef}
        className={`pb-timeline${picked ? ' pb-picking' : ''}`}
      />

      <div className="pb-scroll" style={{ paddingLeft: monthRowLeftOffset }}>
        <input
          type="range"
          aria-label="Scroll the board left or right"
          min={scrollMin}
          max={Math.max(scrollMin, scrollMax - (view.end - view.start))}
          step={DAY_MS}
          value={view.start || scrollMin}
          onChange={onScrollbar}
        />
      </div>

      <section className="pb-tray" aria-label="Waiting orders">
        <div className="pb-tray-head">
          <h2>Waiting orders <span>{waiting.length}{waiting.length !== waitingTotal ? ` of ${waitingTotal}` : ''}</span></h2>
          <input
            type="search"
            placeholder="Search style, colour, buyer, BPO…"
            value={trayFilter}
            onChange={(e) => setTrayFilter(e.target.value)}
          />
        </div>
        {waitingTotal === 0 ? (
          <div className="pb-tray-empty">No waiting orders. Use <b>Populate Strips</b> to bring orders of this unit here.</div>
        ) : waiting.length === 0 ? (
          <div className="pb-tray-empty">No waiting order matches “{trayFilter}”.</div>
        ) : (
          <div className="pb-tray-cards">
            {waiting.map((s) => {
              const color = colorForStrip(s);
              const isPicked = s.STRIP_ID === pickedId;
              return (
                <button
                  key={s.STRIP_ID}
                  type="button"
                  className={`pb-card${isPicked ? ' is-picked' : ''}`}
                  style={{ '--card': color }}
                  draggable
                  onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(s.STRIP_ID)); e.dataTransfer.effectAllowed = 'move'; setPickedId(s.STRIP_ID); }}
                  onClick={() => setPickedId(isPicked ? null : s.STRIP_ID)}
                  aria-pressed={isPicked}
                  title={`${s.BUYER_NAME || ''} | ${s.SEASON || ''} | ${s.ITEM_DESCRIPTION || ''} | Order #${s.ORDER_SETUP_ID}`}
                >
                  <span className="pb-card-style">{s.STYLE || '—'}</span>
                  <span className="pb-card-sub">{[s.COLOR, s.WASH_NAME].filter(Boolean).join(' · ') || '—'}</span>
                  <span className="pb-card-sub">{s.BUYER_NAME || s.BRAND || ''}</span>
                  <span className="pb-card-bpo">{s.BPO_NUMBER || 'Projection'}</span>
                  <span className="pb-card-nums">
                    <b>{Number(s.PLANNED_QTY).toLocaleString()}</b> pcs · {s.DAYS_NEEDED ? `${s.DAYS_NEEDED}d` : '?d'}
                  </span>
                  <span className="pb-card-ship">Ship {s.SHIP_DATE || '—'}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <div className="pb-legend">
        <span><i className="pb-lg-today" />Today</span>
        <span><i className="pb-lg-holiday" />Holiday</span>
        <span><i className="pb-lg-frozen" />Frozen strip</span>
        <span><i style={{ background: YELLOW }} />T&amp;A risk</span>
        <span><i style={{ background: RED }} />T&amp;A late</span>
        <span className="pb-legend-hint">Drag the board or use Shift + mouse wheel to scroll · Ctrl + wheel to zoom</span>
      </div>
      </div>
    </div>
  );
}
