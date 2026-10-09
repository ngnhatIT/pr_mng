/// <reference types="vite/client" />

// Runtime (trình duyệt hiện đại) hỗ trợ Error `cause` (ES2022),
// trong khi tsconfig lib đang là ES2020. Khai báo tối thiểu để dùng
// `new Error(message, { cause })` mà không nới toàn bộ lib.
interface ErrorOptions {
  cause?: unknown;
}

interface ErrorConstructor {
  new (message?: string, options?: ErrorOptions): Error;
  (message?: string, options?: ErrorOptions): Error;
}
