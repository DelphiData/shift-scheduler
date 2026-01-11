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

function formatDateLocal(d) {
  return d.toISOString().split("T")[0];
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function toICSDateTime(d) {
  // Floating local time (no timezone)
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
}

function buildEvent({ title, start, end }) {
  return {
    title,
    start,
    end,
  };
}

// ---------- Generator ----------
function generateSchedule(params) {
  const {
    startDate,
    years,
    lanePatternWeeks,
    laneStartTime,
    laneEndTime,

    hospStartTime,
    hospEndTime,
    rotationOrder,
    rotationWeeks,

    odcStartTime,
    odcEndTime,
    hideODCWhenLane,

    weekendStartTime,
    weekendEndTime,
    laneWeekendEvery
  } = params;

  const shifts = [];
  const start = new Date(startDate);

  const totalDays = Math.floor(years * 365.25);
  const end = addDays(start, totalDays);

  const people = rotationOrder;
  const weeksTotal = Math.ceil(totalDays / 7);

  function personForWeek(weekIndex) {
    return people[weekIndex % rotationWeeks];
  }

  function isLaneWeek(weekIndex) {
    return (weekIndex % lanePatternWeeks) === 0;
  }

  function isLaneWeekend(weekIndex) {
    return (weekIndex % laneWeekendEvery) === 0;
  }

  for (let week = 0; week < weeksTotal; week++) {
    const weekStart = addDays(start, week * 7);
    const person = personForWeek(week);

    // --- Weekday shifts (Mon-Fri) ---
    for (let day = 0; day < 5; day++) {
      const date = addDays(weekStart, day);

      if (date > end) break;

      // Hospital shift (always)
      {
        const st = new Date(date);
        const et = new Date(date);
        const hs = parseTime(hospStartTime);
        const he = parseTime(hospEndTime);
        st.setHours(hs.h, hs.m, 0, 0);
        et.setHours(he.h, he.m, 0, 0);

        shifts.push(buildEvent({
          title: `HOSPITAL ${person}`,
          start: st,
          end: et
        }));
      }

      // ODC shift (unless hidden by Lane precedence)
      if (!(hideODCWhenLane && isLaneWeek(week))) {
        const st = new Date(date);
        const et = new Date(date);
        const os = parseTime(odcStartTime);
        const oe = parseTime(odcEndTime);
        st.setHours(os.h, os.m, 0, 0);
        et.setHours(oe.h, oe.m, 0, 0);

        shifts.push(buildEvent({
          title: `ODC ${person}`,
          start: st,
          end: et
        }));
      }

      // Lane shift (only on lane weeks)
      if (isLaneWeek(week)) {
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
      }
    }

    // --- Weekend shift (Sat 6am -> Sun 11:59pm) ---
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
        : `Weekend ${person}`;

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
  return {
    startDate: document.getElementById("startDate").value,
    years: Number(document.getElementById("years").value),

    lanePatternWeeks: Number(document.getElementById("lanePattern").value),
    laneStartTime: document.getElementById("laneStart").value,
    laneEndTime: document.getElementById("laneEnd").value,

    hospStartTime: document.getElementById("hospStart").value,
    hospEndTime: document.getElementById("hospEnd").value,

    rotationOrder: document.getElementById("rotationOrder").value
      .split(",")
      .map(s => s.trim())
      .filter(Boolean),

    rotationWeeks: Number(document.getElementById("rotationWeeks").value),

    odcStartTime: document.getElementById("odcStart").value,
    odcEndTime: document.getElementById("odcEnd").value,
    hideODCWhenLane: document.getElementById("hideODCWhenLane").checked,

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
  const params = getParamsFromUI();
  lastEvents = generateSchedule(params);
  renderPreview(lastEvents);
  document.getElementById("downloadBtn").disabled = false;
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
