import "server-only";

import fs from "fs";
import path from "path";
import { kv, kvEnabled, kvGetJson, kvSetJson } from "./kv";
import { BUILTIN_POSTS, builtinPost } from "./board-notices";

/** 자유 게시판.
 *
 * 읽기는 누구나, 쓰기는 로그인한 사람만 한다(app/api/board). 제보(lib/reports.ts)와 같은
 * 규칙이고 같은 Upstash 에 둔다 — 글 하나가 `post:<id>` 다.
 *
 * id 목록은 둘로 나눠 둔다. 일반 글은 `posts`, 관리자가 상단에 고정한 글은
 * `posts:pinned` 이고, 둘 다 쓴 시각을 점수로 한 정렬 집합(ZSET)이다. 고정 글을 일반
 * 목록에 섞어 두면 쪽을 나눌 때 한 쪽에 10개가 안 차거나 같은 글이 두 번 나온다.
 * 정렬 집합이라 고정을 풀면 원래 시각 자리로 돌아간다.
 *
 * **사진은 글과 따로 둔다**(`postimg:<글id>-<조각>`). 목록을 그릴 때마다 사진까지 끌어오면
 * 글 10개에 수 MB 를 읽게 된다. 사진은 브라우저에서 줄여 보내오고(lib/image.ts 의
 * shrinkPhoto), 서버는 그걸 믿지 않고 형식·크기를 다시 본다(lib/avatars.ts 의 validateImage)
 * — 프로필 사진과 같은 방식이라 새 저장소를 붙이지 않는다.
 *
 * **로컬에서는 파일에 둔다.** 개발 서버(`next dev`)에 Upstash 가 안 붙어 있으면
 * `web/.local-board.json` 에 쓴다. 로컬에서 글쓰기를 시험하자고 실제 저장소를 붙이면
 * 거기서 쓴 글이 실제 사이트에 그대로 뜬다. 배포(프로덕션)에서는 이 파일을 절대 보지
 * 않는다 — 서버리스는 파일이 인스턴스마다 따로 놀아서 쓴 글이 사라진다.
 *
 * 본문은 마크다운 글자 그대로 저장한다. 화면에서는 app/board/Markdown.tsx 가 React 요소로
 * 옮기고 HTML 문자열을 끼워 넣지 않으므로, 스크립트를 심을 자리가 없다.
 */

export interface Post {
  id: string;
  /** 작성자 계정(google:<sub> · admin:<id> · partner:<id>). 지울 권한을 가린다. */
  sub: string;
  authorName: string;
  title: string;
  body: string;
  createdAt: number;
  /** 관리자가 공지로 올린 글. 표시만 다르다 — 고정과는 따로 정한다. */
  notice?: boolean;
  /** 모든 쪽 맨 위에 서는 글. 관리자만 정한다. */
  pinned?: boolean;
  /** 사진 id(`<글id>-<조각>`). 사진 자체는 따로 둔다 — getPostImage. */
  images?: string[];
  /** 고친 시각. 한 번도 안 고쳤으면 없다. */
  updatedAt?: number;
  /** 코드에 박아 둔 공지(board-notices.ts). 저장소에 없어서 고치거나 지울 수 없다. */
  builtin?: boolean;
}

export const MAX_TITLE = 80;
export const MAX_BODY = 3000;
export const PAGE_SIZE = 10;
/** 글 하나에 붙일 수 있는 사진 수. */
export const MAX_IMAGES = 4;
/** 사진 한 장의 원본 바이트 상한. 브라우저(lib/image.ts 의 PHOTO_MAX_BYTES)와 같은 값이다. */
export const MAX_IMAGE_BYTES = 300 * 1024;

