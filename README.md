# 🤖 AI 팀 단톡방

대표 AI(팀장)가 요청을 읽고 **주특기가 맞는 AI에게 순서대로 일을 나누고**, 담당 AI들이 결과를 올리면 **대표 AI가 검토·보완 지시 후 최종 결론**을 정리하는 멀티 에이전트 단톡방 웹앱입니다.

- 순수 HTML/CSS/JS (빌드 없음) → GitHub Pages에서 `index.html`로 바로 실행
- API 키 1개(Gemini 무료)로 대표 AI + 모든 에이전트 동작, OpenAI·Claude 키를 섞어 쓰기도 지원
- 키가 없어도 **데모 모드**로 배분 → 실행 → 검토 흐름을 그대로 체험
- 셋톡처럼 **외부 AI(레몬 등)를 링크·복붙으로 참여**시키는 브리지 UI
- 모바일·PC 반응형, PWA(홈 화면 추가), 여러 채팅방, Markdown 내보내기
- 선택적 **동기화 서버**(Cloudflare Workers + D1 등) 연결 준비

## 빠른 시작

1. `index.html`을 브라우저로 열거나, 로컬 서버를 띄웁니다.

   ```bash
   python3 -m http.server 8080
   # http://localhost:8080
   ```

2. 처음에는 **데모 모드**입니다. 인트로 카드의 예시를 누르거나 아무 질문이나 보내 보세요.
   `👑 작업 배분 → 담당 AI 실행 → 👑 검토·결론` 흐름이 그대로 재생됩니다.

3. 실제 AI로 돌리려면 **⚙️ 설정 → API 키**에 Gemini 키를 넣고 **데모 모드**를 끕니다.
   - Gemini 무료 키: <https://aistudio.google.com/apikey>
   - OpenAI/Anthropic 키는 선택. 에이전트별로 프로바이더·모델을 따로 지정할 수 있습니다.
   - 키는 `localStorage`에만 저장되며 코드에 하드코딩되지 않습니다.

## 기본 팀

| 에이전트 | 주특기 |
|---|---|
| 👑 대표 AI | 작업 분석·배분·검토 총괄 (삭제 불가, 프롬프트/모델 수정 가능) |
| 🧱 3D 모델링 | STL 설계·치수·공차·경량화·Bambu Lab P2S 출력 설정 |
| 💼 업무지원 | 문서 작성·요약·일정 정리·기획·실무 자동화 |
| 🛒 쇼핑 | 가격 비교·가성비·해외직구·구매 조건 |
| ✈️ 여행 | 일정 동선·숙소 비교·교통·날씨·예산 |
| 📈 주식관리 | 종목·섹터 분석·리스크·포트폴리오·시황 |
| 🍋 레몬 | 외부 AI(링크·복붙 참여) 예시 |

에이전트는 **+ 추가**로 자유롭게 만들 수 있고, 이름·이모지·색상·주특기·상세 지침·활성 여부·모델을 편집할 수 있습니다.

## 사용법

### 대표 AI 자동 배분 (기본)
질문을 보내면 대표 AI가 활성 에이전트의 주특기를 보고 1~3명을 **순서대로** 지목합니다.
담당 AI는 앞선 AI의 결과를 이어받아 작성하고, 마지막에 대표 AI가 검수합니다.
부족하면 **1회 보완 재지시** 후 다시 검토하고 최종 결론을 냅니다.

### @로 직접 호출
`@3D 모델링` 처럼 입력하면 대표 AI 배분을 건너뛰고 해당 AI가 바로 작업합니다.
입력창의 `@` 버튼이나 아래 에이전트 칩을 눌러도 됩니다.

### 외부 AI 참여 (링크·복붙)
API가 없는 AI(레몬, 뮤즈, 키링 등)도 방에 참여시킬 수 있습니다.

1. 에이전트 추가 → **참여 방식: 외부 AI(링크·복붙)**
2. 채팅창의 **📋 대화 복사** → 최근 대화 + 역할 지시가 클립보드에 복사됩니다.
3. 외부 AI에 붙여넣고 받은 답변을 **⬆️ 외부 AI 답 올리기**에서 대상 AI를 골라 게시합니다.
4. `@레몬`처럼 부르면 호출 카드가 만들어지고, 카드의 **지시문 복사** 버튼으로 바로 넘길 수 있습니다.

