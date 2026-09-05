# TreeNav 개발 일지

## 2026-09-05 — Phase 1 · 2 완료, 중첩/정렬 확장, 저장소 개설

### 오늘 도달한 상태

Phase 1과 Phase 2가 모두 동작 확인되었고, 지시서에 없던 확장(노트 중첩, 수동 정렬,
자동 평탄화)까지 들어갔다. 저장소를 만들고 GPL-3.0으로 공개 준비를 시작했다.

**동작 확인된 것**

- TreeNav 사이드바 뷰, 리본 아이콘, `Open TreeNav` 커맨드
- 폴더 펼침/접기 + 재시작 후 복원, 활성 노트 표시
- 파일/폴더 Drag & Drop, 잘못된 이동 사전 차단
- 인라인 이름 변경(F2), 새 노트/폴더 생성 후 즉시 이름 편집
- Folder Note (`Folder/Folder.md`), 목록에서 숨김, **양방향 이름 동기화**
- 외부(탐색기 등) 변경 자동 반영
- 아이콘 / 색 / 굵기 / 기울임 / 크기 지정, 경로 이동·이름 변경 시 유지
- 키보드 네비게이션 (`↑↓←→`, `Enter`, `F2`, `Delete`, `Ctrl/⌘+N`, `Ctrl/⌘+Shift+N`)
- 컨텍스트 메뉴, `Move to…` 폴더 검색 이동
- **노트를 노트 아이콘에 떨궈 하위로 중첩**, 이름 위/아래에 떨궈 순서 지정
- **폴더 내 수동 순서 저장**, 마지막 자식이 빠지면 **자동 평탄화**

### 설계에서 붙잡고 있는 원칙

**1. 별도 트리 모델을 두지 않는다.** `TFolder.children`을 직접 읽는다. 중복 상태가
없으니 외부 변경과 어긋날 여지가 구조적으로 사라진다.

**2. 경로가 유일한 키다.** Obsidian은 안정적인 파일 ID를 제공하지 않는다. 그래서
펼침 상태 · 스타일 · 수동 순번 · 중첩으로 만든 폴더 목록을 전부 경로로 키잉하고,
`rename` 이벤트마다 **하나의 prefix 재작성 패스**로 함께 이관한다. 폴더 rename은
자식마다 이벤트가 오지 않으므로 이 방식이 유일한 실용해다.

**3. Folder Note 규칙을 재사용해 개념을 늘리지 않는다.** 중첩은 새로운 개념이
아니라 `A.md` → `A/A.md` 변환일 뿐이다. 그래서 중첩된 노트의 이름 변경 · 이동 ·
스타일 유지가 전부 기존 로직으로 처리된다.

**4. 행이 자리를 물려받으면 상태도 물려받는다.** 중첩하면 폴더 행이 노트 행의
자리를 차지하므로 폴더가 노트의 순번·스타일을 승계하고, 평탄화하면 반대로
노트가 폴더의 것을 승계한다. 이 대칭이 깨지면 위치가 튀고 스타일이 사라진다.
(실제로 두 방향 모두 버그로 한 번씩 겪었다.)

**5. vault 변경은 전부 공식 API로.** `fileManager.renameFile`(링크 갱신 포함),
`fileManager.trashFile`(사용자 휴지통 설정 존중). filesystem 직접 조작 없음.

### 겪은 버그와 근본 원인 (재발 방지용)

**뷰 전체가 빈 화면** — `TreeNavView`에 추가한 `open()` 메서드가 Obsidian `View`의
**내부 `open()`** 을 덮어썼다. 이 메서드는 `obsidian.d.ts`에 없어서 TypeScript가
잡지 못하는데, 런타임에서 `WorkspaceLeaf`가 뷰를 마운트할 때 호출한다. 뷰가
마운트 단계에서 죽어 `onOpen`이 아예 실행되지 않았다.
→ 액션 메서드를 `openItem` / `renameItem` 등으로 개명. 스모크 테스트에
**예약어 가드**를 넣어 재발 시 빌드가 실패하도록 했다.