interface Store {
  /** 일반 글(고정 글 빼고) 수. */
  count(): Promise<number>;
  /** 일반 글을 최신순으로 offset 부터 n 개. */
  page(offset: number, n: number): Promise<Post[]>;
  /** 고정 글 전부, 최신순. */
  pinned(): Promise<Post[]>;
  get(id: string): Promise<Post | null>;
  add(post: Post): Promise<boolean>;
  put(post: Post): Promise<boolean>;
  /** 고정 여부를 바꾼다. 글에 적힌 값과 어느 목록에 있는지를 함께 옮긴다. */
  setPinned(post: Post, pinned: boolean): Promise<boolean>;
  remove(id: string): Promise<boolean>;
  /** 전체 id. 탈퇴자 글을 익명으로 돌릴 때만 쓴다. */
  ids(): Promise<string[]>;
  putImage(id: string, dataUri: string): Promise<boolean>;
  getImage(id: string): Promise<string | null>;
  removeImages(ids: string[]): Promise<void>;
}

const POST_KEY = (id: string) => `post:${id}`;
const POST_LIST = "posts";
const PINNED_LIST = "posts:pinned";
const IMAGE_KEY = (id: string) => `postimg:${id}`;

async function kvPosts(ids: string[]): Promise<Post[]> {
  if (ids.length === 0) return [];
  const raws = (await kv<(string | null)[]>("MGET", ...ids.map(POST_KEY))) ?? [];
  const out: Post[] = [];
  for (const raw of raws) {
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw) as Post);
    } catch {
      // 깨진 글 하나 때문에 목록 전체를 못 그리면 안 된다.
    }
  }
  return out;
}

const kvStore: Store = {
  async count() {
    return (await kv<number>("ZCARD", POST_LIST)) ?? 0;
  },
  async page(offset, n) {
    return kvPosts((await kv<string[]>("ZREVRANGE", POST_LIST, offset, offset + n - 1)) ?? []);
  },
  async pinned() {
    return kvPosts((await kv<string[]>("ZREVRANGE", PINNED_LIST, 0, -1)) ?? []);
  },
  get: (id) => kvGetJson<Post>(POST_KEY(id)),
  async add(post) {
    if (!(await kvSetJson(POST_KEY(post.id), post))) return false;
    return (await kv("ZADD", post.pinned ? PINNED_LIST : POST_LIST, post.createdAt, post.id)) !== null;
  },
  put: (post) => kvSetJson(POST_KEY(post.id), post),
  async setPinned(post, pinned) {
    if (!(await kvSetJson(POST_KEY(post.id), { ...post, pinned }))) return false;
    await kv("ZREM", pinned ? POST_LIST : PINNED_LIST, post.id);
    return (await kv("ZADD", pinned ? PINNED_LIST : POST_LIST, post.createdAt, post.id)) !== null;
  },
  async remove(id) {
    await kv("ZREM", POST_LIST, id);
    await kv("ZREM", PINNED_LIST, id);
    return (await kv("DEL", POST_KEY(id))) !== null;
  },
  async ids() {
    const [plain, pinned] = await Promise.all([
      kv<string[]>("ZRANGE", POST_LIST, 0, -1),
      kv<string[]>("ZRANGE", PINNED_LIST, 0, -1),
    ]);
    return [...(pinned ?? []), ...(plain ?? [])];
  },
  async putImage(id, dataUri) {
    return (await kv("SET", IMAGE_KEY(id), dataUri)) !== null;
  },
  getImage: (id) => kv<string>("GET", IMAGE_KEY(id)),
  async removeImages(ids) {
    if (ids.length) await kv("DEL", ...ids.map(IMAGE_KEY));
  },
};

const LOCAL_FILE = path.join(process.cwd(), ".local-board.json");
/** 로컬 사진은 글과 다른 파일에 둔다. 목록을 읽을 때마다 사진까지 읽지 않게. */
const LOCAL_IMAGES = path.join(process.cwd(), ".local-board-images.json");

function readLocalImages(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(LOCAL_IMAGES, "utf-8")) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeLocalImages(images: Record<string, string>): boolean {
  try {
    fs.writeFileSync(LOCAL_IMAGES, JSON.stringify(images), "utf-8");
    return true;
  } catch {
    return false;
  }
}

function readLocal(): Post[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(LOCAL_FILE, "utf-8")) as { posts?: Post[] };
    return Array.isArray(parsed.posts) ? parsed.posts : [];
  } catch {
    return [];
  }
}

