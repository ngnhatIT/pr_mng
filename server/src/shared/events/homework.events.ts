import { BaseEvent } from './eventBus';

/**
 * Domain events của module Homework.
 * Mỗi event mô tả "điều đã xảy ra" trong nghiệp vụ — không chứa logic xử lý.
 */

// ── Vòng đời bài tập ──

export class HomeworkCreatedEvent extends BaseEvent {
  readonly name = 'homework.created';
  constructor(
    public readonly homeworkId: number,
    public readonly centerId: number | null,
    public readonly status: string,
    public readonly kind: string,
    correlationId?: string
  ) {
    super(correlationId);
  }
}

export class HomeworkPublishedEvent extends BaseEvent {
  readonly name = 'homework.published';
  constructor(
    public readonly homeworkId: number,
    public readonly centerId: number | null,
    correlationId?: string
  ) {
    super(correlationId);
  }
}

export class HomeworkUnpublishedEvent extends BaseEvent {
  readonly name = 'homework.unpublished';
  constructor(
    public readonly homeworkId: number,
    public readonly centerId: number | null,
    correlationId?: string
  ) {
    super(correlationId);
  }
}

export class HomeworkDeletedEvent extends BaseEvent {
  readonly name = 'homework.deleted';
  constructor(
    public readonly homeworkId: number,
    public readonly centerId: number | null,
    correlationId?: string
  ) {
    super(correlationId);
  }
}

// ── Quiz ──

export class QuizSubmittedEvent extends BaseEvent {
  readonly name = 'quiz.submitted';
  constructor(
    public readonly homeworkId: number,
    public readonly studentId: number,
    public readonly attemptId: number,
    public readonly score: number,
    public readonly maxScore: number,
    correlationId?: string
  ) {
    super(correlationId);
  }
}

export class HomeworkGradedEvent extends BaseEvent {
  readonly name = 'homework.graded';
  constructor(
    public readonly homeworkId: number,
    public readonly studentId: number,
    public readonly score: number | null,
    public readonly gradedBy: number | null,
    correlationId?: string
  ) {
    super(correlationId);
  }
}

export class HomeworkCompletedEvent extends BaseEvent {
  readonly name = 'homework.completed';
  constructor(
    public readonly homeworkId: number,
    public readonly studentId: number,
    public readonly completedBy: string,
    correlationId?: string
  ) {
    super(correlationId);
  }
}
