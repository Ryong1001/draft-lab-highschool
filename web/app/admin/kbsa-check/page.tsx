import fs from "fs";
import path from "path";
import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "../../lib/auth";

export const metadata: Metadata = {
  title: "원본 대조 - RookiezPark",
  robots: { index: false, follow: false },
};

/** 고친 기록지와 KBSA 공식 박스스코어가 어디서 갈리는지 — **관리자만**.
 *
 * 검수용 화면이라 밖에 내보내지 않는다. 숫자는 여기서 계산하지 않는다 —
 * local_mirror/kbsa_ip_check/make_report.py 가 KBSA 를 새로 긁어 대조한 결과를
 * _data/report.json 으로 떨구고, 이 화면은 그걸 그대로 그린다.
 *
 * 대조 축이 셋이다.
 *   투수이닝  (경기, 팀, 투수) 아웃 수. 팀 합까지 어긋나면 '팀차이' 가 0 이 아니다.
 *   타점      (경기, 팀, 타자) RBI
 *   득점      같은 단위 R
 *
 * 타석·안타는 화면에서 뺐다 — 안타는 7년 내내 0행이고 남는 건 타석 수 차이뿐이라,
 * 검수할 거리가 아니면서 자리만 먹었다. report.json 에는 그대로 실려 있으므로
 * 필요해지면 되살리면 된다(make_report.py 는 건드리지 않았다).
 */

const DATA = path.join(process.cwd(), "app", "admin", "kbsa-check", "_data", "report.json");

interface Season {
  연도: number;
  경기: number;
  투수이닝_불일치행: number;
  투수이닝_팀단위: number;
  타점_불일치행: number;
  타점_기록지: number;
  타점_KBSA: number;
  득점_불일치행: number;
  득점_기록지: number;
  득점_KBSA: number;
}

type Row = Record<string, string | number | null>;

interface Report {
  generatedAt: string;
  seasons: Season[];
  pitcher: Row[];
  rbi: Row[];
  run: Row[];
}

function load(): Report | null {
  try {
    return JSON.parse(fs.readFileSync(DATA, "utf-8")) as Report;
  } catch {
    return null;
  }
}

const CARD = "rounded-md border border-black/10 p-4 dark:border-white/10";
const TH = "px-3 py-2 text-left font-medium whitespace-nowrap";
const TD = "px-3 py-1.5 tabular-nums whitespace-nowrap";

/** 차이 값에 색을 준다 — 기록지가 많으면 파랑, KBSA 가 많으면 주황. */
function Diff({ v }: { v: number }) {
  const tone =
    v > 0 ? "text-blue-600 dark:text-blue-400" : v < 0 ? "text-amber-600 dark:text-amber-400" : "";
  return (
    <span className={`font-semibold ${tone}`}>
      {v > 0 ? `+${v}` : v}
    </span>
  );
}

