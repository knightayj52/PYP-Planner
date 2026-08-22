/* ============================================================
 * PYP 탐구 단원 설계 도우미 v1.0
 * app.js — 골격 (화면 전환 · 상태 · 저장 · 대화 상자)
 *
 * 이 파일에서 지금 동작하는 것
 *   - 8단계 화면 전환과 진행 레일 갱신
 *   - 하드/소프트 검증 게이트의 연결부 (규칙은 단계 구현 때 등록)
 *   - API 키 저장·삭제, 테마, 임시 저장
 * 아직 비어 있는 것 (다음 작업에서 채움)
 *   - loadData()  : data/*.json 지연 로딩
 *   - callGemini(): 재시도 사다리 · JSON 3겹 방어선
 *   - exportDocx(): 경기도 실습 틀 구조 내보내기
 * ============================================================ */
(function () {
  'use strict';

  /* ---------- 상수 ---------- */
  var APP = {
    name: 'PYP 탐구 단원 설계 도우미',
    version: '1.0',
    lastStep: 8
  };

  var KEYS = {
    apiKey: 'pyp.apiKey',
    theme: 'pyp.theme',
    draft: 'pyp.draft',
    vault: 'pyp.vault'
  };

  /* ---------- 설계안 상태 ----------
   * 단계별 산출물을 한 객체에 모은다.
   * 내보내기와 검증 게이트는 모두 이 객체만 읽는다.
   */
  var state = {
    meta: { app: APP.name, version: APP.version, savedAt: null },
    step: 1,
    reached: 1,                 // 지금까지 도달한 최대 단계 (레일 잠금 해제 기준)

    grade: null,                // 1
    subjects: [],
    tonghapUnit: null,          // 1~2학년: { unit, area, bigIdea }
    theme: null,                // 초학문적 주제 id
    standards: [],

    coreIdeaRefs: [],           // 2
    centralIdea: '',
    ercs: {},                   // 교사가 확정한 판단
    ercsAi: null,               // AI가 짚어준 의견 (참고용, 교사 판단과 별도로 보관)

    keyConcepts: [],            // 3
    relatedConcepts: [],

    linesOfInquiry: [],         // 4  [{ text, concepts:[] }]

    teacherQuestions: [],       // 5
    studentQuestions: [],

    assessment: {               // 6
      diagnostic: '',
      formative: '',
      summative: '',
      grasps: null,
      criteria: { knowledge: '', understanding: '', skills: '' }
    },

    inquiryModel: null,         // 7  'murdoch' | 'marschall'
    inquiryStages: [],
    atl: [],
    learnerProfile: [],
    actionTypes: [],

    connections: {              // 8
      priorThemes: '',
      otherSubjects: '',
      localGlobal: ''
    }
  };

  /* ---------- 짧은 도우미 ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function store(key, value) {
    try {
      if (value === undefined) {
        var raw = localStorage.getItem(key);
        return raw === null ? null : JSON.parse(raw);
      }
      if (value === null) { localStorage.removeItem(key); return null; }
      localStorage.setItem(key, JSON.stringify(value));
      return value;
    } catch (e) {
      console.warn('저장소를 쓸 수 없습니다.', e);
      return null;
    }
  }

  /* ============================================================
   * 검증 게이트
   * 단계 구현 때 registerGuard(n, fn) 으로 규칙을 붙인다.
   * fn 은 { hard: [문자열], soft: [문자열] } 을 돌려준다.
   *   hard = 차단, soft = 확인 후 통과
   * ============================================================ */
  var guards = {};

  function registerGuard(step, fn) { guards[step] = fn; }

  function checkStep(step) {
    var fn = guards[step];
    if (typeof fn !== 'function') return { hard: [], soft: [] };
    var out = fn(state) || {};
    return { hard: out.hard || [], soft: out.soft || [] };
  }

  /* ============================================================
   * 화면 전환
   * ============================================================ */
  function renderStep(opts) {
    $$('.step').forEach(function (sec) {
      var n = Number(sec.dataset.step);
      if (n === state.step) sec.setAttribute('data-active', 'true');
      else sec.removeAttribute('data-active');
    });

    $$('.rail__item').forEach(function (li) {
      var n = Number(li.dataset.step);
      var btn = $('.rail__btn', li);
      if (n === state.step) li.dataset.state = 'current';
      else if (n <= state.reached) li.dataset.state = 'done';
      else li.dataset.state = 'locked';
      btn.disabled = n > state.reached;
      btn.setAttribute('aria-current', n === state.step ? 'step' : 'false');
    });

    // 레일 진행선: 1번 원 중심 ~ 현재 단계 원 중심
    var fill = $('#rail-fill');
    var items = $$('.rail__item');
    if (fill && items.length) {
      var first = items[0].getBoundingClientRect();
      var here = items[state.step - 1].getBoundingClientRect();
      fill.style.height = Math.max(0, (here.top - first.top)) + 'px';
    }

    $('#btn-prev').disabled = state.step === 1;
    $('#btn-next').textContent = state.step === APP.lastStep ? '내보내기' : '다음';
    setStatus('8단계 가운데 ' + state.step + '단계입니다.');

    if (opts && opts.scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function setStatus(text, tone) {
    var el = $('#stepnav-status');
    el.textContent = text;
    if (tone) el.dataset.tone = tone; else delete el.dataset.tone;
  }

  function goStep(n) {
    if (n < 1 || n > APP.lastStep) return;
    if (n > state.reached) return;
    state.step = n;
    saveDraft();
    renderStep({ scroll: true });
  }

  function goNext() {
    if (state.step === APP.lastStep) { exportDocx(); return; }

    var result = checkStep(state.step);
    if (result.hard.length) {
      setStatus(result.hard[0], 'stop');
      return;
    }
    if (result.soft.length) {
      askConfirm(result.soft, function () { advance(); });
      return;
    }
    advance();
  }

  function advance() {
    state.step += 1;
    state.reached = Math.max(state.reached, state.step);
    saveDraft();
    renderStep({ scroll: true });
    if (state.step === 2 && typeof S2 !== 'undefined') S2.repaint();
  }

  /* ============================================================
   * 임시 저장
   * ============================================================ */
  function saveDraft() {
    state.meta.savedAt = new Date().toISOString();
    store(KEYS.draft, state);
  }

  function loadDraft() {
    var saved = store(KEYS.draft);
    if (!saved || typeof saved !== 'object') return;
    Object.keys(saved).forEach(function (k) {
      if (k in state) state[k] = saved[k];
    });
    state.reached = Math.min(Math.max(state.reached || 1, 1), APP.lastStep);
    state.step = Math.min(Math.max(state.step || 1, 1), state.reached);
  }

  /* ============================================================
   * 대화 상자
   * ============================================================ */
  function openDialog(id) {
    var dlg = $(id);
    if (dlg && typeof dlg.showModal === 'function') dlg.showModal();
  }
  function closeDialog(id) {
    var dlg = $(id);
    if (dlg && dlg.open) dlg.close();
  }

  var confirmCallback = null;

  function askConfirm(messages, onProceed) {
    var list = $('#confirm-list');
    list.innerHTML = '';
    messages.forEach(function (m) {
      var li = document.createElement('li');
      li.textContent = m;
      list.appendChild(li);
    });
    $('#confirm-desc').textContent = '아래 내용을 의도하신 것이라면 그대로 진행할 수 있습니다.';
    confirmCallback = onProceed;
    openDialog('#dlg-confirm');
  }

  /* ============================================================
   * API 키
   * ============================================================ */
  function getApiKey() { return store(KEYS.apiKey) || ''; }

  function paintKeyState() {
    var has = !!getApiKey();
    $('#key-dot').dataset.state = has ? 'set' : 'unset';
    $('#btn-key').title = has ? 'API 키가 등록되어 있습니다' : 'API 키를 등록해 주세요';
  }

  function keyMessage(text, tone) {
    var el = $('#key-msg');
    if (!text) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = text;
    el.className = 'notice notice--' + (tone || 'info');
  }

  function saveApiKey() {
    var value = $('#key-input').value.trim();
    if (!value) { keyMessage('키를 입력해 주세요.', 'stop'); return; }
    if (value.length < 20) {
      keyMessage('키가 너무 짧습니다. AI Studio에서 복사한 키 전체를 붙여넣어 주세요.', 'stop');
      return;
    }
    var btn = $('#btn-key-save');
    btn.disabled = true;
    keyMessage('키를 확인하는 중입니다…', 'info');

    verifyApiKey(value).then(function (status) {
      btn.disabled = false;
      if (status === 'invalid') {
        keyMessage('키가 받아들여지지 않았습니다. Google AI Studio에서 키를 다시 복사해 주세요.', 'stop');
        return;
      }
      store(KEYS.apiKey, value);
      paintKeyState();
      if (status === 'quota') {
        keyMessage('키를 저장했습니다. 다만 지금은 호출 한도 상태라 잠시 뒤부터 쓸 수 있습니다.', 'warn');
      } else if (status === 'network') {
        keyMessage('키를 저장했습니다. 인터넷 연결이 불안정해 확인은 못 했습니다.', 'warn');
      } else {
        keyMessage('키를 저장했고 연결도 확인했습니다.', 'info');
      }
    })['catch'](function (e) {
      btn.disabled = false;
      keyMessage('확인 중 문제가 생겼습니다. ' + msgOf(e), 'stop');
    });
  }

  function clearApiKey() {
    store(KEYS.apiKey, null);
    $('#key-input').value = '';
    paintKeyState();
    keyMessage('키를 지웠습니다.', 'warn');
  }

  /* ============================================================
   * 보관함 (목록 표시만 — 저장·불러오기는 다음 작업)
   * ============================================================ */
  function renderVault() {
    var items = store(KEYS.vault) || [];
    var list = $('#vault-list');
    var empty = $('#vault-empty');
    list.innerHTML = '';
    empty.hidden = items.length > 0;
    items.forEach(function (it) {
      var li = document.createElement('li');
      li.textContent = (it.title || '제목 없음');
      list.appendChild(li);
    });
  }

  /* ============================================================
   * 아직 비어 있는 계층
   * ============================================================ */

  /** data/*.json 지연 로딩 + 캐시. 다음 작업에서 구현. */
  var dataCache = {};
  function loadData(name) {          // eslint-disable-line no-unused-vars
    if (dataCache[name]) return Promise.resolve(dataCache[name]);
    return fetch('data/' + name + '.json')
      .then(function (r) {
        if (!r.ok) throw new Error(name + '.json 을 불러오지 못했습니다.');
        return r.json();
      })
      .then(function (json) { dataCache[name] = json; return json; });
  }

  /* ------------------------------------------------------------
   * Gemini 계층
   *   호출 사다리 : 기본 모델 → (429·503) 5초 뒤 1회 재시도 → 폴백 모델
   *   JSON 방어선 : ① 형식 규칙 자동 첨부 ② 따옴표 무손실 수선
   *                 ③ 절단 복구 → 그래도 안 되면 같은 요청 1회 재시도
   * ------------------------------------------------------------ */
  var GEMINI = {
    model: 'gemini-3.5-flash',
    fallback: 'gemini-3.1-flash-lite',
    version: 'v1beta',
    temperature: 0.7,
    maxTokens: 8192
  };

  // 모든 프롬프트 끝에 붙는다 — JSON 문자열 안 큰따옴표가 깨짐의 주범이라 원천 차단한다.
  var JSON_RULE = '\n[형식 규칙] JSON 문자열 값 안에 큰따옴표(")를 절대 쓰지 마. ' +
                  '인용·대사·강조가 필요하면 작은따옴표나 낫표(『 』)를 사용해.';

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function msgOf(e) { return (e && e.message) ? e.message : String(e || ''); }
  function isQuota(e) { return msgOf(e).indexOf('QUOTA_') === 0; }
  function isOverload(e) { return msgOf(e).indexOf('OVERLOADED') === 0; }
  function isParseFail(e) { return msgOf(e).indexOf('JSON 파싱 실패') === 0; }
  function isDailyBody(b) { return /per\s*day|perday|daily/i.test(String(b || '')); }

  function geminiUrl(model, key) {
    return 'https://generativelanguage.googleapis.com/' + GEMINI.version +
           '/models/' + model + ':generateContent?key=' + encodeURIComponent(key);
  }

  function postGemini(url, payload) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.text().then(function (body) { return { code: res.status, body: body }; });
    }, function () {
      throw new Error('인터넷 연결이 끊겼거나 Gemini에 닿지 못했습니다. 연결을 확인하고 다시 눌러 주세요.');
    });
  }

  function extractText(data) {
    if (!data || !data.candidates || !data.candidates.length) return '';
    var c = data.candidates[0];
    if (!c.content || !c.content.parts) return '';
    var out = '';
    c.content.parts.forEach(function (p) { if (p.text) out += p.text; });
    return out;
  }

  function callModel(model, prompt, schema) {
    var key = getApiKey();
    if (!key) return Promise.reject(new Error('먼저 오른쪽 위에서 API 키를 등록해 주세요.'));

    var url = geminiUrl(model, key);
    var cfg = {
      responseMimeType: 'application/json',
      temperature: GEMINI.temperature,
      maxOutputTokens: GEMINI.maxTokens
    };
    if (schema) cfg.responseSchema = schema;
    var payload = { contents: [{ parts: [{ text: prompt + JSON_RULE }] }], generationConfig: cfg };

    return postGemini(url, payload).then(function (r) {
      // 순간 몰림(분당 429)·일시 혼잡(503)은 5초 쉬고 한 번만 자동 재시도
      if ((r.code === 429 && !isDailyBody(r.body)) || r.code === 503) {
        return sleep(5000).then(function () { return postGemini(url, payload); });
      }
      return r;
    }).then(function (r) {
      if (r.code === 429) throw new Error((isDailyBody(r.body) ? 'QUOTA_DAILY' : 'QUOTA_MINUTE') + ' (' + model + ')');
      if (r.code === 503) throw new Error('OVERLOADED (' + model + ')');
      if (r.code === 400 || r.code === 403) {
        throw new Error('API 키가 거부되었습니다. 오른쪽 위에서 키를 다시 등록해 주세요.');
      }
      if (r.code !== 200) {
        throw new Error('Gemini 오류 (HTTP ' + r.code + '): ' + String(r.body || '').substring(0, 400));
      }

      var data = JSON.parse(r.body);
      var text = extractText(data);
      if (!text) {
        var why = '';
        if (data.candidates && data.candidates[0] && data.candidates[0].finishReason) {
          why = ' (중단 사유: ' + data.candidates[0].finishReason + ')';
        } else if (data.promptFeedback && data.promptFeedback.blockReason) {
          why = ' (차단 사유: ' + data.promptFeedback.blockReason + ')';
        }
        throw new Error('Gemini가 빈 응답을 보냈습니다' + why + '. 다시 눌러 주세요.');
      }

      try { return parseJson(text); }
      catch (pe) {
        var fixed = repairJson(text);
        if (fixed !== null) return fixed;   // 잘린 꼬리를 정리해 온전한 부분까지 살린다
        throw pe;
      }
    });
  }

  function callLadder(prompt, schema) {
    return callModel(GEMINI.model, prompt, schema)['catch'](function (e) {
      if (!isQuota(e) && !isOverload(e)) throw e;
      return callModel(GEMINI.fallback, prompt, schema)['catch'](function (e2) {
        if (isQuota(e2)) {
          if ((msgOf(e) + ' ' + msgOf(e2)).indexOf('QUOTA_MINUTE') !== -1) {
            throw new Error('요청이 잠깐 몰렸습니다(분당 한도). 1분쯤 뒤에 같은 버튼을 다시 눌러 주세요. 작성한 내용은 저장되어 있습니다.');
          }
          throw new Error('오늘 치 무료 호출 한도를 다 썼습니다. 한국 시간 오후 4시쯤 다시 채워집니다. 작성한 내용은 저장되어 있습니다.');
        }
        if (isOverload(e2)) {
          throw new Error('Gemini 서버가 혼잡합니다. 잠시 뒤 같은 버튼을 다시 눌러 주세요. 작성한 내용은 저장되어 있습니다.');
        }
        throw e2;
      });
    });
  }

  /** 생성 요청 입구. 형식이 어긋나면 같은 요청을 딱 한 번 다시 보낸다. */
  function callGemini(prompt, schema) {
    return callLadder(prompt, schema)['catch'](function (e) {
      if (isParseFail(e)) return callLadder(prompt, schema);
      throw e;
    });
  }

  /* ---- JSON 방어선 ---- */
  function stripFence(t) {
    return String(t).trim()
      .replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();
  }

  function parseJson(text) {
    var t = stripFence(text);
    try { return JSON.parse(t); }
    catch (e) {
      throw new Error('JSON 파싱 실패: ' + e + '\n원문(앞 400자): ' + t.substring(0, 400));
    }
  }

  /** 문자열 값 안의 이스케이프 안 된 따옴표를 살려 낸다(무손실 수선). */
  function fixQuotes(t) {
    var out = '', inStr = false, esc = false;
    for (var i = 0; i < t.length; i++) {
      var c = t.charAt(i);
      if (!inStr) { if (c === '"') inStr = true; out += c; continue; }
      if (esc) { esc = false; out += c; continue; }
      if (c === '\\') { esc = true; out += c; continue; }
      if (c === '"') {
        var j = i + 1;
        while (j < t.length && /\s/.test(t.charAt(j))) j++;
        var nx = j < t.length ? t.charAt(j) : '';
        if (nx === ',' || nx === '}' || nx === ']' || nx === ':' || nx === '') { inStr = false; out += c; }
        else { out += '\\"'; }
        continue;
      }
      out += c;
    }
    return out;
  }

  /** 열린 괄호를 세어 닫아 준다. 구조가 어긋나면 null. */
  function closeBrackets(s) {
    var stack = [], inStr = false, esc = false;
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{' || c === '[') stack.push(c);
      else if (c === '}') { if (stack.pop() !== '{') return null; }
      else if (c === ']') { if (stack.pop() !== '[') return null; }
    }
    if (inStr) return null;
    var tail = '';
    for (var j = stack.length - 1; j >= 0; j--) tail += (stack[j] === '{' ? '}' : ']');
    return s + tail;
  }

  /** 끝이 잘린 응답에서 온전한 부분까지 살린다. 너무 많이 잃으면 포기하고 재시도에 맡긴다. */
  function repairJson(text) {
    var t = stripFence(text);
    try { return JSON.parse(fixQuotes(t)); } catch (e0) { /* 다음 수단으로 */ }
    var tries = 0;
    for (var cut = t.length; cut > 1 && tries < 400; cut--) {
      var ch = t.charAt(cut - 1);
      if (ch !== '}' && ch !== ']') continue;   // 완결된 경계에서만 자른다
      tries++;
      var closed = closeBrackets(t.substring(0, cut).replace(/,\s*$/, ''));
      if (closed === null) continue;
      try {
        var obj = JSON.parse(closed);
        if (JSON.stringify(obj).length < t.length * 0.6) return null;
        return obj;
      } catch (e) { /* 다음 절단점 */ }
    }
    return null;
  }

  /** 키가 살아 있는지 가볍게 확인한다. 'ok' | 'quota' | 'invalid' */
  function verifyApiKey(key) {
    var url = geminiUrl(GEMINI.fallback, key);
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'ping' }] }], generationConfig: { maxOutputTokens: 1 } })
    }).then(function (res) {
      if (res.status === 200) return 'ok';
      if (res.status === 429 || res.status === 503) return 'quota';
      return 'invalid';
    }, function () { return 'network'; });
  }

  /** 워드 내보내기. 경기도 실습 틀 구조로 다음 작업에서 구현. */
  function exportDocx() {
    setStatus('내보내기는 다음 작업에서 붙입니다.', 'stop');
  }

  /* ============================================================
   * 1단계 — 학년 · 단원/교과 · 초학문적 주제 · 성취기준
   *   1~2학년 : 통합교과 단원이 중심, 국어·수학을 더할 수 있음
   *   3~6학년 : 교과 2~4개를 골라 성취기준 풀을 합침
   * ============================================================ */
  var S1 = (function () {
    var fw = null;        // pyp-framework.json
    var pool = null;      // standards-e**.json
    var units = null;     // tonghap.json 의 units

    var TONGHAP_ONLY = ['바른 생활', '슬기로운 생활', '즐거운 생활'];
    var CODE_SUBJECT = { '바': '바른 생활', '슬': '슬기로운 생활', '즐': '즐거운 생활' };
    var AREA_THEME = {
      '01': ['whoWeAre'],
      '02': ['whereWeAre'],
      '03': ['howTheWorldWorks', 'howWeOrganize'],
      '04': ['howWeExpress']
    };
    var SUBJECT_MAX = 4;

    /* ---- 작은 도우미 ---- */
    function esc(v) {
      return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
    }
    function bandFile(g) {
      return g <= 2 ? 'standards-e12' : (g <= 4 ? 'standards-e34' : 'standards-e56');
    }
    function isTonghapName(n) { return TONGHAP_ONLY.indexOf(n) >= 0; }
    function areaNo(a) { return String(a || '').slice(0, 2); }
    function stripCode(t) { return String(t || '').replace(/^\[[^\]]+\]\s*/, ''); }
    function extraSubjects() {
      return (state.subjects || []).filter(function (n) { return !isTonghapName(n); });
    }
    /** 코드 비교용 정규화 — AI가 대괄호를 빼거나 공백을 넣어도 같은 것으로 본다. */
    function normCode(c) {
      return String(c == null ? '' : c).replace(/[\[\]\s·．.]/g, '').toUpperCase();
    }
    function hasStd(code) {
      var k = normCode(code);
      return (state.standards || []).some(function (x) { return normCode(x.code) === k; });
    }
    function addStd(o) { if (!hasStd(o.code)) state.standards.push(o); }
    function dropStd(code) {
      var k = normCode(code);
      state.standards = (state.standards || []).filter(function (x) { return normCode(x.code) !== k; });
    }
    function msg(text, tone) {
      var el = $('#s1-msg');
      if (!el) return;
      if (!text) { el.hidden = true; return; }
      el.hidden = false;
      el.textContent = text;
      el.className = 'notice notice--' + (tone || 'info');
    }

    /* ---- 성취기준 정규화 ---- */
    function fromPool(raw) {
      return {
        code: raw.code,
        subject: raw.subject,
        domain: raw.domain,
        text: stripCode(raw.text),
        levels: raw.levels || null,
        from: 'standards'
      };
    }
    function fromUnit(raw, unitName) {
      return {
        code: raw.code,
        subject: CODE_SUBJECT[String(raw.code).charAt(2)] || '통합교과',
        domain: unitName,
        text: stripCode(raw.statement),
        levels: { A: raw.levelA, B: raw.levelB, C: raw.levelC },
        from: 'tonghap'
      };
    }

    /* ---- 데이터 ---- */
    function ensure() {
      var g = state.grade;
      var jobs = [loadData('pyp-framework'), loadData(bandFile(g))];
      if (g <= 2) jobs.push(loadData('tonghap'));
      return Promise.all(jobs).then(function (r) {
        fw = r[0];
        pool = r[1];
        if (g <= 2) units = (r[2] && r[2].units) || [];
        return true;
      });
    }
    function poolSubjects() {
      var seen = {}, out = [];
      ((pool && pool.standards) || []).forEach(function (s) {
        if (isTonghapName(s.subject)) return;
        if (!seen[s.subject]) { seen[s.subject] = 1; out.push(s.subject); }
      });
      return out;
    }
    function subjectStandards(name) {
      return ((pool && pool.standards) || [])
        .filter(function (s) { return s.subject === name; })
        .map(fromPool);
    }
    function unitList(grade) {
      return (units || []).filter(function (u) { return String(u.grade) === String(grade); });
    }
    function findUnit(name) {
      var hit = null;
      (units || []).forEach(function (u) { if (u.unit === name) hit = u; });
      return hit;
    }

    /* ---- 그리기 ---- */
    function paintGrades() {
      var h = '';
      for (var g = 1; g <= 6; g++) {
        h += '<button class="chip" type="button" data-act="grade" data-v="' + g + '"' +
             ' aria-pressed="' + (state.grade === g ? 'true' : 'false') + '">' + g + '학년</button>';
      }
      $('#s1-grades').innerHTML = h;
    }

    function paintScope() {
      var box = $('#s1-scope');
      if (!state.grade) { box.hidden = true; box.innerHTML = ''; return; }
      box.hidden = false;
      box.innerHTML = state.grade <= 2 ? scopeTonghap() : scopeSubjects();
    }

    function scopeTonghap() {
      var list = unitList(state.grade);
      var byArea = [], seen = {};
      list.forEach(function (u) {
        if (!seen[u.area]) { seen[u.area] = []; byArea.push(u.area); }
        seen[u.area].push(u);
      });

      var h = '<h3 class="block__title"><span class="block__ord">2</span>통합교과 단원 고르기</h3>' +
              '<p class="block__hint">단원 하나가 바른 생활 · 슬기로운 생활 · 즐거운 생활 성취기준을 한 주제로 묶습니다. 단원을 고르면 그 세 가지가 자동으로 담깁니다.</p>';

      byArea.forEach(function (area) {
        h += '<p class="block__sub">' + esc(area) + '</p><div class="cards">';
        seen[area].forEach(function (u) {
          var on = state.tonghapUnit && state.tonghapUnit.unit === u.unit;
          h += '<button class="pick" type="button" data-act="unit" data-v="' + esc(u.unit) + '"' +
               ' aria-pressed="' + (on ? 'true' : 'false') + '">' +
               '<span class="pick__top"><span class="pick__name">' + esc(u.unit) + '</span>' +
               (u.fix === '고정' ? '<span class="tag tag--fix">고정</span>' : '') +
               '</span>' +
               '<span class="pick__meta">' + esc(u.term) + '학기 · ' + esc(u.month) + '월</span>' +
               '<span class="pick__idea">' + esc(String(u.bigIdea).replace(/^[0-9-]+\.\s*/, '')) + '</span>' +
               '</button>';
        });
        h += '</div>';
      });

      var extras = extraSubjects();
      h += '<p class="block__sub">교과 더하기 (고르지 않아도 됩니다)</p>' +
           '<p class="block__hint" style="margin-left:0">단원과 함께 운영할 교과가 있으면 고르세요. 그 교과의 성취기준 목록이 아래에 함께 나타납니다.</p>' +
           '<div class="chips">';
      poolSubjects().forEach(function (name) {
        h += '<button class="chip" type="button" data-act="subject" data-v="' + esc(name) + '"' +
             ' aria-pressed="' + (extras.indexOf(name) >= 0 ? 'true' : 'false') + '">' + esc(name) + '</button>';
      });
      h += '</div>';
      return h;
    }

    function scopeSubjects() {
      var picked = state.subjects || [];
      var h = '<h3 class="block__title"><span class="block__ord">2</span>교과 고르기</h3>' +
              '<p class="block__hint">초학문적 탐구이므로 교과를 2개에서 4개까지 함께 고릅니다. 지금 ' +
              picked.length + '개를 골랐습니다.</p><div class="chips">';
      poolSubjects().forEach(function (name) {
        h += '<button class="chip" type="button" data-act="subject" data-v="' + esc(name) + '"' +
             ' aria-pressed="' + (picked.indexOf(name) >= 0 ? 'true' : 'false') + '">' + esc(name) + '</button>';
      });
      return h + '</div>';
    }

    function paintThemes() {
      var box = $('#s1-theme');
      var ready = state.grade && (state.grade <= 2 ? !!state.tonghapUnit : (state.subjects || []).length > 0);
      if (!ready || !fw) { box.hidden = true; box.innerHTML = ''; return; }
      box.hidden = false;

      var rec = [];
      if (state.grade <= 2 && state.tonghapUnit) {
        rec = AREA_THEME[areaNo(state.tonghapUnit.area)] || [];
      }
      var h = '<h3 class="block__title"><span class="block__ord">3</span>초학문적 주제 고르기</h3>' +
              '<p class="block__hint">' +
              (rec.length
                ? '고르신 단원과 결이 가까운 주제에 추천 표시를 붙였습니다. 다른 주제를 고르셔도 됩니다.'
                : '이 단원이 어떤 큰 물음 아래 놓이는지 정합니다.') +
              '</p><div class="cards">';

      (fw.transdisciplinaryThemes || []).forEach(function (t) {
        var on = state.theme === t.id;
        h += '<button class="pick" type="button" data-act="theme" data-v="' + esc(t.id) + '"' +
             ' aria-pressed="' + (on ? 'true' : 'false') + '">' +
             '<span class="pick__top"><span class="pick__name">' + esc(t.ko) + '</span>' +
             (rec.indexOf(t.id) >= 0 ? '<span class="tag tag--rec">추천</span>' : '') +
             '</span><span class="pick__meta">' + esc(t.en) + '</span><ul class="pick__list">';
        (t.descriptors || []).forEach(function (d) { h += '<li>' + esc(d) + '</li>'; });
        return h += '</ul></button>';
      });
      box.innerHTML = h + '</div>';
    }

    function stdRow(o) {
      return '<label class="std">' +
             '<input type="checkbox" data-code="' + esc(o.code) + '"' + (hasStd(o.code) ? ' checked' : '') + '>' +
             '<span class="std__code">' + esc(o.code) + '</span>' +
             '<span class="std__text">' + esc(o.text) + '</span></label>';
    }

    function stdGroup(title, list, openIt) {
      var byDom = [], seen = {};
      list.forEach(function (o) {
        if (!seen[o.domain]) { seen[o.domain] = []; byDom.push(o.domain); }
        seen[o.domain].push(o);
      });
      var picked = list.filter(function (o) { return hasStd(o.code); }).length;
      var h = '<details class="group" data-key="' + esc(title) + '"' + (openIt ? ' open' : '') +
              '><summary>' + esc(title) +
              '<span class="group__count">' + picked + ' / ' + list.length + '</span></summary>';
      byDom.forEach(function (d) {
        if (byDom.length > 1 || d !== title) h += '<p class="group__dom">' + esc(d) + '</p>';
        seen[d].forEach(function (o) { h += stdRow(o); });
      });
      return h + '</details>';
    }

    var openKeys = null;   // 다시 그려도 펼친 교과가 접히지 않게 기억해 둔다

    function rememberOpen() {
      var box = $('#s1-std');
      if (!box || box.hidden) return;
      var found = [];
      $$('.group[open]', box).forEach(function (d) {
        var k = d.getAttribute('data-key');
        if (k) found.push(k);
      });
      openKeys = found;
    }

    function paintStd() {
      var box = $('#s1-std');
      var ready = state.grade && (state.grade <= 2 ? !!state.tonghapUnit : (state.subjects || []).length > 0);
      if (!ready) { box.hidden = true; box.innerHTML = ''; return; }
      box.hidden = false;

      var n = (state.standards || []).length;
      var h = '<h3 class="block__title"><span class="block__ord">4</span>성취기준 고르기</h3>' +
              '<p class="block__hint">이 단원에서 실제로 다룰 성취기준만 남겨 주세요. 나중 단계에서 중심 아이디어와 평가의 근거가 됩니다.</p>' +
              '<div class="rowbtns">' +
              '<button class="btn" type="button" data-act="ai">주제에 맞는 성취기준 추천받기</button>' +
              '<span class="count">고른 성취기준 <strong>' + n + '</strong>개</span></div>' +
              '<p class="notice notice--info" id="s1-msg" hidden></p>';

      if (state.grade <= 2 && state.tonghapUnit) {
        var u = findUnit(state.tonghapUnit.unit);
        if (u) {
          h += stdGroup('통합교과 · ' + u.unit,
                        (u.standards || []).map(function (r) { return fromUnit(r, u.unit); }), true);
        }
      }
      var subs = state.grade <= 2 ? extraSubjects() : (state.subjects || []);
      subs.forEach(function (name) {
        var list = subjectStandards(name);
        if (list.length) h += stdGroup(name, list, subs.length <= 2);
      });

      box.innerHTML = h;
      if (openKeys) {
        $$('.group', box).forEach(function (d) {
          d.open = openKeys.indexOf(d.getAttribute('data-key')) >= 0;
        });
      }
    }

    function paintAll() {
      rememberOpen();
      paintGrades(); paintScope(); paintThemes(); paintStd();
      saveDraft();
    }

    /* ---- 조작 ---- */
    function pickGrade(g) {
      if (state.grade === g) return;
      state.grade = g;
      state.subjects = [];
      state.tonghapUnit = null;
      state.theme = null;
      state.standards = [];
      setStatus('성취기준을 불러오는 중입니다…');
      ensure().then(function () {
        setStatus('8단계 가운데 1단계입니다.');
        paintAll();
      })['catch'](function (e) {
        setStatus('데이터를 불러오지 못했습니다. ' + e.message, 'stop');
      });
    }

    function pickUnit(name) {
      var u = findUnit(name);
      if (!u) return;
      // 단원을 바꾸면 이전 단원의 성취기준만 걷어내고 새 단원 것으로 채운다.
      state.standards = (state.standards || []).filter(function (x) { return x.from !== 'tonghap'; });
      state.tonghapUnit = { unit: u.unit, area: u.area, bigIdea: u.bigIdea };
      (u.standards || []).forEach(function (r) { addStd(fromUnit(r, u.unit)); });
      var keep = extraSubjects();
      state.subjects = TONGHAP_ONLY.concat(keep);
      openKeys = null;
      paintAll();
    }

    function pickSubject(name) {
      var list = (state.subjects || []).slice();
      var at = list.indexOf(name);
      if (at >= 0) {
        list.splice(at, 1);
        state.standards = (state.standards || []).filter(function (x) { return x.subject !== name; });
      } else {
        if (state.grade > 2 && list.length >= SUBJECT_MAX) {
          setStatus('교과는 ' + SUBJECT_MAX + '개까지 고를 수 있습니다. 하나를 빼고 다시 골라 주세요.', 'stop');
          return;
        }
        list.push(name);
      }
      state.subjects = list;
      openKeys = null;
      setStatus('8단계 가운데 1단계입니다.');
      paintAll();
    }

    function pickTheme(id) {
      state.theme = (state.theme === id) ? null : id;
      paintAll();
    }

    function updateCounts() {
      var box = $('#s1-std');
      if (!box || box.hidden) return;
      var total = $('.count strong', box);
      if (total) total.textContent = (state.standards || []).length;
      $$('.group', box).forEach(function (d) {
        var all = $$('input[data-code]', d);
        var on = all.filter(function (i) { return i.checked; }).length;
        var lbl = $('.group__count', d);
        if (lbl) lbl.textContent = on + ' / ' + all.length;
      });
      saveDraft();
    }

    function toggleStd(code, on) {
      if (!on) { dropStd(code); updateCounts(); return; }
      var k = normCode(code);
      var found = null;
      if (state.grade <= 2 && state.tonghapUnit) {
        var u = findUnit(state.tonghapUnit.unit);
        (u && u.standards || []).forEach(function (r) {
          if (normCode(r.code) === k) found = fromUnit(r, u.unit);
        });
      }
      if (!found) {
        ((pool && pool.standards) || []).forEach(function (r) {
          if (normCode(r.code) === k) found = fromPool(r);
        });
      }
      if (found) addStd(found);
      updateCounts();
    }

    function themeName(id) {
      var hit = null;
      ((fw && fw.transdisciplinaryThemes) || []).forEach(function (t) { if (t.id === id) hit = t; });
      return hit;
    }

    /** 후보를 뽑을 성취기준 풀 — 통합교과 단원 것은 이미 담겨 있으므로 추가 교과 위주로 본다. */
    function candidatePool() {
      var subs = state.grade <= 2 ? extraSubjects() : (state.subjects || []);
      var out = [];
      subs.forEach(function (name) {
        subjectStandards(name).forEach(function (o) { out.push(o); });
      });
      return out;
    }

    function buildPrompt() {
      var t = themeName(state.theme) || {};
      var lines = candidatePool().map(function (o) {
        return '- ' + o.code + ' [' + o.subject + '·' + o.domain + '] ' + o.text;
      });
      var already = (state.standards || []).map(function (o) {
        return '- ' + o.code + ' ' + o.text;
      });

      var p = '당신은 IB PYP 초학문적 탐구 단원을 설계하는 한국 초등학교 교사를 돕는다.\n\n' +
              '[학년] ' + state.grade + '학년\n' +
              '[초학문적 주제] ' + (t.ko || '') + ' (' + (t.en || '') + ')\n' +
              '[주제 설명]\n' + ((t.descriptors || []).map(function (d) { return '- ' + d; }).join('\n')) + '\n\n';

      if (state.grade <= 2 && state.tonghapUnit) {
        p += '[통합교과 단원] ' + state.tonghapUnit.unit + ' — ' +
             String(state.tonghapUnit.bigIdea).replace(/^[0-9-]+\.\s*/, '') + '\n\n';
      }
      if (already.length) {
        p += '[이미 고른 성취기준]\n' + already.join('\n') + '\n\n';
      }
      p += '[고를 수 있는 성취기준 목록]\n' + lines.join('\n') + '\n\n' +
           '[할 일]\n' +
           '위 목록에서 이 초학문적 주제의 탐구에 실제로 기여하는 성취기준을 4개에서 6개 고른다.\n' +
           '- 반드시 목록에 있는 코드만 쓴다. 목록에 없는 코드를 지어내지 않는다.\n' +
           '- 이미 고른 성취기준과 겹치지 않게 한다.\n' +
           '- 교과가 한쪽으로 쏠리지 않게 두 교과 이상에서 고른다.\n' +
           '- 이유는 한 문장으로, 이 주제의 탐구와 어떻게 이어지는지 쓴다.\n\n' +
           '[출력] 다음 형태의 JSON만 출력한다.\n' +
           '{ "picks": [ { "code": "[4사01-01]", "why": "고른 이유 한 문장" } ] }\n' +
           'code는 위 목록에 적힌 그대로, 대괄호까지 포함해 옮겨 적는다.';
      return p;
    }

    function applyPicks(picks) {
      var pooled = candidatePool();
      var index = {};
      pooled.forEach(function (o) { index[normCode(o.code)] = o; });

      var added = 0, unknown = 0, dup = 0, missed = [];
      (picks || []).forEach(function (p) {
        var raw = String((p && p.code) || '').trim();
        var hit = index[normCode(raw)];
        if (!hit) { unknown++; if (missed.length < 3) missed.push(raw); return; }
        if (hasStd(hit.code)) { dup++; return; }
        hit.why = String((p && p.why) || '');
        addStd(hit);
        added++;
      });
      return { added: added, unknown: unknown, dup: dup, missed: missed, asked: (picks || []).length };
    }

    function askAi() {
      if (!state.theme) { msg('먼저 초학문적 주제를 골라 주세요.', 'warn'); return; }
      if (!candidatePool().length) {
        msg(state.grade <= 2
          ? '추천할 목록이 없습니다. 위에서 국어나 수학을 더해 주세요.'
          : '추천할 목록이 없습니다. 교과를 먼저 골라 주세요.', 'warn');
        return;
      }
      var btn = $('#s1-std [data-act="ai"]');
      if (btn) { btn.disabled = true; btn.textContent = '추천을 받는 중…'; }
      msg('주제와 성취기준을 견주어 보는 중입니다. 10초쯤 걸립니다.', 'info');

      callGemini(buildPrompt()).then(function (res) {
        var r = applyPicks(res && res.picks);
        paintAll();
        if (r.added > 0) {
          msg('성취기준 ' + r.added + '개를 담았습니다. 목록에서 확인하고 필요 없는 것은 체크를 풀어 주세요.' +
              (r.unknown ? ' (목록에 없는 코드 ' + r.unknown + '개는 건너뛰었습니다.)' : ''), 'info');
        } else if (r.dup > 0) {
          msg('추천받은 ' + r.dup + '개가 이미 골라 둔 것과 같습니다. 다른 성취기준이 필요하면 목록에서 직접 골라 주세요.', 'warn');
        } else if (r.unknown > 0) {
          msg('추천받은 코드를 목록에서 찾지 못했습니다(' + r.missed.join(', ') + '). 다시 한 번 눌러 주시고, 계속 같으면 알려 주세요.', 'stop');
        } else {
          msg('추천이 비어 있습니다. 다시 한 번 눌러 주세요.', 'warn');
        }
      })['catch'](function (e) {
        paintAll();
        msg(msgOf(e), 'stop');
      });
    }

    /* ---- 연결 ---- */
    function bindStep1() {
      var root = $('#step-1');
      root.addEventListener('click', function (ev) {
        var el = ev.target.closest ? ev.target.closest('[data-act]') : null;
        if (!el || !root.contains(el)) return;
        var v = el.getAttribute('data-v');
        switch (el.getAttribute('data-act')) {
          case 'grade': pickGrade(Number(v)); break;
          case 'unit': pickUnit(v); break;
          case 'subject': pickSubject(v); break;
          case 'theme': pickTheme(v); break;
          case 'ai': askAi(); break;
        }
      });
      root.addEventListener('change', function (ev) {
        var t = ev.target;
        if (t && t.matches && t.matches('input[data-code]')) {
          toggleStd(t.getAttribute('data-code'), t.checked);
        }
      });
    }

    /* ---- 검증 ---- */
    registerGuard(1, function (st) {
      var hard = [], soft = [];
      if (!st.grade) hard.push('학년을 먼저 골라 주세요.');
      else if (st.grade <= 2 && !st.tonghapUnit) hard.push('통합교과 단원을 골라 주세요.');
      else if (st.grade > 2) {
        var n = (st.subjects || []).length;
        if (n < 2) hard.push('초학문적 탐구이므로 교과를 2개 이상 골라 주세요.');
        else if (n > 4) hard.push('교과는 4개까지만 고를 수 있습니다.');
      }
      if (!st.theme) hard.push('초학문적 주제를 골라 주세요.');
      if (!(st.standards || []).length) hard.push('성취기준을 하나 이상 골라 주세요.');

      if (hard.length === 0 && (st.standards || []).length < 3) {
        soft.push('성취기준이 ' + st.standards.length + '개입니다. 3~4주 단원이라면 조금 적을 수 있습니다.');
      }
      return { hard: hard, soft: soft };
    });

    function init() {
      paintGrades();
      bindStep1();
      if (state.grade) {
        ensure().then(paintAll)['catch'](function () { /* 데이터 없으면 학년 화면만 */ });
      }
    }

    return { init: init, repaint: paintAll };
  })();

  /* ============================================================
   * 2단계 — 중심 아이디어
   *   ① 핵심 아이디어 원문 앵커링(호출 없음)
   *   ② 후보 3개 + AI의 ERCS 의견
   *   ③ 교사가 고르고 고쳐 쓰기
   *   ④ 교사가 최종 판단 (AI 의견은 참고로만 곁들임)
   * ============================================================ */
  var S2 = (function () {
    var fw = null, core = null, cands = [];

    function esc(v) {
      return String(v == null ? '' : v).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
      });
    }
    function msg(text, tone) {
      var el = $('#s2-msg');
      if (!el) return;
      if (!text) { el.hidden = true; return; }
      el.hidden = false;
      el.textContent = text;
      el.className = 'notice notice--' + (tone || 'info');
    }
    function ercsItems() {
      return (fw && fw.qualityCriteria && fw.qualityCriteria.centralIdea &&
              fw.qualityCriteria.centralIdea.items) || [];
    }
    function themeOf(id) {
      var hit = null;
      ((fw && fw.transdisciplinaryThemes) || []).forEach(function (t) { if (t.id === id) hit = t; });
      return hit;
    }

    /** 고른 성취기준의 (교과·영역)에 걸리는 핵심 아이디어를 모은다. 호출 없음. */
    function anchors() {
      var want = {}, out = [];
      (state.standards || []).forEach(function (o) {
        if (o.from === 'tonghap') return;      // 통합교과는 핵심 아이디어 체계가 다르다
        want[o.subject + '|' + o.domain] = true;
      });
      ((core && core.entries) || []).forEach(function (e) {
        if (!want[e.subject + '|' + e.domain]) return;
        (e.ideas || []).forEach(function (idea) {
          out.push({ subject: e.subject, domain: e.domain, id: idea.id, text: idea.text });
        });
      });
      return out;
    }

    function ensure() {
      return Promise.all([loadData('pyp-framework'), loadData('core-ideas')])
        .then(function (r) { fw = r[0]; core = r[1]; return true; });
    }

    /* ---- 그리기 ---- */
    function paintAnchor() {
      var list = anchors();
      state.coreIdeaRefs = list.map(function (a) { return a.id; });

      var h = '<h3 class="block__title"><span class="block__ord">1</span>핵심 아이디어 살펴보기</h3>';
      if (!list.length) {
        h += '<p class="block__hint">고르신 성취기준에 맞물리는 핵심 아이디어를 찾지 못했습니다. ' +
             '아래에서 바로 중심 아이디어 후보를 받아 보세요.</p>';
        $('#s2-anchor').innerHTML = h;
        return;
      }
      h += '<p class="block__hint">2022 개정 교육과정이 이 영역에서 무엇을 큰 줄기로 삼는지 먼저 봅니다. ' +
           '중심 아이디어를 지을 때 이 문장들이 근거가 됩니다.</p>';

      var byDom = [], seen = {};
      list.forEach(function (a) {
        var k = a.subject + ' · ' + a.domain;
        if (!seen[k]) { seen[k] = []; byDom.push(k); }
        seen[k].push(a);
      });
      byDom.forEach(function (k) {
        h += '<div class="anchor"><p class="anchor__src">' + esc(k) + '</p>';
        seen[k].forEach(function (a) { h += '<p class="anchor__text">' + esc(a.text) + '</p>'; });
        h += '</div>';
      });
      $('#s2-anchor').innerHTML = h;
    }

    function paintCand() {
      var h = '<h3 class="block__title"><span class="block__ord">2</span>중심 아이디어 후보 받기</h3>' +
              '<p class="block__hint">핵심 아이디어와 고르신 성취기준, 초학문적 주제를 함께 놓고 후보 세 개를 만듭니다. ' +
              '고른 뒤 아래에서 얼마든지 고쳐 쓸 수 있습니다.</p>' +
              '<div class="rowbtns">' +
              '<button class="btn btn--primary" type="button" data-act="gen">' +
              (cands.length ? '다시 받기' : '후보 세 개 받기') + '</button></div>' +
              '<p class="notice notice--info" id="s2-msg" hidden></p>';

      cands.forEach(function (c, i) {
        var on = state.centralIdea && state.centralIdea === c.text;
        h += '<button class="cand" type="button" data-act="pick" data-i="' + i + '"' +
             ' aria-pressed="' + (on ? 'true' : 'false') + '">' +
             '<span class="cand__text">' + esc(c.text) + '</span>';
        if (c.note) h += '<span class="cand__note">' + esc(c.note) + '</span>';
        if (c.ercs) {
          h += '<span class="ercs">';
          ercsItems().forEach(function (it) {
            var v = c.ercs[it.id];
            h += '<span class="ercs__item" data-v="' + (v === false ? 'weak' : (v === true ? 'yes' : '')) + '">' +
                 esc(it.ko) + (v === false ? ' 약함' : (v === true ? '' : ' ?')) + '</span>';
          });
          h += '</span>';
        }
        h += '</button>';
      });
      $('#s2-cand').innerHTML = h;
    }

    function formChecks(t) {
      var v = String(t || '').trim();
      return {
        one: v.length > 0 && !/[.!?。]\s*\S/.test(v),
        // 한국어 과거형은 '았다·었다·였다'로 끝난다. 미래·추측형도 함께 걸러 낸다.
        present: !/((았|었|였)다|할 것이다|일 것이다|겠다)\s*[.。]?\s*$/.test(v),
        noProper: !/[A-Z][a-zA-Z]{2,}/.test(v)
      };
    }

    function paintEdit() {
      var t = state.centralIdea || '';
      var f = formChecks(t);
      var h = '<h3 class="block__title"><span class="block__ord">3</span>중심 아이디어 다듬기</h3>' +
              '<p class="block__hint">우리 반 아이들의 말로 고쳐 주세요. 한 문장, 현재 시제, 고유명사 없이 씁니다.</p>' +
              '<textarea class="editor" id="s2-text" placeholder="예: 사람들은 가진 것이 한정되어 있어 무엇을 먼저 할지 선택한다.">' +
              esc(t) + '</textarea>' +
              '<div class="formcheck">' +
              '<span data-ok="' + (t ? f.one : '') + '">한 문장</span>' +
              '<span data-ok="' + (t ? f.present : '') + '">현재 시제</span>' +
              '<span data-ok="' + (t ? f.noProper : '') + '">고유명사 없음</span>' +
              '</div>';
      $('#s2-edit').innerHTML = h;
    }

    function paintErcs() {
      var box = $('#s2-ercs');
      if (!state.centralIdea) { box.innerHTML = ''; return; }
      var ai = state.ercsAi || {};
      var h = '<h3 class="block__title"><span class="block__ord">4</span>네 가지로 따져보기</h3>' +
              '<p class="block__hint">아래는 AI가 짚어본 것이지 판정이 아닙니다. ' +
              '우리 반 아이들을 아는 사람은 선생님이므로, 읽어 보고 다르다 싶으면 그대로 체크하거나 풀어 주세요.</p>';

      ercsItems().forEach(function (it) {
        var mine = state.ercs && state.ercs[it.id];
        var note = ai[it.id];
        h += '<label class="check">' +
             '<input type="checkbox" data-ercs="' + esc(it.id) + '"' + (mine ? ' checked' : '') + '>' +
             '<span><span class="check__name">' + esc(it.ko) + '</span> ' +
             '<span class="check__q">' + esc(it.check) + '</span>';
        if (note) h += '<span class="check__ai">AI 의견 — ' + esc(note) + '</span>';
        h += '</span></label>';
      });
      box.innerHTML = h;
    }

    function paintAll() {
      if (!fw || !core) return;
      paintAnchor(); paintCand(); paintEdit(); paintErcs();
      saveDraft();
    }

    /* ---- 생성 ---- */
    function buildPrompt() {
      var t = themeOf(state.theme) || {};
      var stds = (state.standards || []).map(function (o) {
        return '- ' + o.code + ' [' + o.subject + '] ' + o.text;
      }).join('\n');
      var anch = anchors().map(function (a) {
        return '- [' + a.subject + '·' + a.domain + '] ' + a.text;
      }).join('\n');

      var p = '당신은 IB PYP 초학문적 탐구 단원을 설계하는 한국 초등학교 교사를 돕는다.\n\n' +
              '[학년] ' + state.grade + '학년\n' +
              '[초학문적 주제] ' + (t.ko || '') + '\n' +
              '[주제 설명]\n' + ((t.descriptors || []).map(function (d) { return '- ' + d; }).join('\n')) + '\n\n';

      if (state.grade <= 2 && state.tonghapUnit) {
        p += '[통합교과 단원] ' + state.tonghapUnit.unit + ' — ' +
             String(state.tonghapUnit.bigIdea).replace(/^[0-9-]+\.\s*/, '') + '\n\n';
      }
      if (anch) p += '[2022 개정 교육과정 핵심 아이디어 — 근거로 삼을 것]\n' + anch + '\n\n';
      p += '[고른 성취기준]\n' + stds + '\n\n' +
           '[할 일] 이 단원의 중심 아이디어(central idea) 후보를 서로 다른 관점으로 3개 만든다.\n' +
           '중심 아이디어의 조건:\n' +
           '- 개념과 개념의 관계를 담은 한 문장으로 쓴다.\n' +
           '- 현재 시제로 쓴다. 고유명사와 특정 지명·인명을 넣지 않는다.\n' +
           '- ' + state.grade + '학년 학생이 읽고 뜻을 짐작할 수 있는 낱말로 쓴다.\n' +
           '- 사실 하나를 말하는 문장이 아니라, 여러 사례에 걸쳐 통하는 문장으로 쓴다.\n' +
           '- 세 후보는 서로 다른 개념 축을 잡는다. 표현만 바꾼 문장을 내지 않는다.\n\n' +
           '각 후보마다 다음 네 가지를 스스로 따져 true/false로 답한다. 확신이 없으면 false로 둔다.\n' +
           '- engaging: 이 학년 학생 다수에게 흥미로운가\n' +
           '- relevant: 학생이 이전에 배우거나 겪은 것과 이어지는가\n' +
           '- challenging: 지금 아는 것보다 한 걸음 나아가게 하는가\n' +
           '- significant: 이 초학문적 주제를 깊이 이해하는 데 핵심인가\n' +
           'false로 둔 항목이 있으면 comment에 무엇이 아쉬운지 한 문장으로 적는다.\n\n' +
           '[출력] 다음 형태의 JSON만 출력한다.\n' +
           '{ "candidates": [ { "text": "중심 아이디어 한 문장", "note": "어떤 개념 축을 잡았는지 한 문장", ' +
           '"ercs": { "engaging": true, "relevant": true, "challenging": false, "significant": true }, ' +
           '"comment": { "challenging": "아쉬운 점 한 문장" } } ] }';
      return p;
    }

    function generate() {
      if (!(state.standards || []).length) { msg('1단계에서 성취기준을 먼저 골라 주세요.', 'warn'); return; }
      var btn = $('#s2-cand [data-act="gen"]');
      if (btn) { btn.disabled = true; btn.textContent = '만드는 중…'; }
      msg('핵심 아이디어와 성취기준을 견주어 문장을 짓는 중입니다. 15초쯤 걸립니다.', 'info');

      callGemini(buildPrompt()).then(function (res) {
        var got = (res && res.candidates) || [];
        cands = got.filter(function (c) { return c && c.text; }).slice(0, 3).map(function (c) {
          return {
            text: String(c.text).trim(),
            note: c.note || '',
            ercs: c.ercs || null,
            comment: c.comment || {}
          };
        });
        paintAll();
        msg(cands.length ? '후보 ' + cands.length + '개를 만들었습니다. 마음에 드는 것을 누르고 아래에서 고쳐 쓰세요.'
                         : '후보를 만들지 못했습니다. 다시 눌러 주세요.', cands.length ? 'info' : 'warn');
      })['catch'](function (e) {
        paintAll();
        msg(msgOf(e), 'stop');
      });
    }

    /* ---- 조작 ---- */
    function pick(i) {
      var c = cands[i];
      if (!c) return;
      state.centralIdea = c.text;
      state.ercsAi = {};
      state.ercs = {};
      ercsItems().forEach(function (it) {
        var v = c.ercs && c.ercs[it.id];
        // AI가 괜찮다고 본 항목만 미리 체크해 둔다. 교사가 언제든 뒤집을 수 있다.
        state.ercs[it.id] = (v === true);
        if (v === false) {
          state.ercsAi[it.id] = (c.comment && c.comment[it.id]) || '이 항목이 아쉬울 수 있습니다.';
        }
      });
      paintAll();
    }

    function bindStep2() {
      var root = $('#step-2');
      root.addEventListener('click', function (ev) {
        var el = ev.target.closest ? ev.target.closest('[data-act]') : null;
        if (!el || !root.contains(el)) return;
        if (el.getAttribute('data-act') === 'gen') generate();
        if (el.getAttribute('data-act') === 'pick') pick(Number(el.getAttribute('data-i')));
      });
      root.addEventListener('change', function (ev) {
        var t = ev.target;
        if (t && t.matches && t.matches('input[data-ercs]')) {
          state.ercs = state.ercs || {};
          state.ercs[t.getAttribute('data-ercs')] = t.checked;
          saveDraft();
        }
      });
      root.addEventListener('input', function (ev) {
        if (ev.target && ev.target.id === 's2-text') {
          state.centralIdea = ev.target.value;
          var f = formChecks(state.centralIdea);
          var tags = $$('#s2-edit .formcheck span');
          if (tags.length === 3 && state.centralIdea.trim()) {
            tags[0].setAttribute('data-ok', String(f.one));
            tags[1].setAttribute('data-ok', String(f.present));
            tags[2].setAttribute('data-ok', String(f.noProper));
          }
          saveDraft();
        }
      });
    }

    registerGuard(2, function (st) {
      var hard = [], soft = [];
      var t = String(st.centralIdea || '').trim();
      if (!t) hard.push('중심 아이디어를 한 문장 써 주세요.');
      else {
        var f = formChecks(t);
        if (!f.one) hard.push('중심 아이디어는 한 문장으로 씁니다. 문장을 하나로 줄여 주세요.');
        if (!f.present) hard.push('중심 아이디어는 현재 시제로 씁니다.');
        if (!f.noProper) hard.push('중심 아이디어에는 고유명사를 넣지 않습니다.');
      }
      if (!hard.length) {
        var off = [];
        ercsItems().forEach(function (it) { if (!(st.ercs && st.ercs[it.id])) off.push(it.ko); });
        if (off.length) soft.push('네 가지 가운데 ' + off.join(' · ') + ' 항목에 체크가 없습니다.');
      }
      return { hard: hard, soft: soft };
    });

    function init() {
      bindStep2();
      ensure().then(paintAll)['catch'](function () { /* 데이터가 없으면 조용히 넘어간다 */ });
    }

    return { init: init, repaint: paintAll };
  })();

  /* ============================================================
   * 테마
   * ============================================================ */
  function applyTheme(mode) {
    document.documentElement.setAttribute('data-theme', mode);
    $('#theme-icon').textContent = mode === 'dark' ? '☀' : '☾';
    store(KEYS.theme, mode);
  }

  function initTheme() {
    var saved = store(KEYS.theme);
    if (saved !== 'dark' && saved !== 'light') {
      saved = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    applyTheme(saved);
  }

  /* ============================================================
   * 연결
   * ============================================================ */
  function bind() {
    $('#btn-prev').addEventListener('click', function () { goStep(state.step - 1); });
    $('#btn-next').addEventListener('click', goNext);

    $$('.rail__btn').forEach(function (btn) {
      btn.addEventListener('click', function () { goStep(Number(btn.dataset.goto)); });
    });

    $('#btn-theme').addEventListener('click', function () {
      var now = document.documentElement.getAttribute('data-theme');
      applyTheme(now === 'dark' ? 'light' : 'dark');
    });

    $('#btn-key').addEventListener('click', function () {
      $('#key-input').value = getApiKey();
      keyMessage('');
      openDialog('#dlg-key');
    });
    $('#btn-key-save').addEventListener('click', saveApiKey);
    $('#btn-key-clear').addEventListener('click', clearApiKey);
    $('#btn-key-cancel').addEventListener('click', function () { closeDialog('#dlg-key'); });

    $('#btn-vault').addEventListener('click', function () { renderVault(); openDialog('#dlg-vault'); });
    $('#btn-vault-close').addEventListener('click', function () { closeDialog('#dlg-vault'); });

    $('#btn-confirm-back').addEventListener('click', function () {
      confirmCallback = null;
      closeDialog('#dlg-confirm');
    });
    $('#btn-confirm-go').addEventListener('click', function () {
      var fn = confirmCallback;
      confirmCallback = null;
      closeDialog('#dlg-confirm');
      if (fn) fn();
    });

    window.addEventListener('resize', function () { renderStep(); });
  }

  function init() {
    initTheme();
    loadDraft();
    bind();
    paintKeyState();
    renderStep();
    S1.init();
    S2.init();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* 다음 작업에서 단계별 모듈이 붙을 자리 */
  window.PYP = {
    state: state,
    goStep: goStep,
    registerGuard: registerGuard,
    loadData: loadData,
    callGemini: callGemini,
    saveDraft: saveDraft
  };
})();