function writeLocal(posts: Post[]): boolean {
  try {
    fs.writeFileSync(LOCAL_FILE, JSON.stringify({ posts }, null, 2), "utf-8");
    return true;
  } catch {
    return false;
  }
}

/** 로컬 개발용. 최신 글이 배열 앞에 온다. 고정 여부는 글에 적힌 값으로만 가른다. */
const fileStore: Store = {
  async count() {
    return readLocal().filter((p) => !p.pinned).length;
  },
  async page(offset, n) {
    return readLocal()
      .filter((p) => !p.pinned)
      .slice(offset, offset + n);
  },
  async pinned() {
    return readLocal().filter((p) => p.pinned);
  },
  async get(id) {
    return readLocal().find((p) => p.id === id) ?? null;
  },
  async add(post) {
    return writeLocal([post, ...readLocal()]);
  },
  async put(post) {
    return writeLocal(readLocal().map((p) => (p.id === post.id ? post : p)));
  },
  async setPinned(post, pinned) {
    return this.put({ ...post, pinned });
  },
  async remove(id) {
    return writeLocal(readLocal().filter((p) => p.id !== id));
  },
  async ids() {
    return readLocal().map((p) => p.id);
  },
  async putImage(id, dataUri) {
    return writeLocalImages({ ...readLocalImages(), [id]: dataUri });
  },
  async getImage(id) {
    return readLocalImages()[id] ?? null;
  },
  async removeImages(ids) {
    const images = readLocalImages();
    for (const id of ids) delete images[id];
    writeLocalImages(images);
  },
};

function store(): Store | null {
  if (kvEnabled) return kvStore;
  if (process.env.NODE_ENV === "development") return fileStore;
  return null;
}

/** 글을 받을 곳이 있는가. 없으면 목록은 비어 보이고 글쓰기는 막힌다. */
export function boardEnabled(): boolean {
  return store() !== null;
}