function Table({ rows, cols, diffCol }: { rows: Row[]; cols: string[]; diffCol: string }) {
  return (
    <div className="max-h-[28rem] overflow-auto">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="sticky top-0 bg-white text-black/50 dark:bg-neutral-950 dark:text-white/50">
          <tr className="border-b border-black/10 dark:border-white/10">
            {cols.map((c) => (
              <th key={c} className={TH}>
                {c === "date" ? "날짜" : c === "game_id" ? "경기" : c === "file_name" ? "파일" : c.replace("KBSA", "원본")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-black/5 dark:border-white/5">
              {cols.map((c) => (
                <td key={c} className={TD}>
                  {c === diffCol ? <Diff v={Number(r[c])} /> : String(r[c] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Section({
  title,
  note,
  rows,
  cols,
  diffCol,
}: {
  title: string;
  note: string;
  rows: Row[];
  cols: string[];
  diffCol: string;
}) {
  return (
    <details className="mb-4" open={rows.length > 0 && rows.length <= 60}>
      <summary className="cursor-pointer text-sm font-bold">
        {title}{" "}
        <span className="font-normal text-black/50 dark:text-white/50">{rows.length}행</span>
      </summary>
      <p className="mb-3 mt-1 text-xs text-black/50 dark:text-white/50">{note}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-black/50 dark:text-white/50">불일치가 없습니다.</p>
      ) : (
        <div className={CARD}>
          <Table rows={rows} cols={cols} diffCol={diffCol} />
        </div>
      )}
    </details>
  );
}

export default async function KbsaCheckPage() {
  await requireAdmin();
  const rep = load();

  if (!rep) {
    return (
      <main className="mx-auto min-h-screen max-w-5xl px-4 py-8 sm:px-8">
        <h1 className="mb-1 text-xl font-bold">원본 대조</h1>
        <div className={`${CARD} mt-6`}>
          <p className="mb-2 text-sm font-semibold">아직 대조 결과가 없습니다.</p>
          <p className="mb-3 text-sm text-black/60 dark:text-white/60">
            원본을 새로 긁어 기록지와 맞춰 본 뒤 아래를 돌리면 이 화면에 나옵니다.
          </p>
          <pre className="overflow-x-auto rounded bg-black/5 p-3 text-xs dark:bg-white/10">
{`python local_mirror/kbsa_ip_check/kbsa_crawl.py 2026 --delay 4,5
python local_mirror/kbsa_ip_check/make_report.py`}
          </pre>
        </div>
      </main>
    );
  }

  const total = rep.seasons.reduce(
    (a, s) => ({
      경기: a.경기 + s.경기,
      투수: a.투수 + s.투수이닝_불일치행,
      타점: a.타점 + s.타점_불일치행,
      득점: a.득점 + s.득점_불일치행,
      팀이닝: a.팀이닝 + s.투수이닝_팀단위,
    }),
    { 경기: 0, 투수: 0, 타점: 0, 득점: 0, 팀이닝: 0 },
  );

  const base = ["연도", "date", "game_id", "file_name"];

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 py-8 sm:px-8">
      <h1 className="mb-1 text-xl font-bold">원본 대조</h1>
      <p className="mb-6 text-sm text-black/50 dark:text-white/50">
        사람이 고친 기록지와 공식 박스스코어가 어디서 갈리는지 봅니다.
        관리자에게만 보입니다. · 기준 {rep.generatedAt} ·{" "}
        <Link href="/admin" className="underline">
          관리 화면
        </Link>
      </p>

      <div className={`${CARD} mb-6`}>
        <p className="mb-3 text-sm font-semibold">
          {total.경기.toLocaleString()}경기 전수 대조
        </p>
        <div className="grid grid-cols-3 gap-3 text-sm">
          {[
            ["투수이닝", total.투수],
            ["타점", total.타점],
            ["득점", total.득점],
          ].map(([label, n]) => (
            <div key={String(label)}>
              <div className="text-xs text-black/50 dark:text-white/50">{label}</div>
              <div className="text-lg font-bold tabular-nums">{Number(n).toLocaleString()}행</div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-black/50 dark:text-white/50">
          팀 단위 투구이닝이 어긋난 경기는 {total.팀이닝}건입니다. 투수 불일치는 전부 팀 안에서
          아웃이 옮겨간 것이고, 대개 ±로 짝을 이루므로 실제 사건 수는 절반쯤입니다.
        </p>
      </div>

      <div className={`${CARD} mb-8 overflow-x-auto`}>
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-black/50 dark:text-white/50">
            <tr className="border-b border-black/10 dark:border-white/10">
              <th className={TH}>연도</th>
              <th className="px-3 py-2 text-center font-medium">경기</th>
              <th className="px-3 py-2 text-center font-medium">투수이닝</th>
              <th className="px-3 py-2 text-center font-medium">타점</th>
              <th className="px-3 py-2 text-center font-medium">득점</th>
              <th className="px-3 py-2 text-center font-medium">타점 합 (기록지/원본)</th>
              <th className="px-3 py-2 text-center font-medium">득점 합 (기록지/원본)</th>
            </tr>
          </thead>
          <tbody>
            {rep.seasons.map((s) => (
              <tr key={s.연도} className="border-b border-black/5 dark:border-white/5">
                <td className="px-3 py-1.5 font-semibold">{s.연도}</td>
                <td className={`${TD} text-center`}>{s.경기}</td>
                <td className={`${TD} text-center`}>{s.투수이닝_불일치행}</td>
                <td className={`${TD} text-center`}>{s.타점_불일치행}</td>
                <td className={`${TD} text-center`}>{s.득점_불일치행}</td>
                <td className={`${TD} text-center`}>
                  {s.타점_기록지.toLocaleString()} / {s.타점_KBSA.toLocaleString()}
                </td>
                <td className={`${TD} text-center`}>
                  {s.득점_기록지.toLocaleString()} / {s.득점_KBSA.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Section
        title="투수 이닝"
        note="아웃 수가 갈린 (경기·팀·투수). 팀차이가 0이면 팀 합은 맞고 투수끼리만 옮겨간 것입니다 — 대부분 도루자·주자아웃 같은 비타석 아웃의 귀속 문제입니다."
        rows={rep.pitcher}
        cols={[...base, "def_team", "pitcher", "기록지_IP", "KBSA_IP", "차이", "팀차이"]}
        diffCol="차이"
      />
      <Section
        title="타점"
        note="RBI 가 갈린 (경기·팀·타자). 상당수는 작업자가 기록지 RBI 칸에 직접 넣은 값과 공식 기록의 차이라, 규칙을 고쳐서 줄일 수 있는 영역이 아닙니다."
        rows={rep.rbi}
        cols={[...base, "team", "batter", "기록지_RBI", "KBSA_RBI", "차이_RBI"]}
        diffCol="차이_RBI"
      />
      <Section
        title="득점"
        note="R 이 갈린 (경기·팀·타자). 합계는 전 연도 맞고, 남은 건 대주자가 얽힌 타순의 귀속입니다."
        rows={rep.run}
        cols={[...base, "team", "batter", "기록지_R", "KBSA_R", "차이_R"]}
        diffCol="차이_R"
      />
    </main>
  );
}
