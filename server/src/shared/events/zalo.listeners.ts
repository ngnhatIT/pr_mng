import { eventBus } from './eventBus';
import { HomeworkPublishedEvent } from './homework.events';
import { notifyHomework } from '../../modules/homework/homework.notify';
import { logger } from '../logger';

const log = logger.scope('zalo-listener');

/**
 * Listener: gửi thông báo Zalo khi bài tập được đăng.
 * Tách khỏi business logic — service chỉ phát event, không biết Zalo tồn tại.
 */
async function handleHomeworkPublished(event: HomeworkPublishedEvent): Promise<void> {
  try {
    await notifyHomework(event.centerId, event.homeworkId);
  } catch (err) {
    log.warn('Gửi Zalo thất bại', {
      homeworkId: event.homeworkId,
      correlationId: event.correlationId,
      error: String(err),
    });
  }
}

/** Đăng ký tất cả listeners liên quan Zalo. Gọi 1 lần khi khởi động app. */
export function registerZaloListeners(): void {
  eventBus.on<HomeworkPublishedEvent>('homework.published', handleHomeworkPublished);
  log.info('Đã đăng ký Zalo listeners');
}
