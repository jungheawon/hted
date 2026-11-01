/* =================================================================
   HTRO EDU · 통합 AI 서버 (Google Apps Script)
   수업 설계 · 수행평가 · AI 튜터 · AI 생기부 · AI 학습 플랜 · AI 면접을 이 파일 하나로 처리해요.

   [적용 방법]  ※ 수업 설계 프로젝트(주소 AKfycbyP0vig…)에서 하세요
   1) 왼쪽 파일 목록에 Code.gs 말고 다른 .gs 파일이 있으면 삭제 (⋮ → 삭제)
   2) Code.gs 내용을 전부 지우고 이 코드를 붙여 넣은 뒤 저장
   3) 함수 목록에서 '전체테스트' 실행 → 로그 여덟 줄이 모두 OK면 성공
   4) 배포 → 배포 관리 → 연필(수정) → 버전: '새 버전' → 배포
      ('새 배포'를 누르면 주소가 바뀌어요. 꼭 기존 배포를 수정하세요)
   5) 여섯 페이지의 APPS_SCRIPT_URL을 모두 이 프로젝트 주소로 맞추기

   API 키: 스크립트 속성의 GEMINI_KEY (GEMINI_API_KEY, API_KEY 이름도 찾아요)

   [페이지 → 서버 구분]
     type 없음          → 수업 설계   (ai-lesson.html)
     type:"assessment"  → 수행평가     (ai-assessment.html)
     type:"tutor"       → AI 튜터      (ai-tutor.html)
     type:"record"      → AI 생기부    (ai-record.html)
     type:"plan"        → AI 학습 플랜 (ai-tutor-plan.html)
     type:"interview"   → AI 면접      (ai-interview.html)
   ================================================================= */

/* ───────── 설정 ───────── */
// 위에서부터 차례로 시도해요. '-latest' 이름이라 모델이 바뀌어도 고칠 필요가 없어요.
// Flash-Lite가 덜 붐비고 무료 한도도 넉넉해서 먼저 써요.
var MODELS = ["gemini-flash-lite-latest", "gemini-flash-latest"];
// 스크립트 속성에서 이 이름들을 순서대로 찾아요.
var KEY_NAMES = ["GEMINI_KEY", "GEMINI_API_KEY", "API_KEY"];
// 1분당 최대 요청 수. 학생 튜터를 따로 세서, 학생이 몰려도 선생님 도구는 막히지 않아요.
var LIMIT_TEACHER = 30;   // 수업 설계 + 수행평가 + 생기부 합산
var LIMIT_TUTOR = 60;     // AI 튜터 + 학습 플랜 (학생용)
var LIMIT_INTERVIEW = 60; // AI 면접 (학생용, 따로 세요)

// 수식·기호를 화면에 그대로 읽히게 쓰라는 공통 규칙
var PLAIN_MATH = "수식에 LaTeX나 $ 기호를 쓰지 말고 일반 글자로 쓴다. 예: y = a(x − p)² + q, x² − 4x + 3 = 0, √2, 1/2, ≤, ≥, H₂O, CO₂.";

/* ───────── 요청 나누기 ───────── */
function doPost(e) {
  var body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || "{}"); }
  catch (err) { return out_({ error: "http" }); }

  var t = body.type;
  // type이 빠진 예전 페이지도 모양을 보고 알아서 나눠요.
  if (!t && (body.action === "write" || body.action === "check")) t = "record";
  if (!t && Array.isArray(body.history)) t = "tutor";

  if (t === "tutor") return run_(tutor_, body, "tutor", "bad_response");
  if (t === "assessment") return run_(assessment_, body, "teacher", "http");
  if (t === "record") return run_(record_, body, "teacher", "network");
  if (t === "plan") return run_(plan_, body, "tutor", "ai_failed");
  if (t === "interview") return run_(interview_, body, "interview", "ai_failed");
  return run_(lesson_, body, "teacher", "http");
}

// 브라우저로 주소를 열었을 때 동작 확인용
function doGet() {
  return out_({ ok: true, service: "HTRO EDU", tools: ["lesson", "assessment", "tutor", "record", "plan", "interview"] });
}

// 공통 처리: 키 확인 → 사용량 확인 → 도구 실행 → 오류를 코드로 바꿔 돌려주기
function run_(fn, body, bucket, fallbackCode) {
  try {
    var key = key_();
    if (!key) return out_({ error: "no_key" });
    if (!rateOk_(bucket)) return out_({ error: "rate_limited" });
    return out_(fn(key, body));
  } catch (err) {
    if (err && err.code) return out_({ error: err.code });
    console.error(err);
    return out_({ error: fallbackCode });
  }
}

/* =================================================================
   1. 수업 설계  (ai-lesson.html → {request} / 응답 {plan})
   ================================================================= */
var LESSON_MAX = 500;

function lesson_(key, body) {
  var req = String(body.request || "").trim();
  if (!req) throw { code: "http" };
  if (req.length > LESSON_MAX) throw { code: "too_long" };

  var plan = geminiJSON_(key, null, [{ role: "user", parts: [{ text: lessonPrompt_(req) }] }],
    { temperature: 0.7, maxOutputTokens: 8192 },
    function (v) { return unwrapBy_(v, function (o) { return Array.isArray(o.goals); }); });
  return { plan: plan };
}

function lessonPrompt_(req) {
  return `당신은 한국 중·고등학교 수업 설계 전문가입니다. 교사의 요청에 맞춰 실제 교실에서 바로 쓸 수 있는 1차시 수업안을 만드세요.

교사 요청: """${req}"""

규칙:
- 한국어로 작성. 2022 개정 교육과정 수준에 맞추고, 요청에 학년·과목·단원·시간이 없으면 합리적으로 정한다(시간 기본 50분).
- intro, practice, assessment, closing의 minutes 합이 duration과 정확히 같아야 한다.
- 각 단계의 steps minutes 합은 그 단계 minutes와 같아야 한다.
- practice(실습 활동)는 학생이 직접 하는 핵심 활동이다. 과목에 맞게 구성한다(국어: 읽기·토론·글쓰기, 영어: 짝·모둠 말하기와 과제, 수학: 문제 해결·협력 풀이, 사회: 자료·사례 탐구, 과학: 실험·관찰·탐구, 정보: 실습). tool에는 교구·활동지·도구 이름을 쓰고 없으면 빈 문자열.
- 과학 실험이 들어가면 안전 수칙을 practice.tip에 적는다.
- 수학·과학 형성평가는 실제 풀 수 있는 구체적 문항(수치 포함)으로 쓴다.
- 형성평가는 3문항, 유형은 선택형/단답형/서술형 중에서.
- 문장은 짧고 교사가 바로 읽을 수 있게.
- 마크다운(**, #)을 쓰지 않는다. ${PLAIN_MATH}

아래 형태의 JSON 객체 하나만 답하세요(배열로 감싸지 마세요):
{"title":"수업 제목(짧게)","summary":"한두 문장 요약","grade":"","subject":"","unit":"","duration":50,
"goals":["...","...","..."],
"intro":{"minutes":7,"steps":[{"title":"","minutes":3,"detail":""}],"tip":""},
"practice":{"minutes":28,"steps":[{"title":"","minutes":6,"detail":"","tool":""}],"materials":["..."],"tip":""},
"assessment":{"minutes":8,"questions":[{"q":"","type":"선택형","answer":""}]},
"closing":{"minutes":7,"items":["..."],"next":"다음 차시: ..."}}`;
}

