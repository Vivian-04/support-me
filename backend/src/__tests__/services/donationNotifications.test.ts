jest.mock("../../prisma", () => ({
  __esModule: true,
  default: {
    creator: { findUnique: jest.fn(), findFirst: jest.fn() },
    user: { findUnique: jest.fn() },
  },
}));

jest.mock("../../services/email/mailer", () => ({
  sendEmail: jest.fn().mockResolvedValue(undefined),
}));

import { Donation, Goal, Prisma } from "@prisma/client";
import prisma from "../../prisma";
import { sendEmail } from "../../services/email/mailer";
import {
  notifyDonationConfirmation,
  notifyDonationReceived,
  notifyGoalsReached,
} from "../../services/donationNotifications";

const mockedPrisma = prisma as unknown as {
  creator: { findUnique: jest.Mock; findFirst: jest.Mock };
  user: { findUnique: jest.Mock };
};
const mockedSendEmail = sendEmail as jest.MockedFunction<typeof sendEmail>;

const DONATION: Donation = {
  id: 1,
  creatorId: 7,
  senderAddress: "GA7D5LDGFABXNYEO6LZVMTWK5JWEPTODCLYZ7TG4XDZRKKXP6OS5K5JW",
  amount: new Prisma.Decimal(25),
  currency: "XLM",
  message: "keep it up!",
  transactionHash: "abc123",
  verified: true,
  onChainEventId: null,
  rpcEventId: null,
  operationIndex: 0,
  eventIndex: 0,
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedSendEmail.mockResolvedValue(undefined);
  // Default: the supporter is not itself a known creator, so the receipt shows
  // the truncated address only. Tests that care override this.
  mockedPrisma.creator.findFirst.mockResolvedValue(null);
});

describe("notifyDonationReceived (#17)", () => {
  it("emails the creator with the donation amount, sender, and message", async () => {
    mockedPrisma.creator.findUnique.mockResolvedValue({
      id: 7,
      displayName: "Bob",
      user: { email: "bob@example.com" },
    });

    const sent = await notifyDonationReceived(DONATION);

    expect(sent).toBe(true);
    expect(mockedSendEmail).toHaveBeenCalledTimes(1);
    const message = mockedSendEmail.mock.calls[0][0];
    expect(message.to).toBe("bob@example.com");
    expect(message.text).toContain("25");
    expect(message.text).toContain("XLM");
    expect(message.text).toContain("keep it up!");
  });

  it("never includes the full sender wallet address, only a truncated form", async () => {
    mockedPrisma.creator.findUnique.mockResolvedValue({
      id: 7,
      username: "bob",
      user: { email: "bob@example.com" },
    });

    await notifyDonationReceived(DONATION);

    const message = mockedSendEmail.mock.calls[0][0];
    expect(message.text).not.toContain(DONATION.senderAddress);
    expect(message.html).not.toContain(DONATION.senderAddress);
  });

  it("returns false and sends nothing when the creator has no email on file", async () => {
    mockedPrisma.creator.findUnique.mockResolvedValue({ id: 7, user: { email: null } });

    const sent = await notifyDonationReceived(DONATION);

    expect(sent).toBe(false);
    expect(mockedSendEmail).not.toHaveBeenCalled();
  });

  it("returns false when the creator record itself cannot be found", async () => {
    mockedPrisma.creator.findUnique.mockResolvedValue(null);

    const sent = await notifyDonationReceived(DONATION);

    expect(sent).toBe(false);
    expect(mockedSendEmail).not.toHaveBeenCalled();
  });

  it("surfaces a send failure in the log rather than reporting success", async () => {
    mockedPrisma.creator.findUnique.mockResolvedValue({
      id: 7,
      username: "bob",
      user: { email: "bob@example.com" },
    });
    mockedSendEmail.mockRejectedValue(new Error("provider down"));
    const logged = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const sent = await notifyDonationReceived(DONATION);

    // The caller treats a missing email as "not sent" (false), and the failure
    // is logged rather than swallowed silently, so an outage is diagnosable
    // without turning a committed donation into a 500 for the client.
    expect(sent).toBe(false);
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining(`donation ${DONATION.id}`),
      "provider down"
    );
  });

  it("names the supporter in the receipt when they are themselves a known creator", async () => {
    mockedPrisma.creator.findUnique.mockResolvedValue({
      id: 7,
      username: "bob",
      displayName: "Bob",
      user: { email: "bob@example.com" },
    });
    mockedPrisma.creator.findFirst.mockResolvedValue({ id: 9, username: "supporter", displayName: "Sam Supporter" });

    await notifyDonationReceived(DONATION);

    const message = mockedSendEmail.mock.calls[0][0];
    expect(message.text).toContain("Sam Supporter");
  });
});