### 채팅방
- `+ 새 방`, 방 목록 전환, 이름 변경·대화 비우기·삭제(⋯ 메뉴)
- 모든 대화·설정은 `localStorage`에 자동 저장
- **⤓** 버튼 또는 방 메뉴 → **Markdown 내보내기**

### 테마
헤더의 ◐ 버튼으로 다크/라이트 전환. 설정에도 저장됩니다.

## 동기화 서버 (선택)

설정의 **동기화 서버 URL**과 **방 키**를 비워 두면 완전 로컬로 동작합니다.
서버를 붙이면 기기 간에 같은 방 대화를 이어볼 수 있습니다.

메시지 형식(모든 메시지에 공통):

```json
{
  "id": "m_lz3k9a1",
  "room_id": "room_lx8f2",
  "author_type": "user | agent | system",
  "author_id": "a-shop",
  "author_name": "쇼핑",
  "role": "가격 비교·가성비 분석",
  "text": "…",
  "tag": "plan | review | final | external | null",
  "ts": 1764200000000,
  "created_at": "2026-11-27T07:00:00.000Z"
}
```

서버가 구현해야 할 최소 API:

```
GET  {server}/api/rooms/{roomKey}/messages?since={ISO8601}
     → 200 {"messages": [ … ]}
POST {server}/api/rooms/{roomKey}/messages
     body {"room":{"id":"…","title":"…"}, "messages":[ … ]}
     → 200 {"ok": true}
```

- `id`를 기본키로 upsert하면 중복이 생기지 않습니다.
- `roomKey`가 방 접근 키 역할을 하므로 추측하기 어려운 값을 쓰세요.
- 설정의 **동기화 테스트 / 지금 동기화** 버튼으로 연결을 확인할 수 있습니다.
- CORS: Worker에서 `Access-Control-Allow-Origin` 허용이 필요합니다.

## 배포 (GitHub Pages)

```bash
git init
git add .
git commit -m "AI 팀 단톡방"
git branch -M main
git remote add origin https://github.com/<user>/ai-team-chat.git
git push -u origin main
```

저장소 **Settings → Pages → Source: Deploy from a branch → main / (root)** 로 지정하면
`https://<user>.github.io/ai-team-chat/` 에서 바로 열립니다. (`.nojekyll` 포함됨)

## Android APK (WebView 패키징)

이 앱은 서버가 필요 없는 정적 페이지라 WebView 래퍼로 바로 감쌀 수 있습니다.

- `start_url`은 `https://<user>.github.io/ai-team-chat/` (또는 앱에 `assets/`로 복사 후 `file:///android_asset/index.html`)
- `localStorage` 유지: `settings.setDomStorageEnabled(true)`
- 클립보드: `WebView`에서 `navigator.clipboard`가 동작하도록 `WebChromeClient` 권한 처리
- 파일 다운로드(Markdown 내보내기): `DownloadListener` 연결
- PWA 매니페스트·아이콘이 이미 포함되어 있어 TWA(Trusted Web Activity) 방식도 가능

## 보안·한계

- API 키는 브라우저 `localStorage`에 저장됩니다. 공용 PC나 배포된 사이트에서는 각자 자신의 키를 넣으세요.
- 정적 앱이라 서버가 없고, 대화는 기본적으로 기기 밖으로 나가지 않습니다(입력한 AI 프로바이더 API 제외).
- 무료 티어는 분당/일일 쿼터가 있습니다. 429 오류가 나면 잠시 후 다시 시도하거나 모델을 바꾸세요.
- AI가 만든 가격·일정·수치는 틀릴 수 있습니다. 결제·예약 전에 원본에서 확인하세요.
- 외부 AI 답변은 사용자가 직접 붙여넣은 내용이므로, 민감한 정보가 섞이지 않도록 주의하세요.

## 파일 구조

```
index.html              화면 마크업 (모달 포함)
assets/styles.css       테마·레이아웃·반응형
js/util.js              공용 헬퍼
js/markdown.js          안전한 Markdown 렌더러
js/store.js             기본 팀·설정·방·localStorage
js/llm.js               Gemini/OpenAI/Anthropic 호출
js/orchestrator.js      배분 → 실행 → 검토(+데모 시뮬레이션)
js/sync.js              선택적 동기화 클라이언트
js/ui.js                렌더링·이벤트·외부 AI 브리지
js/app.js               부트스트랩
manifest.webmanifest    PWA 매니페스트
sw.js                   오프라인 앱 셸 캐시
icons/                  앱 아이콘 (192/512/apple)
```