/* =================================================================
   2. 수행평가  (ai-assessment.html → {type:"assessment", request} / 응답 {plan})
   ================================================================= */
var ASSESS_MAX = 800;

var ASSESS_SYSTEM = `당신은 대한민국 고등학교 수행평가 설계를 돕는 평가 전문가입니다.
선생님의 요청을 바탕으로 2022 개정 교육과정에 맞는 수행평가 계획안을 만듭니다.

반드시 아래 JSON 객체 하나만 출력하세요. 배열로 감싸거나, 설명 문장이나 코드블록 표시를 쓰지 마세요.
{
  "title": "수행평가 제목",
  "grade": "고1",
  "subject": "과목명",
  "unit": "단원명",
  "summary": "평가 취지를 1~2문장으로",
  "overview": {
    "standards": ["[성취기준 코드] 성취기준 문장"],
    "method": "논술형 | 프로젝트 | 실험·실습 | 발표·토론 | 포트폴리오 | 프로그래밍 등",
    "type": "개인 또는 모둠",
    "sessions": 2,
    "weight": "학기 성적 반영 비율 예: 20%",
    "elements": ["평가 요소 이름"]
  },
  "task": {
    "prompt": "학생에게 그대로 제시할 과제 설명 (2~5문장)",
    "steps": [{"session": "1차시", "title": "활동 이름", "detail": "학생이 하는 일"}],
    "materials": ["준비물이나 제출물"],
    "rules": ["유의 사항 (표절, 생성형 AI 활용 범위, 제출 기한 등)"]
  },
  "rubric": {
    "levels": ["A", "B", "C", "D", "E"],
    "criteria": [
      {"name": "평가 요소", "points": 6,
       "scores": [{"score": 6, "desc": "관찰 가능한 행동으로 쓴 수준 설명"}]}
    ],
    "fallback": "미응시·미제출 학생 처리 기준"
  },
  "notice": "학생에게 나눠 줄 안내문 전문. 과제, 일정, 제출 방법, 채점 요소, 유의 사항을 줄바꿈으로 정리",
  "records": [{"level": "상", "text": "세부능력 및 특기사항 예시 문장"}]
}

규칙:
- [조건]에 적힌 채점 단계 수만큼 levels를 만들고, 모든 criteria의 scores 개수를 levels와 같게 하세요. 3단계면 ["상","중","하"], 5단계면 ["A","B","C","D","E"], 4단계면 ["매우 우수","우수","보통","미흡"].
- criteria는 3~5개. points의 합은 [조건]의 만점과 정확히 같아야 합니다. 각 criteria의 scores는 높은 점수부터 낮은 점수 순서, 첫 score는 그 요소의 points와 같게.
- 수준 설명(desc)은 "~함", "~할 수 있음"처럼 관찰 가능한 기준으로, 수준끼리 차이가 분명하게 쓰세요.
- 성취기준 코드는 확실할 때만 쓰고, 불확실하면 코드 없이 문장만 쓰세요. 지어내지 마세요.
- records는 상·중·하 3개. 학생 이름 없이 "~함." 개조식 종결로 300~450자, 과제 속 구체적 활동이 드러나게 쓰세요. 단순 나열이나 과장된 칭찬은 피하세요.
- 수행평가는 수업 시간 안에 이루어지도록 설계하고, 과제형(가정 과제)으로 만들지 마세요.
- 마크다운(**, #)을 쓰지 마세요. ${PLAIN_MATH}
- 모든 문장은 한국어로 쓰세요.`;

function assessment_(key, body) {
  var req = String(body.request || "").trim();
  if (!req) throw { code: "invalid_json" };
  if (req.length > ASSESS_MAX) throw { code: "too_long" };

  var plan = geminiJSON_(key, ASSESS_SYSTEM, [{ role: "user", parts: [{ text: req }] }],
    { temperature: 0.7, maxOutputTokens: 8192 },
    function (v) { return unwrapBy_(v, function (o) { return !!(o.rubric || o.task); }); });
  return { plan: plan };
}

/* =================================================================
   3. AI 튜터  (ai-tutor.html → {type:"tutor", action, subject, level, studyMode, history, …}
                응답 {reply, problem, suggestions} 또는 {correct, reply, suggestions})
   ================================================================= */
var TUTOR_MAX_TEXT = 1500;

var TUTOR_LEVELS = {
  1: "기초: 중학생도 이해할 아주 쉬운 말, 일상 비유, 한 번에 개념 하나. 문제는 개념 확인용 아주 쉬운 것.",
  2: "쉬움: 기본 용어를 쉽게 풀어 설명, 짧은 예제. 문제는 기본 개념 적용 1단계.",
  3: "보통: 고등학교 교과서 수준. 문제는 교과서 예제~익힘 문제 수준.",
  4: "심화: 응용 예제, 원리까지 설명. 문제는 두 단계 이상 생각해야 하는 응용 문제.",
  5: "도전: 여러 개념을 엮는 수준. 문제는 서술형·사고력 중심의 어려운 문제."
};
var TUTOR_MODES = {
  question: "질문 답변 모드: 학생 질문에 바로 답하되 핵심부터 짧게. 끝에 이해했는지 확인하는 질문 하나.",
  concept:  "개념 설명 모드: 정의 → 쉬운 예시(정보 과목이면 짧은 코드) → 자주 하는 실수 순서로 차근차근. 한 번에 너무 많이 설명하지 말 것.",
  practice: "개인별 문제 모드: 학생 수준에 맞는 문제를 반드시 problem 필드에 한 개 출제. reply 에는 짧은 안내만 쓰고 정답은 reply 에 쓰지 말 것.",
  review:   "오답 분석 모드: 학생이 틀린 문제와 답을 보고 ① 어디서 틀렸는지 ② 왜 그렇게 생각했을지 ③ 올바른 풀이 ④ 같은 실수를 막는 팁 순서로 분석. 끝에 비슷한 문제를 풀어볼지 물어볼 것."
};

function tutor_(key, body) {
  var subject = clip_(body.subject || "정보", 20);
  var level = Math.min(5, Math.max(1, Number(body.level) || 3));
  var mode = TUTOR_MODES[body.studyMode] ? body.studyMode : "question";
  var history = Array.isArray(body.history) ? body.history.slice(-14) : [];
  for (var i = 0; i < history.length; i++) {
    if (String((history[i] && history[i].text) || "").length > TUTOR_MAX_TEXT * 2) throw { code: "too_long" };
  }
  if (body.action === "grade") return tutorGrade_(key, subject, level, body);
  return tutorChat_(key, subject, level, mode, history);
}

