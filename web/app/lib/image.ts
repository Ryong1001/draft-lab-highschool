/** 고른 사진을 정사각형으로 줄인다 — 브라우저에서 도는 코드다.
 *
 * 서버로 원본을 보내지 않는다. 서버에서 이미지를 다시 그리려면 sharp 같은 패키지가
 * 필요한데, 어차피 버릴 화소를 올리느라 시간을 쓰는 것보다 보낼 때 줄이는 편이 싸다.
 * 서버는 여기서 줄였다는 걸 믿지 않고 형식·크기를 다시 확인한다(lib/avatars.ts).
 *
 * 내 정보(AvatarForm)와 파트너 계정 만들기(AdminPartners)가 같이 쓴다. 게시판 사진은
 * 모양을 자르지 않고 줄이기만 하는 shrinkPhoto 를 쓴다.
 */

export const AVATAR_SIZE = 256;

/** 파일 → `data:image/webp;base64,...`. 짧은 변에 맞춰 가운데를 잘라낸다. */
export function shrinkToSquare(file: File, size = AVATAR_SIZE): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("canvas"));
        return;
      }
      // 동그라미에 넣을 것이라 정사각형이어야 한다. 짧은 변 기준으로 가운데를 자른다.
      const side = Math.min(img.width, img.height);
      ctx.drawImage(
        img,
        (img.width - side) / 2,
        (img.height - side) / 2,
        side,
        side,
        0,
        0,
        size,
        size,
      );
      // WebP 를 못 만드는 브라우저는 자동으로 PNG 를 준다. 서버는 둘 다 받는다.
      resolve(canvas.toDataURL("image/webp", 0.85));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("load"));
    };
    img.src = url;
  });
}

/** 게시판 사진의 긴 변 상한. 화면에서 글 폭(최대 768px)의 2배가 안 되게 둔다 — 레티나 화면에서도
 * 흐려 보이지 않을 만큼이고, 그 이상은 용량만 먹는다. */
export const PHOTO_MAX_SIDE = 1280;
/** 사진 한 장의 원본 바이트 상한. 서버(lib/board.ts 의 MAX_IMAGE_BYTES)와 같은 값이다. */
export const PHOTO_MAX_BYTES = 300 * 1024;

function dataUriBytes(uri: string): number {
  return Math.floor(((uri.length - uri.indexOf(",") - 1) * 3) / 4);
}

/** 파일 → 줄인 `data:image/webp;base64,...`. 비율은 그대로 두고 긴 변을 PHOTO_MAX_SIDE 로 맞춘다.
 *
 * 상한을 넘으면 화질을 먼저 낮추고(0.82 → 0.5), 그래도 크면 크기를 줄여 다시 해 본다.
 * 사진 대부분은 첫 번째(1280px, 0.82)에서 150~300KB 로 끝난다.
 */
export function shrinkPhoto(file: File, maxSide = PHOTO_MAX_SIDE, maxBytes = PHOTO_MAX_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("canvas"));
        return;
      }
      let side = maxSide;
      for (let round = 0; round < 6; round += 1) {
        const scale = Math.min(1, side / Math.max(img.width, img.height));
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        // 투명한 PNG 를 WebP 가 아닌 JPEG 로 떨어뜨리는 브라우저에서 까맣게 나오지 않도록 흰 바탕을 깐다.
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        for (const quality of [0.82, 0.7, 0.6, 0.5]) {
          // WebP 를 못 만드는 브라우저는 PNG 를 준다 — 그건 크니 JPEG 로 다시 만든다.
          let uri = canvas.toDataURL("image/webp", quality);
          if (!uri.startsWith("data:image/webp")) uri = canvas.toDataURL("image/jpeg", quality);
          if (dataUriBytes(uri) <= maxBytes) {
            resolve(uri);
            return;
          }
        }
        side = Math.round(Math.max(canvas.width, canvas.height) * 0.75);
      }
      reject(new Error("too-big"));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("load"));
    };
    img.src = url;
  });
}