**폴더 rename 시 폴더 노트가 따라오지 않음** — rename 이벤트 시점에 자식 파일의
경로가 아직 갱신되지 않아 경로 조회가 `null`을 반환했다.
→ 경로 문자열 대신 `folder.children`에서 객체로 찾는다. 경로 갱신 타이밍과 무관해진다.

**중첩 후 항목이 맨 아래로 이동** — 경로가 `A.md` → `A`로 바뀌어 새 폴더가 순번 없는
항목이 됐다. 스타일도 같이 사라졌다. → 위 원칙 4.

**평탄화 후 스타일·위치 소실** — 승계를 한 방향으로만 구현했다. → 위 원칙 4.

**진단 과정 자체의 실패** — 증상 보고를 받고 코드를 눈으로 좇으며 추측을 반복했다.
검증 수단부터 만들었어야 했다. 그래서 스모크 테스트를 만들었고, 이후 버그들은
전부 테스트가 먼저 잡았다.

### 검증 수단

`scripts/smoke-test.mjs` — jsdom 위에서 **빌드된 `main.js`를 실제로 로드·렌더링**한다.
Obsidian API는 stub이고, 가짜 vault는 변경 가능하며 `rename` / `create` / `delete`
이벤트를 실제처럼 발생시킨다(경로 이관 로직이 여기에 의존하므로 필수).

검증 항목: 렌더링 · 폴더 노트 숨김 · 수동 순서 · 스타일 적용 · 아이콘 통일 ·
자식 없는 폴더의 화살표 · 중첩 · 평탄화 · 사용자 폴더 보호 · 예약어 가드.

`npm run build`가 `타입체크 → 번들 → 스모크 테스트` 순으로 돌기 때문에 하나라도
실패하면 배포 파일이 나가지 않는다.

### 남은 작업

**결정이 필요한 것**

1. **모바일** — `manifest.json`이 `isDesktopOnly: false`인데 HTML5 DnD라 터치에서
   드래그가 동작하지 않는다. 터치 DnD를 구현하거나 데스크톱 전용으로 표시해야 한다.
   지금 상태로 스토어에 올리면 모바일 사용자가 바로 문제를 겪는다.
2. **대용량 성능** — 지시서 §14의 수천 개 파일 요구사항을 아직 실측하지 않았다.
   스모크 하네스에 합성 vault(5,000개 등)를 넣어 렌더 시간을 재면 확인된다.

**Phase 3 잔여**

- 검색 / Filter (체감 가치 최상)
- 특정 파일·폴더 숨기기
- Favorite / Pin
- 다양한 Tree 표시 옵션

(Manual Sorting은 드래그 순서 저장으로 이미 완료)

**그 외 빈틈**

- 다중 선택 (여러 파일 한 번에 드래그/삭제)
- 키보드 타입어헤드
- 활성 노트로 자동 스크롤 (auto-reveal)
- ESLint 설정 없음
- `gh` CLI 미설치 (이슈/PR 작업하려면 필요)

### 재개 방법

```bash
npm install
npm run reset          # test-vault를 알려진 fixture로 재생성 (git 미추적)
npm run dev            # 감시 빌드 + test-vault 자동 배포
npm run build          # 타입체크 + 번들 + 스모크 테스트
npm run smoke -- --vault test-vault --data test-vault/.obsidian/plugins/treenav/data.json
```

Obsidian에서 `D:\dev_projects\006_treenav_obsidian_plugin\test-vault`를 vault로
열고, 코드 수정 후 `Ctrl+P` → **Reload app without saving**.

실제 vault는 `D:\Obsidian_Files\Obsidian_HY` — `notebook-navigator`,
`manual-sorting`, `file-explorer-note-count`가 이미 설치돼 있어 탐색기 영역이
겹친다. 기능 검증은 test-vault에서 하는 편이 정확하다.

### 저장소

<https://github.com/hyrocket/treenav> · GPL-3.0-or-later

MIT에서 GPL로 바꾼 이유: MIT는 소스를 닫고 재배포하는 것을 막지 못한다. GPL은
배포되는 파생물이 GPL을 유지하고 전체 소스를 공개하도록 강제한다. 포크 자체를
막는 라이선스는 없으므로, 이름은 상표 영역으로 분리해 README에 "배포하는 포크는
개명할 것"을 명시했다.
