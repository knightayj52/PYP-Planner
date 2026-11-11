/* © 2026 영쌤클래스 · 교육용으로 제작 · 무단 복제·재배포 금지
 * demo.js — 예시 체험 모드
 *
 * API 키 없이 완성된 예시 단원(4학년 「함께 만드는 우리 동네」)으로 8단계를 둘러본다.
 *   - 체험 중에는 임시 저장 칸을 따로 쓴다(pyp.demoDraft). 선생님이 작업하던 설계안(pyp.draft)은 건드리지 않는다.
 *   - AI 버튼을 누르면 Gemini를 부르지 않고 아래에 미리 준비한 예시 결과를 돌려준다.
 *   - 예시 내용은 개발자가 구성한 것이며 실제 AI 호출 결과가 아니다.
 */
(function () {
  'use strict';

  var FLAG = 'pyp.demo';
  var DRAFT = 'pyp.demoDraft';

  function ls(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      if (value === null) { localStorage.removeItem(key); return null; }
      localStorage.setItem(key, value);
      return value;
    } catch (e) { return null; }
  }

  var active = ls(FLAG) === '1';

  /* ============================================================
   * 예시 내용 — 4학년 「함께 만드는 우리 동네」
   * ============================================================ */
  var EX = {
    picks: [
      { code: '[4사08-02]', why: '주민 참여와 자치는 사람들이 스스로를 조직해 문제를 푸는 방식을 보여 준다.' },
      { code: '[4사09-01]', why: '생활 주변의 문제를 찾고 해결하는 과정이 탐구의 중심 줄기가 된다.' },
      { code: '[4국01-06]', why: '의견과 이유를 나누는 토의는 함께 결정하는 방법을 익히게 한다.' },
      { code: '[4국03-03]', why: '의견과 까닭이 드러나는 글은 해결 방법을 제안하는 도구가 된다.' }
    ],

    candidates: [
      {
        text: '사람들은 함께 사는 곳의 문제를 해결하기 위해 역할을 나누고 책임 있게 참여한다.',
        note: '역할(기능)과 참여(책임)의 관계를 축으로 잡았다.',
        ercs: { engaging: true, relevant: true, challenging: true, significant: true },
        comment: {}
      },
      {
        text: '공동체의 문제는 여러 원인에서 생기며, 구성원이 의견을 모아 해결 방법을 정한다.',
        note: '문제의 원인(인과)과 함께 정하는 과정을 축으로 잡았다.',
        ercs: { engaging: true, relevant: true, challenging: false, significant: true },
        comment: { challenging: '원인을 찾는 데서 멈추면 이미 아는 내용의 확인에 그칠 수 있다.' }
      },
      {
        text: '한 사람의 선택과 참여는 함께 사는 곳의 모습을 바꾼다.',
        note: '개인의 참여가 공동체에 미치는 영향을 축으로 잡았다.',
        ercs: { engaging: true, relevant: false, challenging: true, significant: true },
        comment: { relevant: '학생이 직접 참여해 본 경험이 적다면 앞선 배움과 잇는 다리가 필요하다.' }
      }
    ],

    related: ['합의', '공공성', '협력', '자치', '갈등 조정'],
    review: '고르신 인과 관계·기능·책임은 중심 아이디어의 세 부분(문제가 생기는 까닭, 나누어 맡는 역할, 책임 있는 참여)과 하나씩 맞물려 보입니다. ' +
            '다만 성취기준에 토의가 들어 있어, 서로 다른 생각을 견주는 관점이 탐구 중에 자연스럽게 드러날 수 있습니다. 그 부분을 기타 개념으로 받칠지는 선생님이 판단해 주세요.',

    lines: [
      { text: '우리 동네에 문제가 생기는 까닭', concepts: ['causation'] },
      { text: '문제를 해결하는 기관과 주민이 맡는 역할', concepts: ['function'] },
      { text: '더 나은 동네를 위한 우리의 책임 있는 참여', concepts: ['responsibility'] }
    ],

    questions: [
      {
        teacher: [
          { type: '사실', text: '우리 동네에서 사람들이 불편하다고 말하는 일에는 어떤 것이 있나요?' },
          { type: '형성', way: '나누어 보기', text: '찾은 문제들을 두 무리로 나눈다면 어떤 기준으로 나눌 수 있을까요?' },
          { type: '개념', text: '함께 사는 곳에서 문제는 왜 생기나요?' },
          { type: '논쟁', text: '동네의 문제는 문제를 일으킨 사람만의 잘못일까요?' }
        ],
        student: ['왜 우리 동네 놀이터에는 쓰레기가 많아요?', '불편한 걸 누구한테 말해야 고쳐 줘요?']
      },
      {
        teacher: [
          { type: '사실', text: '동네의 문제를 해결하는 일에는 누가 참여하나요?' },
          { type: '형성', way: '공통점 찾기', text: '문제를 해결한 여러 사례에서 함께 나타나는 점은 무엇인가요?' },
          { type: '개념', text: '역할을 나누는 일은 문제 해결에 어떤 영향을 주나요?' },
          { type: '논쟁', text: '동네의 문제는 기관이 해결해야 할까요, 주민이 해결해야 할까요?' }
        ],
        student: ['공공 기관은 하루 종일 무슨 일을 해요?', '어린이가 말해도 들어줘요?']
      },
      {
        teacher: [
          { type: '사실', text: '우리 또래가 동네를 위해 실제로 한 일에는 어떤 것이 있나요?' },
          { type: '형성', way: '경계 시험하기', text: '시켜서 한 일도 참여라고 할 수 있을까요? 왜 그런가요?' },
          { type: '개념', text: '책임 있는 참여는 함께 사는 곳을 어떻게 바꾸나요?' },
          { type: '논쟁', text: '나와 상관없어 보이는 문제에도 참여해야 할까요?' }
        ],
        student: ['우리가 뭘 하면 진짜 동네가 바뀌어요?', '하기 싫은 사람도 꼭 같이 해야 해요?']
      }
    ],

    assessment: {
      diagnostic: '우리 동네 하면 떠오르는 불편한 점과 그 까닭을 생각 그물로 적게 한다. 문제의 원인을 한 사람의 잘못으로만 보는지, 해결을 어른만의 일로 여기는지 살핀다.',
      formative: [
        '동네 문제 하나를 골라 원인과 결과를 잇는 까닭 지도를 그리고, 원인이 둘 이상임을 설명하게 한다.',
        '문제 해결 사례를 읽고 기관과 주민이 맡은 일을 역할 표로 정리한 뒤, 역할이 빠지면 어떻게 되는지 말하게 한다.',
        '모둠 토의에서 내가 할 수 있는 참여 방법을 제안하고, 그 방법이 책임 있는 참여인 까닭을 한 문단으로 쓰게 한다.'
      ],
      summative: '우리 동네의 문제 하나를 골라 원인을 밝히고, 누가 어떤 역할을 맡아 해결할지 담은 제안서를 써서 동네 회의 형식으로 발표한다. 제안에는 내가 맡을 참여 약속이 들어간다.',
      criteria: {
        knowledge: '지역 문제의 사례와 원인, 문제 해결에 참여하는 기관과 주민의 역할을 안다.',
        understanding: '함께 사는 곳의 문제는 사람들이 역할을 나누고 책임 있게 참여할 때 해결된다는 것을 이해한다.',
        skills: '자료를 조사해 원인을 정리하고, 의견과 까닭이 드러나게 제안하는 글을 쓰며, 근거를 들어 토의한다.'
      }
    },

    frames: {
      grasps: {
        goal: '우리 동네의 문제 하나를 해결할 방법을 제안해 듣는 사람의 동의를 얻는다.',
        role: '동네 문제를 조사한 어린이 주민 대표',
        audience: '동네 회의에 모인 주민과 공공 기관 담당자',
        situation: '동네 회의에서 올해 먼저 해결할 문제를 하나 정하려고 한다.',
        product: '문제의 원인과 역할 나눔, 나의 참여 약속을 담은 제안서와 3분 발표',
        standards: '원인이 자료로 뒷받침되고, 역할이 구체적이며, 의견과 까닭이 분명해야 한다.'
      },
      rafts: {
        role: '동네 문제를 조사한 어린이 주민',
        audience: '같은 동네에 사는 이웃',
        format: '제안하는 글과 짧은 발표',
        topic: '우리 동네에서 먼저 해결할 문제와 함께 맡을 역할',
        strong: '설득한다'
      }
    },

    /* 탐구 과정 활동 — 단계 id 기준. 마샬·프렌치 기준으로 쓰고 머독 단계는 아래 MAP으로 잇는다. */
    acts: {
      intro: {
        engage: [{ text: '동네 사진 속 불편한 장면을 보고 보이는 것과 궁금한 것을 나누며 단원을 연다.', hours: 2, atl: ['thinking'], lp: ['inquirers'] }],
        focus: [{ text: '문제인 것과 아닌 것의 사례를 견주어 지역 문제의 뜻을 우리 말로 정리한다.', hours: 2, atl: ['thinking'], lp: ['thinkers'] }]
      },
      loop: [
        {
          investigate: [{ text: '동네를 걸으며 불편한 점을 사진과 메모로 모으고 주민에게 까닭을 묻는다.', hours: 3, atl: ['research'], lp: ['inquirers'] }],
          organize: [{ text: '모은 문제를 비슷한 것끼리 묶고 원인과 결과를 잇는 까닭 지도를 그린다.', hours: 2, atl: ['thinking'], lp: ['thinkers'] }],
          generalize: [{ text: '여러 문제의 까닭 지도를 견주어 문제가 생기는 까닭을 한 문장으로 세운다.', hours: 2, atl: ['thinking'], lp: [] }]
        },
        {
          investigate: [{ text: '문제 해결 사례를 읽고 공공 기관과 주민이 한 일을 조사한다.', hours: 3, atl: ['research'], lp: ['inquirers'] }],
          organize: [{ text: '누가 무엇을 맡았는지 역할 표로 정리하고 역할 하나가 빠진 경우를 따져 본다.', hours: 2, atl: ['thinking'], lp: ['thinkers'] }],
          generalize: [{ text: '사례들의 공통점에서 역할 나눔과 문제 해결의 관계를 문장으로 세운다.', hours: 2, atl: ['communication'], lp: [] }]
        },
        {
          investigate: [{ text: '또래가 동네를 바꾼 사례를 찾아 무엇을 어떻게 했는지 알아본다.', hours: 3, atl: ['research'], lp: ['inquirers'] }],
          organize: [{ text: '우리가 할 수 있는 참여 방법을 모아 실천 가능성과 영향으로 나누어 본다.', hours: 2, atl: ['thinking'], lp: ['principled'] }],
          generalize: [{ text: '책임 있는 참여가 동네를 어떻게 바꾸는지 토의하고 문장으로 세운다.', hours: 2, atl: ['communication'], lp: ['principled'] }]
        }
      ],
      outro: {
        transfer: [
          { text: '먼저 해결할 문제를 토의로 정하고 원인과 역할, 참여 약속을 담은 제안서를 쓴다.', hours: 4, atl: ['communication'], lp: ['thinkers'], action: ['advocacy'] },
          { text: '동네 회의 형식으로 제안을 발표하고 질문에 근거를 들어 답한다.', hours: 2, atl: ['communication'], lp: ['principled'], action: ['participation'] }
        ],
        reflect: [{ text: '단원을 여는 날의 생각 그물과 지금의 생각을 견주어 달라진 점과 나의 약속을 적는다.', hours: 2, atl: [], lp: ['principled'] }]
      }
    },

    ideas: {
      participation: [
        '학급 회의 시간에 우리 반이 함께 해결할 교실 문제를 하나 제안한다.',
        '쉬는 시간에 복도와 계단의 불편한 점을 찾아 학급 게시판에 적는다.',
        '등굣길에 본 동네의 불편한 점을 사진으로 찍어 아침 시간에 친구들에게 알린다.'
      ],
      advocacy: [
        '놀이터를 깨끗이 쓰자는 알림 글을 써서 학교 게시판에 붙인다.',
        '급식실 줄 서기 약속을 그림으로 그려 저학년 교실에 전한다.',
        '학생 자치 회의에 우리 반이 모은 의견을 글로 정리해 전한다.'
      ],
      socialJustice: [
        '놀이 시간에 함께하지 못하는 친구가 없는지 살피고 먼저 권한다.',
        '모둠에서 역할이 한 사람에게 몰리지 않게 돌아가며 맡자고 제안한다.',
        '학급 규칙 가운데 누군가에게 불편한 것이 없는지 회의에서 묻는다.'
      ],
      socialEntrepreneurship: [
        '쓰지 않는 학용품을 모아 필요한 친구가 가져가는 나눔 상자를 만든다.',
        '교실에서 나온 이면지를 모아 메모지 묶음으로 만들어 나눈다.',
        '학급 알뜰 장터를 열어 모은 것을 어디에 쓸지 회의로 정한다.'
      ],
      lifestyleChoices: [
        '하루 한 번 내가 쓴 자리를 스스로 정리하고 일주일 동안 기록한다.',
        '등하굣길에 쓰레기를 만들지 않도록 간식 포장을 집에서 덜어 온다.',
        '함께 쓰는 물건을 쓴 뒤 제자리에 두는 약속을 한 달 동안 지킨다.'
      ]
    },
    moments: [
      { where: '탐구 목록 1 · 조사하기', text: '동네를 걸으며 본 불편한 점을 다른 반 친구들에게도 알리고 싶어질 수 있다.' },
      { where: '탐구 목록 3 · 조직 및 정리하기', text: '모은 참여 방법 가운데 하나를 당장 해 보겠다고 스스로 정할 수 있다.' },
      { where: '단원 닫기 · 전이하기', text: '발표한 제안을 실제 동네 어른에게 전하고 싶다는 말이 나올 수 있다.' }
    ],

    connections: {
      priorThemes: '앞서 우리는 누구인가에서 다룬 나와 공동체의 관계를 이어받는다. 내가 속한 모둠과 학급에서 맡은 역할을 돌아본 경험 위에, 더 넓은 동네에서의 역할과 참여를 세운다.',
      otherSubjects: '도덕의 공동체 의식과 책임, 미술의 알리는 글과 그림 꾸미기와 맞닿는다. 수학의 자료 정리는 조사한 문제를 표와 그래프로 나타낼 때 쓰인다.',
      localGlobal: '학생이 날마다 다니는 길과 놀이터의 문제에서 출발한다. 살기 좋은 마을을 만들려는 노력은 세계 여러 곳에서 이루어지고 있어, 우리 동네의 참여가 더 큰 흐름과 이어짐을 볼 수 있다.'
    }
  };

  /* 머독 5단계 → 예시 활동 잇기 */
  var MURDOCH = {
    tuningIn: ['engage', 'focus'],
    findingOut: ['investigate'],
    sortingOut: ['organize', 'generalize'],
    goingFurther: ['transfer'],
    reflectingActing: ['reflect']
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function actsFor(block, stageId) {
    var src = block.kind === 'intro' ? EX.acts.intro
            : block.kind === 'outro' ? EX.acts.outro
            : EX.acts.loop[Math.min(Math.max(block.loi, 0), EX.acts.loop.length - 1)];
    var ids = src[stageId] ? [stageId] : (MURDOCH[stageId] || []);
    var out = [];
    ids.forEach(function (id) { (src[id] || []).forEach(function (a) { out.push(clone(a)); }); });
    // 머독 모델은 묶음 구성이 달라, 다른 묶음의 예시를 빌려 온다.
    if (!out.length) {
      [EX.acts.intro, EX.acts.outro].forEach(function (s) {
        ids.forEach(function (id) { (s[id] || []).forEach(function (a) { out.push(clone(a)); }); });
      });
    }
    return out;
  }

  /** 프롬프트를 보고 어느 단계의 요청인지 가려 예시 결과를 돌려준다. */
  function answer(prompt, state) {
    var p = String(prompt || '');
    if (p.indexOf('"picks"') >= 0) return { picks: clone(EX.picks) };
    if (p.indexOf('"candidates"') >= 0) return { candidates: clone(EX.candidates) };
    if (p.indexOf('"related"') >= 0) return { related: clone(EX.related), fit: true, review: EX.review };
    if (p.indexOf('"teacher"') >= 0) return { lines: clone(EX.questions) };
    if (p.indexOf('"lines"') >= 0) return { lines: clone(EX.lines) };
    if (p.indexOf('"diagnostic"') >= 0) return clone(EX.assessment);
    if (p.indexOf('"priorThemes"') >= 0) return clone(EX.connections);
    if (p.indexOf('"moments"') >= 0) {
      var ideas = {};
      (((state || {}).action || {}).types || []).forEach(function (id) {
        if (EX.ideas[id]) ideas[id] = clone(EX.ideas[id]);
      });
      return { ideas: ideas, moments: clone(EX.moments) };
    }
    if (p.indexOf('"items"') >= 0) {
      var items = [];
      ((((state || {}).inquiryPlan || {}).blocks) || []).forEach(function (b, bi) {
        (b.stages || []).forEach(function (sl) {
          items.push({ block: bi, stage: sl.id, activities: actsFor(b, sl.id) });
        });
      });
      return { items: items };
    }
    // 총괄평가 틀 채우기 (GRASPS / RAFTS)
    var frame = (((state || {}).assessment || {}).frame) || 'grasps';
    return clone(EX.frames[frame] || EX.frames.grasps);
  }

  function respond(prompt, state) {
    return new Promise(function (resolve) {
      setTimeout(function () { resolve(answer(prompt, state)); }, 900);
    });
  }

  /* ============================================================
   * 시작 · 끝내기
   * ============================================================ */
  function start() {
    var s = clone(window.PYP_DEMO_STATE || {});
    s.step = 1;
    ls(DRAFT, JSON.stringify(s));
    ls(FLAG, '1');
    location.reload();
  }
  function stop() {
    ls(FLAG, null);
    ls(DRAFT, null);
    location.reload();
  }

  /* ============================================================
   * 화면 — 안내 띠
   * ============================================================ */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }

  function paint() {
    var shell = document.querySelector('.shell');
    if (!shell || document.getElementById('demo-bar')) return;

    var bar = el('div', 'demo-bar');
    bar.id = 'demo-bar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', '예시 체험 안내');
    bar.setAttribute('data-on', active ? 'true' : 'false');

    var text = el('div', 'demo-bar__text');
    var btns = el('div', 'demo-bar__btns');

    if (active) {
      text.appendChild(el('strong', '', '예시로 체험하는 중'));
      text.appendChild(el('span', '', '4학년 「함께 만드는 우리 동네」 예시가 채워져 있습니다. 아래 [다음]을 눌러 8단계를 차례로 살펴보세요. ' +
        'AI 버튼을 누르면 실제 호출 대신 미리 준비한 예시 결과가 나옵니다.'));
      var again = el('button', 'btn', '처음부터 다시');
      again.type = 'button';
      again.addEventListener('click', start);
      var quit = el('button', 'btn btn--primary', '체험 끝내고 내 단원 설계하기');
      quit.type = 'button';
      quit.addEventListener('click', stop);
      btns.appendChild(again);
      btns.appendChild(quit);
    } else {
      text.appendChild(el('strong', '', '처음이신가요?'));
      text.appendChild(el('span', '', 'API 키 없이, 완성된 예시 단원으로 8단계를 먼저 둘러볼 수 있습니다. 작성 중인 설계안은 그대로 남습니다.'));
      var go = el('button', 'btn btn--primary', '예시로 체험하기');
      go.type = 'button';
      go.id = 'btn-demo-start';
      go.addEventListener('click', start);
      btns.appendChild(go);
    }

    bar.appendChild(text);
    bar.appendChild(btns);
    shell.parentNode.insertBefore(bar, shell);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', paint);
  else paint();

  window.PYP_DEMO = {
    active: active,
    draftKey: DRAFT,
    respond: respond,
    answer: answer,
    start: start,
    stop: stop
  };
})();
