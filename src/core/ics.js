// Calendario: archivo .ics y enlace de Google Calendar.

function pad(n) {
  return String(n).padStart(2, '0');
}

function localStamp(d, withTime) {
  const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  return withTime ? `${ymd}T${pad(d.getHours())}${pad(d.getMinutes())}00` : ymd;
}

function utcStamp(d) {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function escapeIcs(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function fold(line) {
  const out = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = ` ${rest.slice(74)}`;
  }
  out.push(rest);
  return out.join('\r\n');
}

function endOf(item) {
  const start = new Date(item.date);
  if (item.endDate) return new Date(item.endDate);
  const end = new Date(start);
  if (item.hasTime) end.setHours(end.getHours() + 1);
  else end.setDate(end.getDate() + 1);
  return end;
}

/**
 * @param {{date:string, endDate?:string, hasTime:boolean, title:string, sentence:string}[]} items
 */
export function buildIcs(items, source = '') {
  const now = utcStamp(new Date());
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Aracne//Plazos//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  items.forEach((it, i) => {
    const start = new Date(it.date);
    const end = endOf(it);
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:aracne-${start.getTime()}-${i}@aracne.app`);
    lines.push(`DTSTAMP:${now}`);
    if (it.hasTime) {
      lines.push(`DTSTART:${localStamp(start, true)}`);
      lines.push(`DTEND:${localStamp(end, true)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${localStamp(start, false)}`);
      lines.push(`DTEND;VALUE=DATE:${localStamp(end, false)}`);
    }
    lines.push(fold(`SUMMARY:${escapeIcs(it.title)}`));
    lines.push(fold(`DESCRIPTION:${escapeIcs(`${it.sentence}${source ? `\n\nFuente: ${source}` : ''}`)}`));
    if (!it.hasTime) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeIcs(it.title)}`, 'TRIGGER:-P1D', 'END:VALARM');
    }
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

export function googleCalendarUrl(item, source = '') {
  const start = new Date(item.date);
  const end = endOf(item);
  const dates = `${localStamp(start, item.hasTime)}/${localStamp(end, item.hasTime)}`;
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: item.title,
    dates,
    details: `${item.sentence}${source ? `\n\nFuente: ${source}` : ''}`,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