describe("notifyDonationConfirmation (#17)", () => {
  it("emails the supporter when their wallet matches a known account with an email", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({
      id: 3,
      walletAddress: DONATION.senderAddress,
      email: "supporter@example.com",
    });
    mockedPrisma.creator.findUnique.mockResolvedValue({ id: 7, displayName: "Bob" });

    const sent = await notifyDonationConfirmation(DONATION);

    expect(sent).toBe(true);
    expect(mockedSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "supporter@example.com" })
    );
  });

  it("falls back to the creator's username when displayName is unset", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({ email: "supporter@example.com" });
    mockedPrisma.creator.findUnique.mockResolvedValue({ id: 7, username: "bob", displayName: null });

    await notifyDonationConfirmation(DONATION);

    const message = mockedSendEmail.mock.calls[0][0];
    expect(message.text).toContain("bob");
  });

  it("returns false when the supporter's wallet address is not a known account (the common case)", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue(null);

    const sent = await notifyDonationConfirmation(DONATION);

    expect(sent).toBe(false);
    expect(mockedSendEmail).not.toHaveBeenCalled();
  });

  it("returns false when the known account has no email on file", async () => {
    mockedPrisma.user.findUnique.mockResolvedValue({ email: null });

    const sent = await notifyDonationConfirmation(DONATION);

    expect(sent).toBe(false);
    expect(mockedSendEmail).not.toHaveBeenCalled();
  });
});

describe("notifyGoalsReached", () => {
  const GOAL: Goal = {
    id: 3,
    creatorId: 7,
    title: "Buy a new laptop",
    description: null,
    targetAmount: 500,
    currentAmount: 510,
    currency: "XLM",
    status: "COMPLETED",
    recurring: false,
    recurrenceInterval: null,
    currentPeriodEnd: null,
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
  };

  it("emails the creator for each goal that reached its target", async () => {
    mockedPrisma.creator.findUnique.mockResolvedValue({ id: 7, user: { email: "bob@example.com" } });

    await notifyGoalsReached([GOAL]);

    expect(mockedPrisma.creator.findUnique).toHaveBeenCalledWith({
      where: { id: 7 },
      include: { user: true },
    });
    expect(mockedSendEmail).toHaveBeenCalledTimes(1);
    const message = mockedSendEmail.mock.calls[0][0];
    expect(message.to).toBe("bob@example.com");
    expect(message.subject).toBe("You reached your goal: Buy a new laptop!");
  });

  it("skips creators without an email address", async () => {
    mockedPrisma.creator.findUnique.mockResolvedValue({ id: 7, user: { email: null } });

    await notifyGoalsReached([GOAL]);

    expect(mockedSendEmail).not.toHaveBeenCalled();
  });

  it("does not throw when the email provider fails", async () => {
    mockedPrisma.creator.findUnique.mockResolvedValue({ id: 7, user: { email: "bob@example.com" } });
    mockedSendEmail.mockRejectedValue(new Error("provider down"));
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});

    await expect(notifyGoalsReached([GOAL])).resolves.toBeUndefined();

    consoleError.mockRestore();
  });
});