function tutorChat_(key, subject, level, mode, history) {
  var sys = tutorRules_(subject, level) + `
[지금 모드] ${TUTOR_MODES[mode]}

[응답 형식] 반드시 아래 JSON 객체 하나만 출력해요.
{
  "reply": "학생에게 보여줄 답변(마크다운: **굵게**, - 목록, \`코드\`, \`\`\`python 코드블록\`\`\` 사용 가능)",
  "problem": null 또는 {
    "question": "문제 내용(마크다운 가능)",
    "type": "객관식" | "단답형" | "서술형" | "코드 작성",
    "choices": ["보기1","보기2","보기3","보기4"]  // 객관식일 때만, 아니면 []
    "answer": "정답(객관식이면 정답 번호 숫자만)",
    "explanation": "풀이",
    "hint": "정답을 직접 말하지 않는 힌트 한 문장"
  },
  "suggestions": ["학생이 다음에 누를 만한 짧은 문장 2~3개 (학생 말투, 15자 안팎)"]
}
- 학생이 문제를 내 달라고 하거나 개인별 문제 모드면 problem 을 채우고, 아니면 null.
- problem 을 낼 때 reply 에는 정답이나 풀이를 쓰지 않아요.`;

  var contents = tutorContents_(history);
  if (!contents.length) throw { code: "bad_response" };
  var r = geminiJSON_(key, sys, contents, { temperature: 0.6, maxOutputTokens: 8192 }, function (v, text) {
    return unwrapBy_(v, function (o) { return typeof o.reply === "string"; }) || { reply: String(text || "").trim() };   // JSON이 깨지면 글이라도 보여 줘요
  });

  var res = { reply: clip_(r.reply || "", 6000), problem: null, suggestions: tutorSugs_(r.suggestions) };
  var p = r.problem;
  if (p && p.question) {
    res.problem = {
      question: clip_(p.question, 2000),
      type: clip_(p.type || "단답형", 12),
      choices: Array.isArray(p.choices) ? p.choices.slice(0, 6).map(function (c) { return clip_(c, 300); }) : [],
      answer: clip_(p.answer, 1000),
      explanation: clip_(p.explanation, 2000),
      hint: clip_(p.hint, 300)
    };
  }
  return res;
}

function tutorGrade_(key, subject, level, body) {
  var p = body.problem || {};
  var answer = clip_(body.answer, TUTOR_MAX_TEXT);
  if (!p.question || !answer) throw { code: "bad_response" };

  var sys = tutorRules_(subject, level) + `
[지금 할 일] 학생 답안을 채점하고 피드백해요.
- 정답의 의미가 같으면(표현이 달라도, 코드는 결과가 같으면) 정답으로 봐요.
- 학생 답이 "모르겠어요"면 오답으로 처리하고 처음부터 친절하게 풀이해요.
- 정답이면: 칭찬 한마디 + 핵심 포인트 한두 줄.
- 오답이면 오답 분석: ① 어디서 틀렸는지 ② 왜 그렇게 생각했을 것 같은지 ③ 올바른 풀이 ④ 같은 실수를 막는 팁.

[응답 형식] 반드시 아래 JSON 객체 하나만 출력해요.
{ "correct": true 또는 false, "reply": "피드백(마크다운)", "suggestions": ["다음에 누를 짧은 문장 2~3개"] }`;

  var prompt =
    "[문제]\n" + clip_(p.question, 2000) +
    (Array.isArray(p.choices) && p.choices.length ? "\n[보기]\n" + p.choices.map(function (c, i) { return (i + 1) + ") " + c; }).join("\n") : "") +
    "\n[정답] " + clip_(p.answer, 1000) +
    "\n[풀이] " + clip_(p.explanation, 2000) +
    "\n\n[학생 답] " + answer;

  var r = geminiJSON_(key, sys, [{ role: "user", parts: [{ text: prompt }] }], { temperature: 0.6, maxOutputTokens: 8192 }, function (v, text) {
    return unwrapBy_(v, function (o) { return "correct" in o || typeof o.reply === "string"; }) || { reply: String(text || "").trim() };
  });
  return { correct: r.correct === true || r.correct === "true", reply: clip_(r.reply || "", 6000), suggestions: tutorSugs_(r.suggestions) };
}

function tutorRules_(subject, level) {
  return `너는 HTRO EDU 의 학생용 AI 튜터야. 대한민국 고등학생과 ${subject} 과목을 공부해.
[학생 수준] ${TUTOR_LEVELS[level]}
[말투와 원칙]
- 한국어, 친절한 존댓말(해요체). 짧은 문단, 한 번에 핵심 하나.
- 학생이 스스로 생각하도록 도와요. 숙제·시험 답을 통째로 대신 써 주지 말고, 단계별로 이끌어요.
- 정보 과목 코드는 파이썬 기본, 짧고 실행 가능한 예제로. 출력 결과도 함께 보여 줘요.
- ${PLAIN_MATH}
- 모르면 지어내지 말고 선생님께 확인해 보라고 해요.
- 공부와 무관하거나 부적절한 요청은 정중히 공부 이야기로 돌려요.
- 학생이 힘들다·괴롭다는 등 마음이 많이 힘든 신호를 보이면, 공감하고 담임 선생님이나 상담 선생님께 꼭 이야기해 보라고 권하고, 위급하면 청소년상담 1388 이나 109 에 연락하도록 안내해요.
- 개인정보(이름, 전화번호, 주소 등)는 묻지 않아요.`;
}

// 대화 기록 → Gemini 형식 (user로 시작, 같은 역할이 이어지면 합치기)
function tutorContents_(history) {
  var list = [];
  for (var i = 0; i < history.length; i++) {
    var h = history[i];
    var role = h && h.role === "model" ? "model" : "user";
    var text = clip_(h && h.text, TUTOR_MAX_TEXT * 2);
    if (!text) continue;
    var last = list[list.length - 1];
    if (last && last.role === role) last.parts[0].text += "\n" + text;
    else list.push({ role: role, parts: [{ text: text }] });
  }
  while (list.length && list[0].role !== "user") list.shift();
  return list;
}

function tutorSugs_(s) {
  return Array.isArray(s) ? s.slice(0, 3).map(function (x) { return clip_(x, 40); }).filter(Boolean) : [];
}

/* =================================================================
   4. AI 생기부  (ai-record.html → {type:"record", action:"write"|"check", …} / 응답 {result})
   ================================================================= */
function record_(key, body) {
  if (body.action === "write") return { result: recordWrite_(key, body) };
  if (body.action === "check") return { result: recordCheck_(key, body) };
  throw { code: "bad_request" };
}

