/** 글 시각. 서버가 어느 지역에서 돌든 한국 시각으로 적는다. */
export function formatPostTime(ms: number, withTime = true): string {
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const date = `${get("year")}.${get("month")}.${get("day")}`;
  return withTime ? `${date} ${get("hour")}:${get("minute")}` : date;
}
