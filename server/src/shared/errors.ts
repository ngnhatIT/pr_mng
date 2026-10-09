/**
 * Lỗi nghiệp vụ của ứng dụng.
 * Ném AppError thay vì res.status(...).json(...) rải rác —
 * errorHandler tập trung ở cuối sẽ chuyển thành response HTTP chuẩn.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, message: string, code = 'APP_ERROR') {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
  }

  static badRequest(message: string, code = 'BAD_REQUEST'): AppError {
    return new AppError(400, message, code);
  }
  static unauthorized(message = 'Vui lòng đăng nhập', code = 'UNAUTHORIZED'): AppError {
    return new AppError(401, message, code);
  }
  static forbidden(message = 'Không có quyền thực hiện', code = 'FORBIDDEN'): AppError {
    return new AppError(403, message, code);
  }
  static notFound(message = 'Không tìm thấy dữ liệu', code = 'NOT_FOUND'): AppError {
    return new AppError(404, message, code);
  }
  static conflict(message: string, code = 'CONFLICT'): AppError {
    return new AppError(409, message, code);
  }
  static tooManyRequests(message: string, code = 'RATE_LIMITED'): AppError {
    return new AppError(429, message, code);
  }
}