function recordWrite_(key, b) {
  var memo = String(b.memo || "").trim();
  if (!memo) throw { code: "bad_request" };
  if (memo.length > 2000) throw { code: "too_long" };

  var limitChars = Number(b.limitChars) || 500;
  var constraints = (b.constraints || []).map(String).slice(0, 12);

  var system = [
    "너는 한국 고등학교 교사가 학교생활기록부(생기부)를 쓰도록 돕는 조력자다.",
    "교사가 두서없이 적은 관찰 메모를 받아, 생기부에 그대로 붙여 넣을 수 있는 문장으로 정리한다.",
    "",
    "작성 원칙",
    "- 메모의 조각들을 활동 → 과정 → 행동 특성 → 성장/의미 흐름으로 자연스럽게 연결한다.",
    "- 교사가 관찰한 구체적 행동과 사례로 쓰고, 평가어는 근거 뒤에 짧게 붙인다.",
    "- 같은 문장 구조(~하며 ~함)를 반복하지 않고, 문장 길이를 섞는다.",
    "- 주어(학생 이름, '이 학생은')는 생략한다.",
    "- 메모의 오타·줄임말·비속어는 바르게 고쳐 쓴다.",
    "- 분량은 공백 포함 최대 " + limitChars + "자. 메모가 적으면 억지로 늘리지 말고 짧게 쓴다.",
    "",
    "반드시 지킬 제약",
    constraints.map(function (c) { return "- " + c; }).join("\n"),
    "",
    "출력은 JSON 객체 하나만(배열로 감싸지 말 것):",
    '{"text":"생기부 문장","used":["메모에서 사용한 내용을 짧게"],"missing":["넣으면 더 좋아질 구체 정보(예: 탐구 결과물의 제목, 질문의 내용)"]}',
    "used, missing은 각각 최대 5개."
  ].join("\n");

  var user = [
    "영역: " + (b.area || "교과 세부능력 및 특기사항"),
    b.subject ? "과목/활동: " + b.subject : "",
    b.request ? "요청사항: " + b.request : "",
    "",
    "교사 메모:",
    memo
  ].filter(function (x) { return x !== ""; }).join("\n");

  return geminiJSON_(key, system, [{ role: "user", parts: [{ text: user }] }], { temperature: 0.7, maxOutputTokens: 8192 },
    function (v) { return unwrapBy_(v, function (o) { return typeof o.text === "string"; }); });
}

function recordCheck_(key, b) {
  var text = String(b.text || "").trim();
  if (!text) throw { code: "bad_request" };
  if (text.length > 3000) throw { code: "too_long" };

  var system = [
    "너는 학교생활기록부 문장을 검토하는 경력 많은 한국 고등학교 교사다.",
    "주어진 문장이 생성형 AI가 쓴 것처럼 읽히는지 점검하고, 교사가 직접 고칠 수 있게 구체적으로 알려준다.",
    "",
    "AI 문체로 보는 신호",
    "- 상투어·과장: 탁월한, 뛰어난, 돋보임, 함양함, 깊이 있는, 남다른, 인상적임, 귀감이 됨 등",
    "- 구조 반복: '~를 통해 ~을 기름', '~하며 ~함'이 연달아 나옴, 문장 길이가 균일함",
    "- 근거 없는 평가: 구체적 행동·사례 없이 역량만 나열",
    "- 추상 명사 나열: 탐구력, 비판적 사고력, 문제해결력, 협업 능력을 한 번에 몰아 씀",
    "- 번역투·과한 매끄러움: '~에 있어서', '~적인 측면에서', 접속어 남발",
    "",
    "점수(score): 0~100, 높을수록 AI가 쓴 것처럼 읽힘. 짧고 구체적인 관찰 위주면 낮게, 상투어와 반복이 많으면 높게.",
    "flags: 원문에 '정확히 그대로' 있는 표현(phrase, 2~25자)만 고른다. 최대 8개.",
    "  type은 '상투어', '반복 구조', '근거 부족', '추상어 나열', '번역투' 중 하나.",
    "  suggestion은 그 phrase를 바로 바꿔 넣을 수 있는 대체 표현(원문 끝맺음 형식 유지). 원문에 없는 사실은 넣지 않는다.",
    "",
    "출력은 JSON 객체 하나만(배열로 감싸지 말 것):",
    '{"score":0,"summary":"한두 문장 총평","flags":[{"phrase":"","type":"","reason":"","suggestion":""}],"strengths":["사람이 쓴 것처럼 느껴지는 부분, 최대 3개"]}'
  ].join("\n");

  var r = geminiJSON_(key, system, [{ role: "user", parts: [{ text: "영역: " + (b.area || "") + "\n\n검토할 문장:\n" + text }] }], { temperature: 0.2, maxOutputTokens: 8192 },
    function (v) { return unwrapBy_(v, function (o) { return "score" in o || Array.isArray(o.flags); }); });
  // 원문에 없는 표현은 버리기
  r.flags = (r.flags || []).filter(function (f) { return f && f.phrase && text.indexOf(f.phrase) !== -1; });
  return r;
}

/* =================================================================
   5. AI 학습 플랜  (ai-tutor-plan.html → {type:"plan", subject, grade, exam, target, days, minutes, memo, total, totalMax, units}
                    응답 {plan:{summary, strengths, weaknesses, plan, checkpoints, tip}})
   ================================================================= */
var PLAN_TYPES = ["개념", "문제", "오답", "복습", "모의"];

function plan_(key, body) {
  var x = planClean_(body);
  if (!x.units.length) throw { code: "no_units" };

  var lines = x.units.map(function (u) {
    var r = Object.keys(u.reasons).map(function (k) { return k + " " + u.reasons[k] + "점"; }).join(", ");
    return "- " + u.name + ": " + u.score + "/" + u.max + "점 (" + u.rate + "%)" +
      (u.wrong ? ", 틀린 문항 " + u.wrong + "개" : "") + (r ? ", 잃은 점수 원인: " + r : "");
  }).join("\n");

  var sys = [
    "너는 한국 고등학교 학생의 학습 코치다. 시험 결과를 분석해서 학생이 실제로 따라 할 수 있는 학습 플랜을 만든다.",
    "규칙:",
    "1. 반드시 아래 JSON 객체 하나만 출력한다. 마크다운, 설명 문장 금지.",
    "2. plan 은 정확히 " + x.days + "일. 하루 tasks 는 2~4개, 하루 minutes 합계는 " + x.minutes + "분(±5분).",
    "3. 우선순위: 잃은 점수가 크고 정답률이 낮은 단원 먼저. 강점 단원은 짧게 유지 복습만.",
    "4. 같은 단원을 이틀 이상 연달아 두지 말고, 3~4일마다 앞에서 공부한 내용을 다시 보는 복습을 넣는다(간격 반복).",
    (x.days >= 3 ? "5. 마지막 날은 시간을 재고 푸는 모의 풀이와 오답 최종 점검으로 구성한다." : "5. 기간이 짧으니 가장 큰 약점 1~2개에 집중한다."),
    "6. 할 일 title 은 구체적으로: 단원 이름 + 무엇을 몇 개/어떻게 (예: '복소수 켤레 성질 정리 후 교과서 예제 5문제'). 특정 출판사·교재 이름은 쓰지 않는다.",
    "7. type 은 개념/문제/오답/복습/모의 중 하나.",
    "8. 잃은 점수 원인(개념 부족, 실수·계산, 시간 부족, 문제 이해, 잘 모름)에 맞는 공부 방법을 strategy 에 쓴다.",
    "9. 학생에게 존댓말(해요체), 격려하되 과장하지 않는다. 입력에 없는 점수나 사실을 지어내지 않는다. " + PLAIN_MATH,
    "10. 메모에 힘들어하는 신호(자해, 죽고 싶다, 너무 괴롭다 등)가 있으면 tip 에 담임·상담 선생님이나 청소년상담 1388에 이야기해 보라고 부드럽게 안내한다.",
    "",
    "JSON 형식:",
    '{"summary":"2~3문장 총평","strengths":["강점 단원과 한 줄 설명"],' +
    '"weaknesses":[{"unit":"단원","level":"높음|보통|낮음","cause":"예상 원인 한 문장","strategy":"공부 방법 한두 문장"}],' +
    '"plan":[{"day":1,"focus":"그날 핵심 한 줄","tasks":[{"title":"할 일","minutes":20,"type":"개념"}]}],' +
    '"checkpoints":["플랜 중간·끝에 스스로 확인할 것"],"tip":"공부 습관 조언 한두 문장"}'
  ].join("\n");

  var user = [
    "과목: " + x.subject + (x.grade ? " / 학년: " + x.grade : "") + (x.exam ? " / 시험: " + x.exam : ""),
    "총점: " + x.total + "/" + x.totalMax + (x.target ? " / 목표 점수: " + x.target : ""),
    "플랜 기간: " + x.days + "일, 하루 공부 시간: " + x.minutes + "분",
    "단원별 결과:",
    lines,
    x.memo ? "학생 메모: " + x.memo : ""
  ].join("\n");

  var o = geminiJSON_(key, sys, [{ role: "user", parts: [{ text: user }] }], { temperature: 0.5, maxOutputTokens: 8192 },
    function (v) { return unwrapBy_(v, function (o) { return Array.isArray(o.plan) && o.plan.length > 0; }); });
  var plan = planNormalize_(o, x);
  if (!plan.plan.length) throw { code: "invalid_json" };
  return { plan: plan };
}

