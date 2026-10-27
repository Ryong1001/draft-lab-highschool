import Link from "next/link";
import { currentLang, langPrefix } from "../lib/lang";
import { translator } from "../lib/i18n";

/** 모든 페이지 맨 아래에 붙는 기록 안내.
 *
 * 페이지마다 따로 적으면 새 탭을 만들 때 빠지기 때문에 루트 레이아웃에 달아 둔다 —
 * 어느 경로로 들어와도 보이고, 문구를 고칠 일이 생기면 이 파일 하나만 고치면 된다.
 *
 * 여기서 계산한 지표가 공식 기록으로 인용되면 곤란해서, 자체 산출이라는 점을 밝힌다.
 */
export default async function SiteFooter() {
  const lang = await currentLang();
  const prefix = langPrefix(lang);
  const t = translator(lang);
  const linkClass = "underline underline-offset-2 hover:text-black/80 dark:hover:text-white/70";

  return (
    <footer className="mt-auto border-t border-black/10 px-4 py-8 dark:border-white/10 sm:px-8">
      <div className="mx-auto max-w-5xl space-y-2 text-xs leading-relaxed text-black/50 dark:text-white/40">
        <p>
          <span className="font-semibold text-black/70 dark:text-white/60">
            {t("기록 안내", "About the data")}
          </span>{" "}
          · {t(
            "주자 상황·아웃카운트 등은 경기 기록지를 보고 직접 입력한 값이며, 이를 바탕으로 계산한 모든 분석 지표는 RookiezPark 의 자체 산출입니다. 공식 기록과 다를 수 있으므로 공식 기록으로 인용하지 말아 주세요.",
            "Base states, out counts and similar items were entered by hand from game scoresheets, and every analytic stat computed from them is RookiezPark's own work. These figures may differ from official records, so please do not cite them as official.",
          )}
        </p>
        <p className="pt-1">
          <Link href={`${prefix}/report`} className={linkClass}>
            {t("문의하기", "Contact us")}
          </Link>
          <span className="mx-2">·</span>
          <Link href={`${prefix}/privacy`} className={`${linkClass} font-semibold`}>
            {t("개인정보처리방침", "Privacy policy")}
          </Link>
          {/* 기록 오류 제보(위)와 사업 문의는 받는 사람이 다르다 — 주소를 따로 적는다. */}
          <span className="mx-2">·</span>
          {t("비즈니스/파트너쉽 문의", "Business & partnerships")}:{" "}
          <a href="mailto:dimelo@diegobaseball.com" className={linkClass}>
            dimelo@diegobaseball.com
          </a>
        </p>
      </div>
    </footer>
  );
}
