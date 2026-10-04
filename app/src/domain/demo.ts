// Built-in fictional demo project (from the planning pack's examples/). Memory only.
import type { ProjectBundle, Source, Excerpt } from './schema';
import { sha256Hex } from './hash';
import { publicQuote, publicReviewHash } from './excerpt';

export const DEMO_TEXTS = [
  {
    alias: 'P01',
    title: '初回購入の体験',
    text: '【架空データ】ECの商品ページ改善 / P01\n送料は購入の直前まで分かりませんでした。商品ページで総額の目安が分かると助かります。\nいつも使う店なら、送料の説明は長くなくても大丈夫です。\nスマホで見ると、返品の条件を探すのに少し時間が掛かりました。\n',
  },
  {
    alias: 'P02',
    title: '購入前の迷い',
    text: '【架空データ】ECの商品ページ改善 / P02\n送料が分からないと、カートに入れる前に迷います。\n金額だけでなく、到着する日の目安も見たいです。\n',
  },
  {
    alias: 'P03',
    title: '常連の体験',
    text: '【架空データ】ECの商品ページ改善 / P03\n常連なので送料は気になりません。説明が増えると商品写真が見づらくなりそうです。\n初めて使う人には、短い説明があると良いと思います。\n',
  },
];

const T0 = '2026-10-01T00:00:00.000Z';
// fixed ids keep the demo deterministic across reloads (it lives in memory only)
const ID = {
  project: '00000000-0000-4000-8000-000000000001',
  batch: '00000000-0000-4000-8000-000000000002',
  part: (i: number) => `00000000-0000-4000-8000-00000000010${i}`,
  src: (i: number) => `00000000-0000-4000-8000-00000000020${i}`,
  theme: (i: number) => `00000000-0000-4000-8000-00000000030${i}`,
  ex: (i: number) => `00000000-0000-4000-8000-00000000040${i}`,
  finding: (i: number) => `00000000-0000-4000-8000-00000000050${i}`,
  link: (i: number) => `00000000-0000-4000-8000-00000000060${i}`,
};

export const DEMO_PROJECT_ID = ID.project;

const meta = { createdAt: T0, updatedAt: T0, revision: 1 };

export async function buildDemoBundle(): Promise<ProjectBundle> {
  const sources: Source[] = [];
  for (let i = 0; i < DEMO_TEXTS.length; i++) {
    const d = DEMO_TEXTS[i]!;
    sources.push({ ...meta, id: ID.src(i + 1), projectId: ID.project, sourceNo: i + 1, participantId: ID.part(i + 1), title: d.title, originalFilename: null, text: d.text, sha256: await sha256Hex(d.text), importBatchId: ID.batch });
  }
  const ex = (i: number, srcIdx: number, phrase: string, themeIds: string[]): Excerpt => {
    const s = sources[srcIdx]!;
    const start = s.text.indexOf(phrase);
    if (start < 0) throw new Error('demo phrase missing');
    return { ...meta, id: ID.ex(i), projectId: ID.project, sourceId: s.id, startUtf16: start, endUtf16: start + phrase.length, quote: phrase, themeIds, note: '', redactions: [], publicReviewedHash: null };
  };
  const excerpts = [
    ex(1, 0, '送料は購入の直前まで分かりませんでした。商品ページで総額の目安が分かると助かります。', [ID.theme(1)]),
    ex(2, 1, '送料が分からないと、カートに入れる前に迷います。', [ID.theme(1)]),
    ex(3, 2, '説明が増えると商品写真が見づらくなりそうです。', [ID.theme(1)]),
    ex(4, 0, 'スマホで見ると、返品の条件を探すのに少し時間が掛かりました。', [ID.theme(2)]),
  ];
  // the demo shows a reviewed state for the first finding's quotes
  for (const e of excerpts.slice(0, 3)) {
    const s = sources.find((x) => x.id === e.sourceId)!;
    const alias = DEMO_TEXTS[s.sourceNo - 1]!.alias;
    e.publicReviewedHash = await publicReviewHash({ publicText: publicQuote(e.quote, e.redactions), alias, sourceNo: s.sourceNo, startUtf16: e.startUtf16, endUtf16: e.endUtf16 });
  }
  return {
    projects: [
      {
        ...meta,
        id: ID.project,
        title: '【サンプル】ECサイトの購入体験',
        question: '初めて購入する人は、商品ページのどこで迷っているか。',
        periodStart: null,
        periodEnd: null,
        limitations: '架空の3人の発言のみ。全利用者を代表する結果ではありません。',
        nextSourceNo: 4,
        nextParticipantNo: 4,
      },
    ],
    participants: DEMO_TEXTS.map((d, i) => ({ ...meta, id: ID.part(i + 1), projectId: ID.project, alias: d.alias, internalNote: '' })),
    sources,
    excerpts,
    themes: [
      { ...meta, id: ID.theme(1), projectId: ID.project, label: '送料の見通し', labelKey: '送料の見通し', description: '', order: 1 },
      { ...meta, id: ID.theme(2), projectId: ID.project, label: '返品条件', labelKey: '返品条件', description: '', order: 2 },
    ],
    findings: [
      {
        ...meta,
        id: ID.finding(1),
        projectId: ID.project,
        title: '価格の不安は、送料が見えないことから。',
        interpretation: '初めて購入する人には、注文確定の前に総額を把握したいという声がある。\n一方で、慣れた人には説明が増えることが負担になりそうだ。',
        proposal: '商品詳細に送料の目安を短く表示し、詳しい条件は開いて読めるようにする。',
        expectedChange: 'カート投入前に送料を理由とした迷いが減る。',
        nextCheck: '初回購入者が、総額の目安を自分で見つけられるか。',
        counterCheck: 'found',
        counterNote: '常連の利用者からは、説明が増えることへの懸念があった。',
        status: 'ready',
        included: true,
        order: 1,
      },
      {
        ...meta,
        id: ID.finding(2),
        projectId: ID.project,
        title: '返品の条件は、商品ページの中に。',
        interpretation: '',
        proposal: '',
        expectedChange: '',
        nextCheck: '',
        counterCheck: 'not_checked',
        counterNote: '',
        status: 'draft',
        included: false,
        order: 2,
      },
    ],
    evidenceLinks: [
      { ...meta, id: ID.link(1), projectId: ID.project, findingId: ID.finding(1), excerptId: ID.ex(1), role: 'supports', order: 1 },
      { ...meta, id: ID.link(2), projectId: ID.project, findingId: ID.finding(1), excerptId: ID.ex(2), role: 'supports', order: 2 },
      { ...meta, id: ID.link(3), projectId: ID.project, findingId: ID.finding(1), excerptId: ID.ex(3), role: 'contradicts', order: 3 },
      { ...meta, id: ID.link(4), projectId: ID.project, findingId: ID.finding(2), excerptId: ID.ex(4), role: 'supports', order: 1 },
    ],
  };
}
