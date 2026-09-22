/**
 * Seat accounting is deliberately simple in this batch: a seat is consumed by any
 * organization_members row that is 'active' or 'invited' (a pending invite already
 * reserves a seat so an org can't out-invite its limit). Platform users never
 * appear in organization_members for a customer org, so they can never be counted
 * here — platform access structurally cannot consume a tenant seat.
 */
export interface SeatUsageInput {
  seatLimit: number;
  activeMemberCount: number;
  invitedMemberCount: number;
}

export interface SeatUsage {
  seatLimit: number;
  usedSeats: number;
  availableSeats: number;
  atLimit: boolean;
}

export function computeSeatUsage(input: SeatUsageInput): SeatUsage {
  const usedSeats = input.activeMemberCount + input.invitedMemberCount;
  const availableSeats = Math.max(input.seatLimit - usedSeats, 0);
  return {
    seatLimit: input.seatLimit,
    usedSeats,
    availableSeats,
    atLimit: usedSeats >= input.seatLimit,
  };
}

export function canAddMember(input: SeatUsageInput): boolean {
  return computeSeatUsage(input).availableSeats > 0;
}

export class SeatLimitExceededError extends Error {
  readonly seatUsage: SeatUsage;

  constructor(seatUsage: SeatUsage) {
    super(
      `Organization has reached its seat limit (${seatUsage.usedSeats}/${seatUsage.seatLimit})`,
    );
    this.name = 'SeatLimitExceededError';
    this.seatUsage = seatUsage;
  }
}

/** Throws SeatLimitExceededError if adding one more member would exceed the seat limit. */
export function assertSeatAvailable(input: SeatUsageInput): void {
  const usage = computeSeatUsage(input);
  if (usage.availableSeats <= 0) {
    throw new SeatLimitExceededError(usage);
  }
}
