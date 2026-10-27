import type { MetadataRoute } from "next";

/** 검색엔진 수집 규칙. 관리자·계정·API 는 사람이 찾아 들어올 화면이 아니라 뺀다 —
 * 페이지마다 robots noindex 를 이미 달아 두었지만, 애초에 긁으러 오지 않게 막아 두면
 * 수집 예산이 공개 화면(리더보드·팀·경기)에 쓰인다. 영문판(/en)도 같은 규칙이다. */
export default function robots(): MetadataRoute.Robots {
  const privatePaths = ["/admin", "/api/", "/account", "/login", "/board/write"];
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [...privatePaths, ...privatePaths.map((p) => `/en${p}`)],
    },
    sitemap: "https://rookiezpark.com/sitemap.xml",
    host: "https://rookiezpark.com",
  };
}
