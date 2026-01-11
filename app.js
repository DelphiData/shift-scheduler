// ---------- Helpers ----------
function parseTime(t) {
  const [h, m] = t.split(":").map(Number);
  return { h, m };
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function toICSDateTime(d) {
  // Floating local time (no timezone)
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
}

function buildEvent({ title, start, end }) {
  return { title, start, end };
}

// Rotation model:
// - Weekly rotation across `people`
// - Hospital = people[w % n]
// - ODC     = people[(w + 1) % n]
// - OFF     = people[(w + 2) % n]   (for n=3; generalized for n>=3)
//
// Lane rule:
// - Lane replaces the ODC block on lane weeks
// - The would-be ODC person becomes OFF on those weeks
// - Optionally keep normal OFF as OFF too (can create 2 OFF blocks)

// ---------- Generator ----------
function generateSchedule(params) {
  const {
    startDate,
    years,
    rotationOrder,

    hospStartTime,
    hospEndTime,

    odcStartTime,
    odcEndTime,

    lanePatternWeeks,
    laneStartTime,
    laneEndTime,

    showOff,
    doubleOffOnLaneWeeks,

    weekendStartTime,
    weekendEndTime,
    laneWeekendEvery
  } = params;

  const shifts = [];
  const start = new Date(startDate);

  const totalDays = Math.floor(years * 365.25);
  const end = addDays(start, totalDays);

  const people = rotationOrder;
  const n = people.length;

  if (n < 3) {
    throw new Error("Rotation order must include at least 3 people (Hospital / ODC / OFF).");
  }

  const weeksTotal = Math.ceil(totalDays / 7);

  const hospitalForWeek = (w) => people[w % n];
  const odcForWeek = (w) => people[(w + 1) % n];
  const offForWeek = (w) => people[(w + 2) % n];

  const isLaneWeek = (w) => (w % lanePatternWeeks) === 0;
  const isLaneWeekend = (w) => (w % laneWeekendEvery) === 0;

  for (let week = 0; week < weeksTotal; week++) {
    const weekStart = addDays(start, week * 7);

    const hospPerson = hospitalForWeek(week);
    const odcPerson = odcForWeek(week);
    const offPerson = offForWeek(week);

    const laneWeek = isLaneWeek(week);

    // --- Weekday shifts (Mon-Fri) ---
    for (let day = 0; day < 5; day++) {
      const date = addDays(weekStart, day);
      if (date > end) break;

      // Hospital (always)
      {
        const st = new Date(date);
        const et = new Date(date);
        const hs = parseTime(hospStartTime);
        const he = parseTime(hospEndTime);
        st.setHours(hs.h, hs.m, 0, 0);
        et.setHours(he.h, he.m, 0, 0);

        shifts.push(buildEvent({
          title: `HOSPITAL ${hospPerson}`,
          start: st,
          end: et
        }));
      }

      // ODC / Lane logic
      if (laneWeek) {
        // Lane takes ODC slot
        const st = new Date(date);
        const et = new Date(date);
        const ls = parseTime(laneStartTime);
        const le = parseTime(laneEndTime);
        st.setHours(ls.h, ls.m, 0, 0);
        et.setHours(le.h, le.m, 0, 0);

        shifts.push(buildEvent({
          title: `ODC Lane`,
          start: st,
          end: et
        }));

        // Would-be ODC person is OFF (weekday block)
        if (showOff) {
          const ost = new Date(date);
          const oet = new Date(date);
          const os = parseTime(odcStartTime);
          const oe = parseTime(odcEndTime);
          ost.setHours(os.h, os.m, 0, 0);
          oet.setHours(oe.h, oe.m, 0, 0);

          shifts.push(buildEvent({
            title: `OFF ${odcPerson}`,
            start: ost,
            end: oet
          }));
        }

        // Optionally: keep the normal OFF person off too
        if (showOff && doubleOffOnLaneWeeks) {
          const ost = new Date(date);
          const oet = new Date(date);
          const os = parseTime(odcStartTime);
          const oe = parseTime(odcEndTime);
          ost.setHours(os.h, os.m, 0, 0);
          oet.setHours(oe.h, oe.m, 0, 0);

          shifts.push(buildEvent({
            title: `OFF ${offPerson}`,
            start: ost,
            end: oet
          }));
        }
      } else {
        // Normal ODC person works
        const st = new Date(date);
        const et = new Date(date);
        const os = parseTime(odcStartTime);
        const oe = parseTime(odcEndTime);
        st.setHours(os.h, os.m, 0, 0);
        et.setHours(oe.h, oe.m, 0, 0);

        shifts.push(buildEvent({
          title: `ODC ${odcPerson}`,
          start: st,
          end: et
        }));

        // Normal OFF person
        if (showOff) {
          const ost = new Date(date);
          const oet = new Date(date);
          ost.setHours(os.h, os.m, 0, 0);
          oet.setHours(oe.h, oe.m, 0, 0);

          shifts.push(buildEvent({
            title: `OFF ${offPerson}`,
            start: ost,
            end: oet
          }));
        }
      }
    }

    // --- Weekend (Sat 6am -> Sun 11:59pm) ---
    const sat = addDays(weekStart, 5);
    const sun = addDays(weekStart, 6);

    if (sat <= end) {
      const st = new Date(sat);
      const et = new Date(sun);

      const ws = parseTime(weekendStartTime);
      const we = parseTime(weekendEndTime);

      st.setHours(ws.h, ws.m, 0, 0);
      et.setHours(we.h, we.m, 0, 0);

      const weekendTitle = isLaneWeekend(week)
        ? "Weekend Lane"
        : `Weekend ${hospPerson}`;

      shifts.push(buildEvent({
        title: weekendTitle,
        start: st,
        end: et
      }));
    }
  }

  return shifts.sort((a, b) => a.start - b.start);
}

// ---------- iCal Export ----------
function exportICS(events) {
  const lines = [];
  lines.push("BEGIN:VCALENDAR");
  lines.push("VERSION:2.0");
  lines.push("PRODID:-//ShiftScheduler//EN");

  for (const e of events) {
    const uid = crypto.randomUUID();

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${toICSDateTime(new Date())}`);
    lines.push(`SUMMARY:${e.title}`);
    lines.push(`DTSTART:${toICSDateTime(e.start)}`);
    lines.push(`DTEND:${toICSDateTime(e.end)}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

// ---------- UI ----------
let lastEvents = [];

function getParamsFromUI() {
  const order = document.getElementById("rotationOrder").value
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  return {
    startDate: document.getElementById("startDate").value,
    years: Number(document.getElementById("years").value),

    rotationOrder: order,

    hospStartTime: document.getElementById("hospStart").value,
    hospEndTime: document.getElementById("hospEnd").value,

    odcStartTime: document.getElementById("odcStart").value,
    odcEndTime: document.getElementById("odcEnd").value,

    lanePatternWeeks: Number(document.getElementById("lanePattern").value),
    laneStartTime: document.getElementById("laneStart").value,
    laneEndTime: document.getElementById("laneEnd").value,

    showOff: document.getElementById("showOff").checked,
    doubleOffOnLaneWeeks: document.getElementById("doubleOffOnLaneWeeks").checked,

    weekendStartTime: document.getElementById("weekendStart").value,
    weekendEndTime: document.getElementById("weekendEnd").value,
    laneWeekendEvery: Number(document.getElementById("laneWeekendEvery").value),
  };
}

function renderPreview(events) {
  const preview = document.getElementById("preview");
  preview.innerHTML = "";

  const summary = document.getElementById("summary");
  summary.innerHTML = `
    <p><strong>${events.length}</strong> events generated.</p>
    <p>Showing first <strong>150</strong>.</p>
  `;

  events.slice(0, 150).forEach(e => {
    const div = document.createElement("div");
    div.className = "event";
    div.innerHTML = `
      <strong>${e.title}</strong><br/>
      ${e.start.toLocaleString()} → ${e.end.toLocaleString()}
    `;
    preview.appendChild(div);
  });
}

document.getElementById("generateBtn").addEventListener("click", () => {
  try {
    const params = getParamsFromUI();
    lastEvents = generateSchedule(params);
    renderPreview(lastEvents);
    document.getElementById("downloadBtn").disabled = false;
  } catch (err) {
    alert(err.message || String(err));
  }
});

document.getElementById("downloadBtn").addEventListener("click", () => {
  const ics = exportICS(lastEvents);
  const blob = new Blob([ics], { type: "text/calendar" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "shift_schedule.ics";
  a.click();

  URL.revokeObjectURL(url);
});
