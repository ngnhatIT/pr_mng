import { BaseEvent } from './eventBus';

/**
 * Domain events cho tài chính (invoices, payments).
 */

export class InvoiceCreatedEvent extends BaseEvent {
  readonly name = 'invoice.created';
  constructor(
    public readonly invoiceId: number,
    public readonly studentId: number,
    public readonly amount: number,
    public readonly centerId: number | null,
    correlationId?: string
  ) {
    super(correlationId);
  }
}

export class PaymentClaimedEvent extends BaseEvent {
  readonly name = 'payment.claimed';
  constructor(
    public readonly paymentId: number,
    public readonly invoiceId: number,
    public readonly amount: number,
    correlationId?: string
  ) {
    super(correlationId);
  }
}

export class PaymentApprovedEvent extends BaseEvent {
  readonly name = 'payment.approved';
  constructor(
    public readonly paymentId: number,
    public readonly invoiceId: number,
    public readonly amount: number,
    public readonly centerId: number | null,
    correlationId?: string
  ) {
    super(correlationId);
  }
}

export class PaymentRejectedEvent extends BaseEvent {
  readonly name = 'payment.rejected';
  constructor(
    public readonly paymentId: number,
    public readonly invoiceId: number,
    correlationId?: string
  ) {
    super(correlationId);
  }
}
