// Khóa scroll body dùng chung (đếm tham chiếu): Modal và drawer mobile cùng khóa; chỉ mở khi người cuối cùng mở khóa (B3-1).
let count = 0;

export function lockScroll(): void {
  if (count++ === 0) document.body.style.overflow = 'hidden';
}

export function unlockScroll(): void {
  if (count > 0 && --count === 0) document.body.style.overflow = '';
}
