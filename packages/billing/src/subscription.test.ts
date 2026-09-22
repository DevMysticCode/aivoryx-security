import { describe, expect, it } from 'vitest';
import {
  computeSeatUsage,
  canAddMember,
  assertSeatAvailable,
  SeatLimitExceededError,
} from './subscription.js';

describe('computeSeatUsage', () => {
  it('counts active and invited members toward usage', () => {
    const usage = computeSeatUsage({ seatLimit: 10, activeMemberCount: 6, invitedMemberCount: 2 });
    expect(usage).toEqual({ seatLimit: 10, usedSeats: 8, availableSeats: 2, atLimit: false });
  });

  it('reports atLimit when usage equals the seat limit', () => {
    const usage = computeSeatUsage({ seatLimit: 5, activeMemberCount: 5, invitedMemberCount: 0 });
    expect(usage.atLimit).toBe(true);
    expect(usage.availableSeats).toBe(0);
  });

  it('never returns a negative availableSeats even if usage exceeds the limit', () => {
    const usage = computeSeatUsage({ seatLimit: 3, activeMemberCount: 4, invitedMemberCount: 1 });
    expect(usage.availableSeats).toBe(0);
    expect(usage.atLimit).toBe(true);
  });
});

describe('canAddMember', () => {
  it('allows adding a member within the seat limit', () => {
    expect(canAddMember({ seatLimit: 10, activeMemberCount: 5, invitedMemberCount: 0 })).toBe(true);
  });

  it('blocks adding a member at the seat limit', () => {
    expect(canAddMember({ seatLimit: 5, activeMemberCount: 5, invitedMemberCount: 0 })).toBe(false);
  });

  it('accounts for pending invitations against the limit', () => {
    expect(canAddMember({ seatLimit: 5, activeMemberCount: 3, invitedMemberCount: 2 })).toBe(false);
  });
});

describe('assertSeatAvailable', () => {
  it('does not throw when a seat is available', () => {
    expect(() =>
      assertSeatAvailable({ seatLimit: 10, activeMemberCount: 9, invitedMemberCount: 0 }),
    ).not.toThrow();
  });

  it('throws SeatLimitExceededError at the seat limit', () => {
    expect(() =>
      assertSeatAvailable({ seatLimit: 10, activeMemberCount: 10, invitedMemberCount: 0 }),
    ).toThrow(SeatLimitExceededError);
  });

  it('never silently allows unlimited members', () => {
    let blocked = false;
    for (let i = 0; i < 100; i++) {
      try {
        assertSeatAvailable({ seatLimit: 5, activeMemberCount: 5 + i, invitedMemberCount: 0 });
      } catch (error) {
        if (error instanceof SeatLimitExceededError) blocked = true;
      }
    }
    expect(blocked).toBe(true);
  });
});