function planClean_(b) {
  var units = (Array.isArray(b.units) ? b.units : []).slice(0, 30).map(function (u) {
    var max = Math.max(0, Number(u && u.max) || 0);
    var score = Math.min(max, Math.max(0, Number(u && u.score) || 0));
    var reasons = {};
    if (u && u.reasons && typeof u.reasons === "object") {
      Object.keys(u.reasons).slice(0, 6).forEach(function (k) { reasons[clip_(k, 12)] = Math.round(Number(u.reasons[k]) || 0); });
    }
    return { name: clip_(u && u.name, 40).trim(), score: score, max: max,
      rate: max ? Math.round(score / max * 100) : 0,
      wrong: Math.max(0, Math.round(Number(u && u.wrong) || 0)), reasons: reasons };
  }).filter(function (u) { return u.name && u.max > 0; });

  return {
    subject: clip_(b.subject || "기타", 20), grade: clip_(b.grade || "", 10), exam: clip_(b.exam || "", 40),
    target: Number(b.target) > 0 ? Number(b.target) : null,
    days: Math.min(14, Math.max(1, Math.round(Number(b.days) || 7))),
    minutes: Math.min(300, Math.max(10, Math.round(Number(b.minutes) || 60))),
    memo: clip_(b.memo || "", 400), total: Number(b.total) || 0, totalMax: Number(b.totalMax) || 0,
    units: units
  };
}

function planNormalize_(o, x) {
  var arr = function (v) { return Array.isArray(v) ? v : []; };
  var plan = arr(o.plan).slice(0, x.days).map(function (d, i) {
    return {
      day: i + 1,
      focus: clip_(d && d.focus, 60),
      tasks: arr(d && d.tasks).slice(0, 5).map(function (t) {
        return {
          title: clip_(t && t.title, 90),
          minutes: Math.min(240, Math.max(5, Math.round(Number(t && t.minutes) || 10))),
          type: PLAN_TYPES.indexOf(t && t.type) >= 0 ? t.type : "문제"
        };
      }).filter(function (t) { return t.title; })
    };
  }).filter(function (d) { return d.tasks.length; });

  return {
    summary: clip_(o.summary, 400),
    strengths: arr(o.strengths).slice(0, 5).map(function (s) { return clip_(s, 100); }).filter(String),
    weaknesses: arr(o.weaknesses).slice(0, 6).map(function (w) {
      return { unit: clip_(w && w.unit, 40),
        level: ["높음", "보통", "낮음"].indexOf(w && w.level) >= 0 ? w.level : "보통",
        cause: clip_(w && w.cause, 160), strategy: clip_(w && w.strategy, 240) };
    }).filter(function (w) { return w.unit; }),
    plan: plan,
    checkpoints: arr(o.checkpoints).slice(0, 5).map(function (s) { return clip_(s, 120); }).filter(String),
    tip: clip_(o.tip, 300)
  };
}

/* =================================================================
   6. AI 면접  (ai-interview.html → {type:"interview", action:"questions"|"feedback", …})
      questions 응답 {summary, keywords, questions:[{q,intent,basis}]}
      feedback  응답 {total, level, summary, criteria, competency, flags, strengths, improvements, betterAnswer, followUp}
   ================================================================= */
var IV_MAX_DOC = 60000;      // 첨부 자료 최대 글자 수 (생기부 전체가 대부분 들어가요)
var IV_MAX_IMAGES = 24;      // 스캔 쪽·사진 최대 장수
var IV_MAX_ANSWER = 2000;    // 답변 최대 글자 수
var IV_CRITERIA = ["질문 이해", "논리 구조", "구체성", "전공·진로 연계", "전달력"];

function interview_(key, body) {
  if (body.action === "questions") return ivQuestions_(key, body);
  if (body.action === "feedback") return ivFeedback_(key, body);
  throw { code: "bad_request" };
}

// 질문 유형별 개수를 count에 맞춰 나눠요 (비율 유지 · 앞 유형부터 한 개씩 채운 뒤 비율대로)
function ivSplit_(count, weights) {
  var n = weights.length, out = weights.map(function () { return 0; }), left = count;
  for (var i = 0; i < n && left > 0; i++) { out[i] = 1; left--; }          // 유형마다 먼저 1개씩
  var sum = weights.reduce(function (a, w) { return a + w; }, 0);
  while (left > 0) {                                                    // 남은 건 비율보다 가장 모자란 유형에
    var best = 0, gap = -Infinity;
    for (var j = 0; j < n; j++) { var g = count * weights[j] / sum - out[j]; if (g > gap) { gap = g; best = j; } }
    out[best]++; left--;
  }
  return out;
}

