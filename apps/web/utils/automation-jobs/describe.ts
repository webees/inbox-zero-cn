import cronstrue from "cronstrue";

export function describeCronSchedule(cronExpression: string): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  try {
    const parts = cronExpression.trim().split(/\s+/);
    if (parts.length !== 5) return cronstrueFallback(cronExpression);

    const [minField, hourField, domField, monthField, dowField] = parts;

    if (domField !== "*" || monthField !== "*") {
      return cronstrueFallback(cronExpression);
    }

    const minute = minField === "*" ? 0 : Number.parseInt(minField, 10);
    const utcHours =
      hourField === "*"
        ? null
        : hourField.split(",").map((h) => Number.parseInt(h.trim(), 10));

    if (!utcHours || Number.isNaN(minute)) {
      return cronstrueFallback(cronExpression);
    }

    const timeFormatter = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: tz,
    });

    const now = new Date();
    const localTimes = utcHours.map((h) => {
      const utcDate = new Date(
        Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate(),
          h,
          minute,
        ),
      );
      return timeFormatter.format(utcDate);
    });

    const weekdayText = describeWeekdays(dowField);
    const tzAbbr = getTimezoneAbbr(tz);

    const timeList =
      localTimes.length === 1
        ? localTimes[0]
        : `${localTimes.slice(0, -1).join("、")} 和 ${localTimes[localTimes.length - 1]}`;

    return `${weekdayText} ${timeList} ${tzAbbr}`;
  } catch {
    return cronstrueFallback(cronExpression);
  }
}

function describeWeekdays(dowField: string): string {
  if (dowField === "*") return "每天";
  if (dowField === "1-5") return "工作日";
  if (dowField === "0,6" || dowField === "6,0") return "周末";
  if (dowField === "1-7" || dowField === "0-6") return "每天";
  return cronstrue.toString(`0 0 * * ${dowField}`).replace("At 12:00 AM, ", "");
}

function getTimezoneAbbr(tz: string): string {
  return (
    new Intl.DateTimeFormat("en-US", {
      timeZoneName: "short",
      timeZone: tz,
    })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName")?.value ?? tz
  );
}

function cronstrueFallback(cronExpression: string): string {
  try {
    return cronstrue.toString(cronExpression);
  } catch {
    return cronExpression;
  }
}
