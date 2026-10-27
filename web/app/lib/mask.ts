/** 이메일 가리기.
 *
 * 관리 화면은 관리자만 보지만, 화면을 켜둔 채 옆에 사람이 지나가는 것까지 막지는 못한다.
 * 목록에서는 가려 두고 필요할 때만 펼쳐 보게 한다. 어차피 응답에는 전체 주소가 실려 있으므로
 * 이건 암호화가 아니라 '눈에 덜 띄게' 하는 장치다 — 그래서 서버가 아니라 화면에서 가린다.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return email ? "****" : "";

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);

  // 앞 두 글자만 남긴다. 두 글자보다 짧으면 그마저도 한 글자만.
  const keep = local.length <= 2 ? 1 : 2;
  const maskedLocal = local.slice(0, keep) + "*".repeat(Math.max(local.length - keep, 3));

  const dot = domain.lastIndexOf(".");
  if (dot < 1) return `${maskedLocal}@${"*".repeat(4)}`;
  // gmail.com → gm***.com — 어느 메일인지 구분은 되되 전체는 안 보이게.
  const host = domain.slice(0, dot);
  const tld = domain.slice(dot);
  const maskedHost = host.slice(0, Math.min(2, host.length)) + "*".repeat(Math.max(host.length - 2, 3));
  return `${maskedLocal}@${maskedHost}${tld}`;
}
