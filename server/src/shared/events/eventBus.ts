import { randomBytes } from 'crypto';
import { logger } from '../logger';

/**
 * Event Bus — nền tảng kiến trúc event-driven (chuẩn enterprise).
 *
 * Tại sao cần:
 * - Business logic (tạo bài tập, chấm điểm) KHÔNG gọi trực tiếp Zalo/Audit/Cache
 * - Mỗi side-effect là 1 listener độc lập: thêm/bớt không đụng code nghiệp vụ
 * - Dễ test: test service không cần mock Zalo, chỉ assert event được phát
 * - Sau này scale: thay in-memory bus bằng RabbitMQ/Kafka mà không sửa services
 *
 * Ví dụ:
 *   eventBus.emit(new HomeworkPublishedEvent(homeworkId, centerId));
 *   // → ZaloListener gửi thông báo, AuditListener ghi log — tự động
 */

export interface DomainEvent {
  /** Tên event: 'homework.published', 'quiz.submitted'... */
  readonly name: string;
  /** Thời điểm phát (ISO). */
  readonly occurredAt: string;
  /** ID tương quan để trace qua các listeners. */
  readonly correlationId: string;
}

type EventHandler<E extends DomainEvent = DomainEvent> = (event: E) => void | Promise<void>;

const busLog = logger.scope('eventBus');

class EventBus {
  private handlers = new Map<string, EventHandler[]>();
  private wildcardHandlers: EventHandler[] = [];

  /** Đăng ký listener cho 1 loại event. */
  on<E extends DomainEvent>(eventName: string, handler: EventHandler<E>): () => void {
    const list = this.handlers.get(eventName) ?? [];
    list.push(handler as EventHandler);
    this.handlers.set(eventName, list);
    // Trả về hàm unsubscribe
    return () => {
      const l = this.handlers.get(eventName) ?? [];
      this.handlers.set(
        eventName,
        l.filter((h) => h !== handler)
      );
    };
  }

  /** Đăng ký listener cho MỌI event (dùng cho audit/logging). */
  onAny(handler: EventHandler): () => void {
    this.wildcardHandlers.push(handler);
    return () => {
      this.wildcardHandlers = this.wildcardHandlers.filter((h) => h !== handler);
    };
  }

  /** Phát event — chạy tuần tự các listeners, không throw ra ngoài. */
  async emit(event: DomainEvent): Promise<void> {
    const handlers = this.handlers.get(event.name) ?? [];
    for (const h of [...handlers, ...this.wildcardHandlers]) {
      try {
        await h(event);
      } catch (err) {
        // Listener lỗi không được làm hỏng flow chính — nhưng PHẢI log,
        // không nuốt im lặng (vd: Zalo notification lỗi = mất thông báo).
        busLog.error('event listener failed', {
          event: event.name,
          correlationId: event.correlationId,
          error: String(err),
        });
      }
    }
  }

  /** Phát event đồng bộ (fire-and-forget) — dùng khi không cần chờ listeners. */
  emitSync(event: DomainEvent): void {
    void this.emit(event);
  }

  /** Xóa tất cả listeners (dùng trong test). */
  clear(): void {
    this.handlers.clear();
    this.wildcardHandlers = [];
  }
}

/** Singleton bus dùng chung toàn app. */
export const eventBus = new EventBus();

/** Base class cho domain events — tự sinh occurredAt. */
export abstract class BaseEvent implements DomainEvent {
  abstract readonly name: string;
  readonly occurredAt: string = new Date().toISOString();
  readonly correlationId: string;

  constructor(correlationId?: string) {
    // correlationId ngắn để dễ đọc trong log (8 ký tự hex từ CSPRNG)
    this.correlationId = correlationId || randomBytes(4).toString('hex');
  }
}