function ivQuestions_(key, b) {
  var major = clip_(b.major, 40);
  var level = ["기본", "보통", "심화"].indexOf(b.level) >= 0 ? b.level : "보통";
  var count = Math.min(15, Math.max(3, Math.round(Number(b.count) || 6)));
  var doc = clip_(b.docText, IV_MAX_DOC);
  var images = (Array.isArray(b.images) ? b.images : []).slice(0, IV_MAX_IMAGES).filter(function (x) { return typeof x === "string" && x.length > 100; });
  var hasDoc = !!(doc || images.length || b.pdfBase64);
  if (!hasDoc && !major) throw { code: "no_document" };
  // 이미 만든 질문 (질문 더 만들기용) — 겹치지 않게 해요
  var exclude = (Array.isArray(b.exclude) ? b.exclude : []).slice(0, 40).map(function (x) { return clip_(x, 200); }).filter(Boolean);

  var types, weights;
  if (hasDoc) {
    types = ["전공 기초 개념 확인", "자료 속 활동을 구체적으로 검증하는 질문(무엇을 왜 했고 무엇을 배웠는지)", "심화·확장", "전공과 관련된 사회·윤리 이슈"];
    weights = [2, 2, 1, 1];
  } else {
    types = ["학과 지원 동기·관심을 갖게 된 계기",
      "학과와 이어지는 고등학교 교과 개념을 묻는 질문(대학 전공 지식이 아니라 고교 교과서에서 배운 내용으로 답할 수 있게, 어느 과목인지 떠올릴 수 있게)",
      "학과 관련 탐구·활동 경험을 묻는 질문(어떤 학생이든 자기 경험으로 답할 수 있게 열린 형태로)",
      "학과와 관련된 최근 사회 이슈나 윤리 문제에 대한 생각",
      "대학 입학 후 학업 계획이나 졸업 후 진로"];
    weights = [1, 2, 1, 1, 1];
  }

  function buildSys(n) {
    var split = ivSplit_(n, weights);
    var plan = types.map(function (t, i) { return split[i] ? "  · " + t + " " + split[i] + "개" : ""; }).filter(Boolean).join("\n");
    var head = hasDoc ? [
      "너는 대학 학생부종합전형 면접관(입학사정관)이다. 고등학생이 낸 자료(학교생활기록부, 자기소개서, 탐구 보고서, 전공 자료 등)를 읽고 실제 면접에서 물을 질문을 만든다.",
      "규칙:",
      "- 질문은 반드시 정확히 " + n + "개. questions 배열에 " + n + "개를 모두 넣는다. 구성:",
      plan,
      "- 자료에 없는 활동을 지어내지 말 것. 활동 검증 질문은 자료 속 구체적 표현을 근거로 삼을 것. 자료 속 서로 다른 활동을 골고루 다룰 것.",
      "- 학생 이름, 학교명 등 개인 정보는 질문에 넣지 말 것. 인적·학적사항, 출결, 성적표 숫자는 질문 근거로 쓰지 말 것.",
      "- 자료가 글과 사진(스캔한 쪽)으로 함께 오면 둘을 하나의 자료로 보고 읽는다.",
      "- 희망 전공이 비어 있으면 자료에서 가장 드러나는 진로를 추정해 쓴다."
    ] : [
      "너는 대학 학생부종합전형 면접관(입학사정관)이다. 학생 자료 없이 지원 학과만 보고, 그 학과에 지원한 고등학생에게 실제 면접에서 물을 질문을 만든다.",
      "규칙:",
      "- 질문은 반드시 정확히 " + n + "개. questions 배열에 " + n + "개를 모두 넣는다. 구성:",
      plan,
      "- 반드시 고등학생 수준으로. 대학 전공 서적에만 나오는 전문 용어나 지식을 묻지 않는다. 고등학생이 교과 수업, 독서, 뉴스로 알 수 있는 범위에서 묻는다.",
      "- 같은 유형 안에서도 서로 다른 주제·과목을 다룬다.",
      "- 학과 이름이 모호하면 가장 일반적인 뜻으로 해석한다.",
      "- 특정 학생의 경험을 가정하지 않는다 (\"~한 경험이 있다고 했는데\" 같은 표현 금지)."
    ];
    var tail = [
      "- 난이도: " + level + " (기본=고교 교과 개념 확인 위주, 보통=교과서 응용, 심화=원리·비교·한계까지 묻기).",
      "- 1분 안에 답할 수 있는 한 문장 질문. 존댓말 의문문. 한 질문에 하나만 묻기. 서로 비슷한 질문을 내지 않는다.",
      "- " + PLAIN_MATH,
      "JSON 객체 하나만 출력(배열로 감싸지 말 것):",
      hasDoc
        ? '{"summary":"자료를 2문장 이내로 요약","keywords":["핵심 키워드 최대 6개"],"questions":[{"q":"질문","intent":"평가하려는 것 (20자 이내)","basis":"자료 근거 또는 \'전공 일반\' (30자 이내)"}]}'
        : '{"summary":"이 학과 면접에서 주로 보는 점을 2문장 이내로","keywords":["이 학과와 이어지는 고교 과목·핵심 개념 최대 6개"],"questions":[{"q":"질문","intent":"평가하려는 것 (20자 이내)","basis":"관련 고교 과목이나 주제 (20자 이내)"}]}'
    ];
    return head.concat(tail).join("\n");
  }

  var base = hasDoc
    ? "희망 전공: " + (major || "(미입력)") + "\n\n[학생 자료]\n" + (doc || "(첨부한 사진을 읽어 줘)") + (images.length ? "\n\n[스캔·사진 " + images.length + "장 첨부]" : "")
    : "지원 학과: " + major;
  function ask(n, avoid) {
    var text = base + (avoid.length ? "\n\n[이미 낸 질문 — 이것과 겹치지 않는 새 질문만]\n" + avoid.map(function (x) { return "- " + x; }).join("\n") : "");
    var parts = [{ text: text }];
    images.forEach(function (data) { parts.push({ inline_data: { mime_type: "image/jpeg", data: data } }); });
    if (b.pdfBase64) parts.push({ inline_data: { mime_type: "application/pdf", data: String(b.pdfBase64) } });   // 예전 페이지용
    return geminiJSON_(key, buildSys(n), [{ role: "user", parts: parts }], { temperature: 0.8, maxOutputTokens: 8192 },
      function (v) { return unwrapBy_(v, function (o) { return Array.isArray(o.questions) && o.questions.length > 0; }); });
  }

  var seen = {};
  exclude.forEach(function (x) { seen[ivKey_(x)] = 1; });
  function take(list, into) {
    (list || []).forEach(function (q) {
      var t = clip_(q && (q.q || q.question), 200).trim();
      if (!t || seen[ivKey_(t)] || into.length >= count) return;
      seen[ivKey_(t)] = 1;
      into.push({ q: t, intent: clip_(q.intent, 40), basis: clip_(q.basis, 60) });
    });
  }

  var r = ask(count, exclude), qs = [];
  take(r.questions, qs);
  // 모델이 요청보다 적게 주면 모자란 만큼 한 번 더 만들어 채워요
  if (qs.length < count) {
    try {
      var more = ask(count - qs.length, exclude.concat(qs.map(function (x) { return x.q; })));
      take(more.questions, qs);
    } catch (e) { if (!qs.length) throw e; }
  }

  return {
    summary: clip_(r.summary, 300),
    keywords: (Array.isArray(r.keywords) ? r.keywords : []).slice(0, 6).map(function (k) { return clip_(k, 20); }).filter(Boolean),
    questions: qs
  };
}
// 띄어쓰기·문장부호를 빼고 비교해서 같은 질문을 걸러요
function ivKey_(t) { return String(t).replace(/[\s.,?!'"“”‘’·~\-]/g, ""); }

function ivFeedback_(key, b) {
  var answer = clip_(b.answer, IV_MAX_ANSWER);
  if (answer.replace(/\s/g, "").length < 10) throw { code: "too_short" };
  var m = b.metrics || {};
  var limit = Math.min(300, Math.max(15, Math.round(Number(m.limit) || 60)));   // 답변 제한 시간(초)
  var limitText = limit % 60 === 0 ? (limit / 60) + "분" : limit > 60 ? Math.floor(limit / 60) + "분 " + (limit % 60) + "초" : limit + "초";
  var lenLo = Math.round(limit * 4.7), lenHi = Math.round(limit * 5.8);         // 1분 ≈ 280~350자

  var sys = [
    "너는 따뜻하지만 정확한 대학 면접 코치이자 입학사정관이다. 고등학생의 " + limitText + " 면접 답변을 평가한다.",
    "답변은 음성 인식으로 받아 적은 글이라 띄어쓰기·맞춤법·잘못 들린 단어가 있을 수 있다. 이것은 감점하지 말고 뜻으로 판단한다.",
    "평가 항목(각 1~5점, 정수): " + IV_CRITERIA.join(", ") + ".",
    "- 질문 이해: 질문이 묻는 것에 바로 답했는가 (두괄식인가)",
    "- 논리 구조: 주장 → 근거/경험 → 배운 점·마무리 흐름이 있는가",
    "- 구체성: 실제 경험, 수치, 과정, 자기 역할이 드러나는가",
    "- 전공·진로 연계: 지원 전공이나 진로와 자연스럽게 이어지는가 (공통 인성 질문이면 공동체·성장과의 연결로 본다)",
    "- 전달력: 말하기 지표(답변 시간, 말 속도, 습관어, 말 없는 시간)와 문장 길이를 참고. 제한 시간이 " + limitText + "이므로 " + Math.round(limit * 0.75) + "~" + limit + "초 동안 답하면 적당하고, 말 속도는 분당 250~380음절이 적당하다.",
    "competency는 대입 평가 3요소(학업역량, 진로역량, 공동체역량)에 이 답변이 보여 준 정도를 1~5로.",
    "flags: 대입 면접 블라인드 규정상 말하면 안 되는 내용(출신 고교명, 부모·친척의 직업이나 직위, 본인 이름, 사교육·교외 수상)이 답변에 있으면 짧게 지적. 없으면 빈 배열.",
    "strengths 2~3개, improvements 2~3개: 학생이 다음 답변에서 바로 해 볼 수 있는 구체적 행동으로. 학생 답변의 실제 표현을 짚어 말한다.",
    "betterAnswer: 학생이 말한 경험과 생각만 살려 " + limitText + " 분량(띄어쓰기 포함 " + lenLo + "~" + lenHi + "자)으로 다듬은 예시. 학생 답변에 없는 경험·수상·수치를 지어내지 말고, 부족한 부분은 [구체적 경험 예: ○○] 처럼 빈칸으로 남긴다.",
    "followUp: 실제 면접관이 이 답변을 듣고 이어서 물을 꼬리질문 1개 (답변의 약한 고리를 파고드는 질문).",
    "말투: 학생에게 말하듯 친절한 해요체. summary는 한 문장. 마크다운(**, #)을 쓰지 않는다.",
    "JSON 객체 하나만 출력(배열로 감싸지 말 것):",
    '{"summary":"","criteria":[{"name":"질문 이해","score":3,"comment":"한 문장"}],"competency":{"학업역량":3,"진로역량":3,"공동체역량":3},"flags":[],"strengths":[],"improvements":[],"betterAnswer":"","followUp":""}'
  ].join("\n");

  var user = [
    "질문 유형: " + clip_(b.qtype, 10),
    "질문: " + clip_(b.question, 300),
    b.intent ? "질문 의도: " + clip_(b.intent, 60) : "",
    "희망 전공: " + (clip_(b.major, 40) || "(미입력)"),
    "말하기 지표: 답변 " + ivNum_(m.secs) + "초(제한 " + limit + "초), 분당 " + ivNum_(m.spm) + "음절, 습관어 " + ivNum_(m.fillers) + "회" +
      (m.fillerTop ? "(" + clip_(m.fillerTop, 60) + ")" : "") +
      ", 말 없는 시간 " + (m.silence == null ? "측정 안 됨" : ivNum_(m.silence) + "%"),
    "",
    "[학생 답변]",
    answer
  ].filter(function (x) { return x !== ""; }).join("\n");

  var r = geminiJSON_(key, sys, [{ role: "user", parts: [{ text: user }] }], { temperature: 0.5, maxOutputTokens: 8192 },
    function (v) { return unwrapBy_(v, function (o) { return Array.isArray(o.criteria); }); });

  // 항목 이름·개수를 고정하고 총점은 서버에서 계산해요
  var list = r.criteria, byName = {};
  list.forEach(function (c) { if (c && c.name) byName[String(c.name).trim()] = c; });
  var criteria = IV_CRITERIA.map(function (name, i) {
    // 이름이 맞는 항목을 먼저 쓰고, 이름이 다르게 왔으면 같은 순서의 항목을 써요 (다른 항목 이름이면 안 써요)
    var p = list[i], pName = p && String(p.name || "").trim();
    var c = byName[name] || (p && IV_CRITERIA.indexOf(pName) < 0 ? p : {}) || {};
    return { name: name, score: ivScore_(c.score), comment: clip_(c.comment, 160) };
  });
  var total = criteria.reduce(function (a, c) { return a + c.score; }, 0) * 4;
  var comp = r.competency || {};
  return {
    total: total,
    level: total >= 85 ? "우수" : total >= 70 ? "양호" : total >= 55 ? "보통" : "보완 필요",
    summary: clip_(r.summary, 200),
    criteria: criteria,
    competency: { "학업역량": ivScore_(comp["학업역량"]), "진로역량": ivScore_(comp["진로역량"]), "공동체역량": ivScore_(comp["공동체역량"]) },
    flags: ivList_(r.flags, 3, 120),
    strengths: ivList_(r.strengths, 3, 200),
    improvements: ivList_(r.improvements, 3, 200),
    betterAnswer: clip_(r.betterAnswer, Math.max(700, lenHi + 200)),
    followUp: clip_(r.followUp, 200)
  };
}

function ivScore_(v) { v = Math.round(Number(v)); return isNaN(v) ? 3 : Math.max(1, Math.min(5, v)); }
function ivList_(a, n, len) { return (Array.isArray(a) ? a : []).slice(0, n).map(function (s) { return clip_(s, len); }).filter(Boolean); }
function ivNum_(v) { v = Number(v); return isNaN(v) ? "?" : Math.round(v); }

/* =================================================================
   공통 도구
   ================================================================= */

// Gemini에 묻고 JSON을 받아요.
// pick(파싱한 값, 원문)이 원하는 모양을 돌려주면 끝, null이면 다음 모델로 한 번 더 시도해요.
function geminiJSON_(key, system, contents, opts, pick) {
  var last = { code: "invalid_json" };
  for (var m = 0; m < MODELS.length; m++) {
    var text;
    try { text = callModel_(MODELS[m], key, system, contents, opts); }
    catch (err) {
      if (err && err.next) { last = { code: err.code }; continue; }   // 이 모델만 안 됨 → 다음 모델
      throw err;
    }
    var v = pick(parseJSON_(text), text);
    if (v) return v;
    console.warn(MODELS[m] + " 형식 오류 (다음 모델로 넘어가요): " + text.slice(0, 500));
    last = { code: "invalid_json" };
  }
  throw last;
}

// 모델 하나를 불러 받은 글(text)을 돌려줘요. 붐빌 때(503)는 잠깐 쉬었다가 한 번 더 시도해요.
function callModel_(model, key, system, contents, opts) {
  opts = opts || {};
  var payload = {
    contents: contents,
    generationConfig: {
      responseMimeType: "application/json",
      temperature: opts.temperature == null ? 0.7 : opts.temperature
    }
  };
  if (opts.maxOutputTokens) payload.generationConfig.maxOutputTokens = opts.maxOutputTokens;
  if (system) payload.systemInstruction = { parts: [{ text: system }] };

  for (var attempt = 0; attempt < 2; attempt++) {
    var res = UrlFetchApp.fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent",
      {
        method: "post",
        contentType: "application/json",
        headers: { "x-goog-api-key": key },
        muteHttpExceptions: true,
        payload: JSON.stringify(payload)
      }
    );
    var code = res.getResponseCode();
    var raw = res.getContentText();

    if (code === 200) {
      var data = JSON.parse(raw);
      if (data.promptFeedback && data.promptFeedback.blockReason) throw { code: "refused" };
      var cand = data.candidates && data.candidates[0];
      if (!cand || cand.finishReason === "SAFETY" || cand.finishReason === "PROHIBITED_CONTENT") throw { code: "refused" };
      var text = ((cand.content && cand.content.parts) || []).map(function (p) { return p.text || ""; }).join("").trim();
      if (!text) throw { code: "invalid_json", next: true };
      return text;
    }

    if (code === 503 && attempt === 0) { Utilities.sleep(1500); continue; }   // 같은 모델 재시도
    console.warn(model + " " + code + " (다음 모델로 넘어가요) " + raw.slice(0, 200));
    if (code === 429) throw { code: "rate_limited", next: true };   // 이 모델 한도 초과
    if (code === 404) throw { code: "overloaded", next: true };     // 모델 이름 없음
    if (code >= 500) throw { code: "overloaded", next: true };
    if (code === 401 || code === 403) throw { code: "auth" };
    if (code === 400 && /API key|API_KEY/i.test(raw)) throw { code: "auth" };
    throw { code: "invalid_json" };
  }
  throw { code: "overloaded", next: true };
}

// 응답 글에서 JSON 꺼내기 (코드블록이나 앞뒤 설명이 붙어도 처리)
function parseJSON_(text) {
  function tryParse(s) { try { return JSON.parse(s); } catch (e) { return undefined; } }
  text = String(text || "").trim();
  var v = tryParse(text);
  if (v !== undefined) return v;
  var fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { v = tryParse(fence[1]); if (v !== undefined) return v; }
  var a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a >= 0 && b > a) { v = tryParse(text.slice(a, b + 1)); if (v !== undefined) return v; }
  return null;
}

// [ {...} ], {"plan": {...}} 처럼 한 번 더 감싸서 와도 원하는 객체를 꺼내요.
function unwrapBy_(v, ok) {
  for (var i = 0; i < 3 && v; i++) {
    if (Array.isArray(v)) { v = v[0]; continue; }
    if (typeof v !== "object") break;
    if (ok(v)) return v;
    var inner = Object.keys(v).map(function (k) { return v[k]; })
      .filter(function (x) { return x && typeof x === "object"; });
    if (inner.length === 1) { v = inner[0]; continue; }
    break;
  }
  return null;
}

function key_() {
  var props = PropertiesService.getScriptProperties();
  for (var i = 0; i < KEY_NAMES.length; i++) {
    var v = props.getProperty(KEY_NAMES[i]);
    if (v) return v;
  }
  return "";
}

// 1분 단위 사용량 제한 (bucket: "teacher", "tutor", "interview")
function rateOk_(bucket) {
  var limit = bucket === "tutor" ? LIMIT_TUTOR : bucket === "interview" ? LIMIT_INTERVIEW : LIMIT_TEACHER;
  var cache = CacheService.getScriptCache();
  var slot = "rl_" + bucket + "_" + Math.floor(Date.now() / 60000);
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(3000);
    var n = Number(cache.get(slot) || 0) + 1;
    cache.put(slot, String(n), 120);
    return n <= limit;
  } catch (e) {
    return true;   // 잠금 실패 시에는 막지 않아요
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function clip_(s, n) { return String(s == null ? "" : s).slice(0, n); }

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* =================================================================
   테스트 (편집기 함수 목록에서 골라 실행 → 아래 실행 로그 확인)
   ================================================================= */
function 테스트_(label, body) {
  var res = doPost({ postData: { contents: JSON.stringify(body) } }).getContent();
  var ok = res.indexOf('"error"') === -1;
  console.log((ok ? "OK   " : "실패 ") + label + "  " + res.slice(0, 200));
  return ok;
}

function 수업설계테스트() { 테스트_("수업 설계", { request: "고1 수학 이차함수의 최대·최소 50분" }); }
function 수행평가테스트() { 테스트_("수행평가", { type: "assessment", request: "고1 정보 파이썬 리스트 활용 프로그램 만들기\n[조건] 채점 단계: 3단계(상·중·하), 만점: 20점" }); }
function 튜터테스트() { 테스트_("AI 튜터", { type: "tutor", action: "chat", subject: "정보", level: 2, studyMode: "concept", history: [{ role: "user", text: "for문이 아직 잘 이해되지 않아요." }] }); }
function 생기부테스트() { 테스트_("AI 생기부", { type: "record", action: "write", area: "교과 세부능력 및 특기사항", subject: "통합과학", memo: "기후위기 조별 발표함 그래프 직접 그림 / 질문 대답 못했는데 담시간에 정리해옴", constraints: ["모든 문장을 '~함', '~임' 같은 명사형 종결로 끝맺을 것", "학생 이름은 쓰지 말 것"], limitChars: 300 }); }

function 학습플랜테스트() { 테스트_("AI 학습 플랜", { type: "plan", subject: "수학", grade: "고1", exam: "2학기 중간고사", target: 85, days: 5, minutes: 60, total: 68, totalMax: 100, units: [{ name: "다항식의 연산", score: 18, max: 20 }, { name: "복소수", score: 10, max: 20, wrong: 3, reasons: { "개념 부족": 10 } }, { name: "이차방정식", score: 12, max: 20, wrong: 2, reasons: { "문제 이해": 8 } }] }); }

function 면접질문테스트() { 테스트_("AI 면접 질문", { type: "interview", action: "questions", major: "컴퓨터공학과", level: "보통", docText: "정보 교과 세특: 파이썬으로 급식 메뉴 알림 프로그램을 제작하고, 사용자 피드백을 받아 알레르기 정보 필터 기능을 추가함. 정렬 알고리즘의 시간 복잡도를 비교하는 탐구 보고서를 작성함." }); }
function 면접학과질문테스트() { 테스트_("AI 면접 학과 질문", { type: "interview", action: "questions", major: "간호학과", level: "보통" }); }
function 면접피드백테스트() { 테스트_("AI 면접 피드백", { type: "interview", action: "feedback", question: "이 학과에 지원한 동기는 무엇인가요?", qtype: "공통", major: "컴퓨터공학과", answer: "음 저는 어 고등학교 2학년 때 정보 시간에 파이썬으로 급식 메뉴 알림 프로그램을 만들면서 코딩에 흥미를 느꼈습니다 친구들이 실제로 쓰는 걸 보고 사람들에게 도움이 되는 소프트웨어를 만들고 싶다고 생각해서 지원하게 되었습니다", metrics: { secs: 32, spm: 290, fillers: 2, fillerTop: "음(1), 어(1)", silence: 20 } }); }

function 전체테스트() {
  수업설계테스트();
  수행평가테스트();
  튜터테스트();
  생기부테스트();
  학습플랜테스트();
  면접질문테스트();
  면접학과질문테스트();
  면접피드백테스트();
}