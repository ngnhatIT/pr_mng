# Frontend: các pattern dùng chung

Hợp đồng của các hook/component dùng chung trong `client/src/shared/`. Trang mới hoặc trang sửa lại nên dùng đúng các API này thay vì tự viết lại. Đường dẫn tính từ `client/src/`; từ `features/x/Page.tsx` thì import `../../shared/...`.

Cấu trúc thư mục và quy ước chung: xem [ARCHITECTURE.md](ARCHITECTURE.md#frontend-clientsrc).

## Modal và ConfirmDialog (`shared/components/Modal.tsx`)

```tsx
<Modal title onClose wide? dirty?>…<div className="modal-actions">…</div></Modal>
```

- **Focus.** Khi mở, focus vào control đầu tiên trong `.modal-body`, không vào nút X. Nếu field đầu là tùy chọn (ví dụ "Mã học viên" để trống thì tự sinh), đặt `autoFocus` lên field chính; Modal tôn trọng focus đã có sẵn. Trên màn cảm ứng thì focus khung modal để bàn phím ảo không bật lên. Khi đóng, focus trả về nút đã mở modal.
- **`dirty`.** Khi `true`, Esc, click nền và nút X mở hộp "Bỏ thay đổi chưa lưu?" (`common:discard.*`). Nút Hủy của chính form vẫn gọi thẳng `onClose`. `dirty` cũng bật `useUnsavedGuard` (xem bên dưới). Cách viết ngắn:
  `const [initial] = useState(form); <Modal dirty={JSON.stringify(form) !== JSON.stringify(initial)} …>`
- **Modal lồng nhau.** Có một stack chung, chỉ modal trên cùng xử lý phím. Focus bị giữ trong modal (Tab/Shift+Tab xoay vòng). Esc trong lúc gõ IME (Telex, `isComposing`/keyCode 229) bị bỏ qua.
- **Khóa scroll.** Dùng `lockScroll()` / `unlockScroll()` của `shared/scrollLock.ts` (đếm tham chiếu). Modal khóa khi mount, mở khi unmount; drawer mobile trong `Layout.tsx` cũng khóa khi mở. `body` chỉ hết `overflow: hidden` khi người khóa cuối cùng mở khóa, nên đóng hộp xác nhận lúc drawer còn mở không làm trang cuộn được. Không gán `document.body.style.overflow` trực tiếp ở chỗ khác, và không lưu/trả lại giá trị cũ theo từng modal (modal và hộp xác nhận unmount cùng một commit thì giá trị `'hidden'` đã lưu sẽ đè lên).
- **`hideClose`.** Ẩn nút X cho modal bắt buộc. Caller tự truyền `onClose` không làm gì để Esc và click nền cũng không đóng (ví dụ form đổi mật khẩu bắt buộc).
- **CSS.** `.modal-body` cuộn, còn `.modal-body .modal-actions` dính ở đáy. Ở màn ≤600px modal thành bottom sheet.
- **`ConfirmDialog`** nhận `title, message, onClose, onConfirm, danger?, confirmLabel?`. `onConfirm` có thể async. Trong lúc chạy, nút bị khóa và có spinner, còn Esc, nền và X không đóng được. Focus mặc định rơi vào nút Hủy (nút đầu tiên), nên Enter không vô tình xác nhận hành động nguy hiểm.

## Chặn rời trang khi form chưa lưu (`shared/hooks/useUnsavedGuard.ts`, `app/App.tsx`)

`useUnsavedGuard(dirty)` dùng cho form cả trang (Attendance, Roles, PaymentConfig…). Modal có `dirty` đã tự gọi hook này.

- Reload, đóng tab hoặc gõ URL khác: trình duyệt hỏi qua `beforeunload`.
- Bấm link trong app hoặc Back: `<UnsavedChangesPrompt>` hiện ConfirmDialog. Cả app chỉ có MỘT `useBlocker`, đặt ở route gốc, vì data router chỉ dùng blocker được đăng ký sau cùng. Vì vậy không gọi `useBlocker` trong từng form. Đổi query trên cùng trang (`?page=`, `?tab=`) thì không bị chặn.

## Tải dữ liệu: `useLoad` + `LoadError` (`shared/hooks/useLoad.ts`, `shared/components/EmptyState.tsx`)

```ts
const { data, loading, error, reload, setData } = useLoad(
  (signal) => studentsApi.list(search, status, { page }),
  [search, status, page]
);
```

- Bấm "Thử lại" mà `LoadError` biến mất (tải lại thành công), focus chuyển về `#main-content` thay vì rơi về `<body>`.
  `EmptyState icon="alert"` (kể cả `LoadError`) có `role=alert`.
- `deps` hoạt động như của useEffect. Fetcher được đọc qua ref nên viết arrow inline cũng được. Mỗi khi deps đổi hoặc gọi `reload()`, request trước bị abort và kết quả của nó bị bỏ qua, nên response cũ về muộn không đè lên kết quả mới.
- `data` giữ giá trị thành công gần nhất trong lúc tải lại và cả khi lỗi. `setData(prev => next)` dùng để cập nhật lạc quan.
- Thứ tự render:
  ```tsx
  loading && !data ? (
    <TableSkeleton />
  ) : error && !data ? (
    <LoadError onRetry={reload} />
  ) : rows.length === 0 ? (
    <EmptyState />
  ) : (
    <table />
  );
  ```
  Không hiện trạng thái "trống / thêm mục đầu tiên" khi tải lỗi.
- Toast lỗi tải: `useEffect(() => { if (error) toastApiError(toast, error, t('x.loadError')) }, [error, toast])`.
- Sau khi thêm, sửa hoặc xóa thì gọi `reload()`. `clampPage(page, totalPages)` (`shared/components/Pagination.tsx`) đặt ở call site: khi xóa dòng cuối của trang cuối thì lùi về trang hợp lệ.

## Trạng thái trên URL: `useUrlState` + `useUrlSearch` (`shared/hooks/useUrlState.ts`)

Trang, bộ lọc và từ khóa nằm trên URL để Back từ trang chi tiết quay lại đúng chỗ và gửi link lọc được cho người khác.

```tsx
const [q, setQ] = useUrlState({ search: '', status: '', page: '1' });
const [search, setSearch] = useUrlSearch(q.search, (v) => setQ({ search: v, page: '1' }));
useLoad(() => api.list(q.search, q.status, { page: Number(q.page) }), [q.search, q.status, q.page]);

<input value={search} onChange={(e) => setSearch(e.target.value)} />
<select value={q.status} onChange={(e) => setQ({ status: e.target.value, page: '1' })} />
<Pagination pagination={p} onChange={(n) => setQ({ page: String(n) })} />
```

- **`useUrlState`.** Mọi giá trị là string. Key bằng giá trị mặc định thì bị xóa khỏi URL. Các param khác (`?tab=`) được giữ nguyên. Luôn dùng history `replace`. Gộp mọi thay đổi của một sự kiện vào MỘT lần gọi `setQ`, vì gọi hai lần trong cùng tick thì lần sau đè lần trước.
- **Ô gõ chữ KHÔNG bind thẳng `value={q.search}`.** Data router (RR7) cập nhật URL trong transition, tức là bất đồng bộ. Input controlled vì thế bị React trả về giá trị cũ sau mỗi phím, làm con trỏ nhảy về cuối và vỡ IME. Dùng `useUrlSearch` thay thế:
  - chữ đang gõ nằm ở state cục bộ;
  - chỉ giá trị đã debounce (mặc định 350 ms, tham số thứ ba để đổi) mới được ghi lên URL qua `commit`;
  - URL đổi từ bên ngoài (Back, hoặc `setQ` của nút "Xóa bộ lọc") thì được đồng bộ ngược vào ô.
    Fetch theo `q.search`, giá trị này đã được debounce. Spinner "đang tìm" có thể hiện khi `search !== q.search`. Nút xóa bộ lọc gọi cả `setSearch('')` lẫn `setQ({...})`.
- Select, checkbox và tab đổi giá trị theo từng click, nên bind thẳng `q.x` được. Tab cũng phải suy ra từ URL (như `Tuition`), không giữ một bản sao trong `useState`.

## Toast lỗi API (`shared/ui/toast.tsx`)

`toastApiError(toast, err, fallbackText)` thay cho `toast(err.message || X, 'error')`.

- Server gửi câu nghiệp vụ cụ thể bằng tiếng Việt. Khi UI là tiếng Việt, câu của server được dùng. Khi UI là tiếng Anh, hoặc mã lỗi là `INTERNAL_ERROR`, dùng text dịch theo mã (`api.errors.<code>`).
- Không có message thì dùng `fallbackText`. `request_id` được gắn kèm để người dùng báo lỗi cho support.
- Bỏ qua (không toast) lỗi có UI riêng: `PASSWORD_CHANGE_REQUIRED` (PasswordChangeGate mở form đổi mật khẩu) và `SESSION_EXPIRED` (`api()` gắn mã này cho lỗi 401 hết phiên; UnauthorizedListener toast + về trang login).
- `ToastProvider` gộp toast trùng: cùng type + message trong 2 giây chỉ hiện 1 lần (nhiều request lỗi cùng lúc).
- Deep-link sau đăng nhập (`edu_next`): `takePostLoginRedirect(home)` chỉ trả link thuộc portal của role vừa đăng nhập (`/app`, `/teacher`, `/parent`); link của portal khác bị bỏ, về home của role.

## Ô nhập tiền (`shared/components/Form.tsx`)

```tsx
<Field label={t('amount')} error={errors.amount} required>
  <MoneyInput value={amount} onChange={setAmount} ref={refFor('amount')} />
</Field>
```

- Input là `type="text" inputMode="numeric"`, nên con lăn chuột không đổi giá trị. Chỉ giữ chữ số, và hiện số tiền đã định dạng (formatVND) bên dưới.
- `value` nhận string, number hoặc numeric của DB (`"1500000.00"`). `onChange` trả về chuỗi chữ số, hoặc `''` khi trống. Khi submit thì dùng `Number(amount)`. Hàm chuẩn hóa thuần là `moneyDigits(v)`.
- `<Field required>` tự thêm dấu `*` (aria-hidden), nên label trong locale KHÔNG được có `" *"` ở cuối.

## Quyền (`features/system/roles.api.ts`)

`useMyPermissions()` (dùng trong React) và `loadMyPermissions()` (trả về Promise, dùng ngoài React) cache theo access token. Layout và mọi trang dùng chung một request duy nhất.

Gán/gỡ vai trò tùy chỉnh cho tài khoản: trang Phân quyền, mục "Người dùng có vai trò này" ở panel chi tiết vai trò
(`RoleMembers` trong `Roles.tsx`): danh sách thành viên lấy từ `GET /roles/:id` (`users[]`), chọn tài khoản từ
`GET /roles/users`, gán `POST /roles/assign`, gỡ `DELETE /roles/assign` (có ConfirmDialog). Cần `roles.manage`; vai trò
hệ thống chỉ superadmin gán/gỡ được. Lỗi 403 của server (vd vai trò mạnh hơn quyền người gán) hiện nguyên văn qua toast.

## Tab (`shared/components/Tabs.tsx`)

`<Tabs id label tabs={[{key,label}]} value onChange />` render đúng mẫu WAI-ARIA: `role=tablist/tab`, `aria-selected`,
`aria-controls`, roving `tabIndex`, phím ←/→/Home/End. `label` (bắt buộc) là tên tablist cho screen reader; key `''` có
id `<id>-tab-all`. Nội dung bọc `<div {...tabPanelProps(id, value)}>`.
Nhóm nút chọn 1 giá trị (trạng thái điểm danh, phạm vi quyền, đáp án quiz) dùng `role="group"` + `aria-pressed`
trên từng nút (mỗi nút 1 Tab stop), không dùng `role=radio` khi không có điều hướng phím mũi tên. Tab nên nằm
trên URL (`?tab=` / `useUrlState`) để refresh/Back giữ tab (Tuition, ReviewsAdmin, Homework, ChildDetail).

## Bảng trên điện thoại (`.table-stack`, `styles.css`)

Bảng danh sách thêm class `table-stack` và `data-label={cùng t(...) với <th>}` trên từng `<td>`. Ở ≤600px mỗi dòng
thành một thẻ: nhãn bên trái, giá trị bên phải; ô không có `data-label` (tên/tiêu đề làm "đầu thẻ", ô nút thao tác)
chiếm cả dòng. Không còn cuộn ngang ~1200px để tới nút Sửa/Thu tiền. `.card` bọc trực tiếp `.table-wrap` của bảng
xếp thẻ mất khung ở ≤600px (không lồng thẻ trong thẻ). Không gộp selector `tr:last-child td` vào luật chung của ô — nó
mạnh hơn `td:not([data-label])` và làm lệch thẻ cuối.

## i18n

- Bundle entry chỉ chứa namespace `common`. Các namespace khác được tải lazy khi `useTranslation([...ns])` chạy; lúc đó component suspend trong Suspense của layout.
- Quy tắc: component nào gọi `t(..., { ns: 'x' })` thì phải liệt kê `'x'` trong `useTranslation([...])`. Lệnh `i18n.t(..., { ns: 'x' })` ngoài React chỉ chạy đúng khi đã có trang dùng `x` render trước đó.
- Locale `vi` và `en` phải có cùng bộ key; test parity kiểm tra điều này, và `fallbackLng: false`.
- Trong test, `src/test-setup.ts` nạp sẵn mọi namespace.

## Router (react-router 7, data router)

- `createBrowserRouter` + `RouterProvider` (`app/App.tsx`). Phải dùng data router thì `useBlocker` mới hoạt động.
- Trong RR7, `navigate()` trả về `void | Promise<void>`. Khi gọi như một câu lệnh đứng riêng thì viết `void navigate(...)` (ESLint `no-floating-promises`). Còn `onClick={() => navigate(x)}` thì giữ nguyên được.

## Đổi mật khẩu bắt buộc (`shared/components/ChangePasswordModal.tsx`)

`PasswordChangeGate` (đặt trong `Root` của `app/App.tsx`) mở `ChangePasswordModal forced` khi user đã lưu có `must_change_password` (login/refresh trả về), hoặc khi `api()` nhận 403 `PASSWORD_CHANGE_REQUIRED` (bật cờ trên user + phát event `PASSWORD_CHANGE_EVENT`). Form bắt buộc focus ngay ô mật khẩu hiện tại (`autoFocus`, kể cả màn cảm ứng). Chỉ hiện trong khu vực cần đăng nhập (`/app`, `/teacher`, `/parent` trừ login/register). Form bắt buộc không có X/Hủy, chỉ có Đổi mật khẩu hoặc Đăng xuất. Đổi xong thì tắt cờ và gọi `tryRefresh()` để lấy token/user mới. Endpoint theo cổng: `authPath('change-password')`.

## Test có DOM

- Dòng đầu file: `// @vitest-environment happy-dom`. Dùng `createRoot` + `act` từ `react` và đặt `globalThis.IS_REACT_ACT_ENVIRONMENT = true`.
- Test có logic focus của Modal thì stub `HTMLElement.prototype.getClientRects = () => [{}]`.
- Test liên quan router thì dùng `createMemoryRouter` + `RouterProvider` (data router, giống production), không dùng `MemoryRouter`.
- Ví dụ mẫu:
  - `shared/components/Modal.test.tsx`: modal lồng nhau, khóa scroll;
  - `shared/hooks/hooks.test.tsx`: useLoad, useUrlState, gõ giữa chuỗi với useUrlSearch;
  - `app/UnsavedChangesPrompt.test.tsx`: blocker, Back/POP.
  - `shared/components/Layout.test.tsx`: drawer mobile + ConfirmDialog vẫn giữ khóa scroll.
  - `features/tuition/Tuition.test.tsx`, `features/classes/Attendance.test.tsx`: trang thật + API giả qua `src/test-utils.tsx`.
- `src/test-utils.tsx` (test DOM): `mockFetch({'GET /students': data | (call) => data | Response})` giả `fetch` theo
  method + path và trả mảng `calls` (method, path, query, body, headers) để assert request shape; request đi qua
  api module + `client.ts` thật. `renderRoutes/renderPage` render trong `ToastProvider` + data router (cố định
  tiếng Việt). `type()` / `click()` / `byText()` / `flush()`; `cleanup` trong `afterEach`. Quyền
  (`/roles/me/permissions`) cache theo token, nên mỗi test dùng một token khác nếu đổi quyền. `renderRoutes` đồng bộ
  `window.location` theo router (như production), nên logic đọc `window.location` (chọn trang login theo portal, lưu
  `edu_next`) được test đúng đường thật; `cleanup` trả URL về `/`.
- Coverage: `npm run test:coverage -w client` (v8, in text-summary). CI chạy lệnh này trong job test.
  `coverage.thresholds` trong `client/vite.config.ts` đặt sát dưới số hiện tại (lines 37%); tụt dưới ngưỡng thì fail.
  Thêm test thì nâng ngưỡng theo.

## Ngân sách bundle

Sau `npm run build`, CI chạy `node client/scripts/check-bundle-size.mjs`. Script fail khi vượt một trong các ngưỡng sau (byte, chưa gzip):

| Phần                               | Ngưỡng  |
| ---------------------------------- | ------- |
| Chunk entry                        | 70 KB   |
| First-load (entry + modulepreload) | 400 KB  |
| Tổng JS                            | 1000 KB |

Muốn tăng ngưỡng thì sửa trong script và ghi rõ lý do. Thêm trang mới thì khai báo bằng `lazyPage(() => import(...), 'Name')` trong `app/App.tsx`, không import tĩnh.