/** 시각이 앞에 오는 id — 목록이 없어도 대충 시간순이고, 겹칠 일이 없다(lib/reports.ts 와 같다). */
function newId(now: number): string {
  return `${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** 주소로 들어오는 id 는 이 모양만 받는다. 저장소 키가 되므로 아무 글자나 넣게 두지 않는다. */
export function isPostId(id: string): boolean {
  return /^[0-9a-z]{6,20}$/.test(id);
}

/** 사진 id 는 `<글id>-<조각>` 다. 조각은 무작위라 글을 고치며 뺐다 넣어도 같은 id 가 다시
 * 나오지 않는다 — 사진 주소는 브라우저가 1년 동안 들고 있어서(app/api/board/image), id 를
 * 다시 쓰면 새 사진 자리에 옛 사진이 뜬다. */
export function isImageId(id: string): boolean {
  return /^[0-9a-z]{6,20}-[0-9a-z]{1,8}$/.test(id);
}

function newImageId(postId: string): string {
  return `${postId}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 사진들을 넣고 id 를 돌려준다. 하나라도 실패하면 넣은 것을 되돌리고 null. */
async function putImages(s: Store, postId: string, uris: string[]): Promise<string[] | null> {
  const ids: string[] = [];
  for (const uri of uris) {
    const imageId = newImageId(postId);
    if (!(await s.putImage(imageId, uri))) {
      await s.removeImages(ids);
      return null;
    }
    ids.push(imageId);
  }
  return ids;
}

/** 한 쪽. 고정 글은 쪽마다 맨 위에 다시 서고, 쪽 나누기(10개)는 일반 글로만 센다. */
export async function listPosts(
  page: number,
): Promise<{ pinned: Post[]; posts: Post[]; total: number }> {
  // 코드 공지는 저장소가 없어도 선다 — 운영 원칙이라 게시판이 비어 있을 때도 보여야 한다.
  const s = store();
  if (!s) return { pinned: [...BUILTIN_POSTS], posts: [], total: 0 };
  const [pinned, posts, total] = await Promise.all([
    s.pinned(),
    s.page((page - 1) * PAGE_SIZE, PAGE_SIZE),
    s.count(),
  ]);
  return { pinned: [...BUILTIN_POSTS, ...pinned], posts, total };
}

export async function getPost(id: string): Promise<Post | null> {
  const fixed = builtinPost(id);
  if (fixed) return fixed;
  const s = store();
  if (!s || !isPostId(id)) return null;
  return s.get(id);
}

export async function createPost(input: {
  sub: string;
  authorName: string;
  title: string;
  body: string;
  notice: boolean;
  pinned: boolean;
  /** 검사를 마친 data URI 들(app/api/board 가 validateImage 로 거른다). */
  images: string[];
}): Promise<Post | null> {
  const s = store();
  if (!s) return null;
  const now = Date.now();
  const id = newId(now);
  const { images, ...rest } = input;

  // 사진부터 넣는다. 글이 먼저 보이고 사진이 나중에 들어오면, 그 사이에 연 사람은 깨진 사진을 본다.
  const imageIds = await putImages(s, id, images);
  if (!imageIds) return null;

  const post: Post = { id, ...rest, createdAt: now, ...(imageIds.length ? { images: imageIds } : {}) };
  if (await s.add(post)) return post;
  await s.removeImages(imageIds);
  return null;
}

/** 글 고치기. 권한은 부르는 쪽(app/api/board/[id])이 본다.
 *
 * 사진은 남길 것(`keep`, 지금 붙은 id 중에서)과 새로 붙일 것(`add`, 검사를 마친 data URI)을
 * 따로 받는다. 남기지 않은 사진은 지운다. 고정 여부와 쓴 시각은 건드리지 않는다.
 */
export async function updatePost(
  id: string,
  input: { title: string; body: string; notice?: boolean; keep: string[]; add: string[] },
): Promise<Post | null> {
  const s = store();
  if (!s || !isPostId(id) || builtinPost(id)) return null;
  const post = await s.get(id);
  if (!post) return null;

  const current = post.images ?? [];
  const keep = current.filter((imageId) => input.keep.includes(imageId));
  const added = await putImages(s, id, input.add);
  if (!added) return null;

  const images = [...keep, ...added];
  const next: Post = {
    ...post,
    title: input.title,
    body: input.body,
    ...(input.notice === undefined ? {} : { notice: input.notice }),
    images: images.length ? images : undefined,
    updatedAt: Date.now(),
  };
  if (!(await s.put(next))) {
    await s.removeImages(added);
    return null;
  }
  // 글을 바꾼 뒤에 옛 사진을 지운다. 먼저 지우면 저장이 실패했을 때 사진만 사라진다.
  await s.removeImages(current.filter((imageId) => !keep.includes(imageId)));
  return next;
}

/** 사진 하나(data URI). 없거나 주소가 이상하면 null. */
export async function getPostImage(id: string): Promise<string | null> {
  const s = store();
  if (!s || !isImageId(id)) return null;
  return s.getImage(id);
}

export async function setPostPinned(id: string, pinned: boolean): Promise<Post | null> {
  const s = store();
  if (!s || !isPostId(id) || builtinPost(id)) return null;
  const post = await s.get(id);
  if (!post) return null;
  return (await s.setPinned(post, pinned)) ? { ...post, pinned } : null;
}

export async function deletePost(id: string): Promise<boolean> {
  const s = store();
  if (!s || !isPostId(id) || builtinPost(id)) return false;
  const post = await s.get(id);
  if (post?.images?.length) await s.removeImages(post.images);
  return s.remove(id);
}

/** 탈퇴한 사람이 쓴 글에서 작성자만 지운다.
 *
 * 글은 남긴다 — 다른 사람이 읽고 있던 글이 통째로 사라지면 곤란하다. 다만 누가 썼는지는
 * 더 남길 이유가 없고, 지울 권한도 함께 사라진다(sub 를 비운다).
 */
export async function anonymizePostsBy(sub: string): Promise<number> {
  const s = store();
  if (!s) return 0;
  let changed = 0;
  for (const id of await s.ids()) {
    const post = await s.get(id);
    if (!post || post.sub !== sub) continue;
    await s.put({ ...post, sub: "", authorName: "탈퇴한 사용자" });
    changed += 1;
  }
  return changed;
}
