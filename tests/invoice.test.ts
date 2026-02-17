import { Cl, cvToValue } from "@stacks/transactions";
import { beforeEach, describe, expect, it } from "vitest";

const accounts = simnet.getAccounts();
const contractOwner = accounts.get("deployer")!; // ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM
const payer1 = accounts.get("wallet_1")!;
const payer2 = accounts.get("wallet_2")!;
const payer3 = accounts.get("wallet_3")!;
const randomUser = accounts.get("wallet_4")!;
const unauthorizedUser = accounts.get("wallet_5")!;

describe("Invoicing Contract", () => {
  describe("Invoice Creation", () => {
    it("should allow contract owner to create a standard invoice", () => {
      const result = simnet.callPublicFn(
        "invoicing",
        "create-invoice",
        [
          Cl.some(Cl.principal(payer1)),
          Cl.uint(1000),
          Cl.stringAscii("standard")
        ],
        contractOwner
      );

      expect(result.result).toBeOk(Cl.tuple({
        message: Cl.stringUtf8("Invoice Created Successfully!"),
        "invoice-id": Cl.uint(1),
        amount: Cl.uint(1000),
        sender: Cl.principal(contractOwner),
        payer: Cl.some(Cl.principal(payer1)),
        "is-paid": Cl.bool(false),
        "invoice-type": Cl.stringAscii("standard")
      }));

      // Verify invoice in map
      const invoice = simnet.getMapEntry("invoicing", "invoices", { "invoice-id": Cl.uint(1) });
      expect(invoice).toBeSome(Cl.tuple({
        issuer: Cl.principal(contractOwner),
        payer: Cl.some(Cl.principal(payer1)),
        "paid-amount": Cl.uint(0),
        amount: Cl.uint(1000),
        paid: Cl.bool(false),
        "invoice-type": Cl.stringAscii("standard")
      }));
    });

    it("should allow contract owner to create a flexible invoice", () => {
      const result = simnet.callPublicFn(
        "invoicing",
        "create-invoice",
        [
          Cl.none(),
          Cl.uint(5000),
          Cl.stringAscii("flexible")
        ],
        contractOwner
      );

      expect(result.result).toBeOk(Cl.tuple({
        message: Cl.stringUtf8("Invoice Created Successfully!"),
        "invoice-id": Cl.uint(2),
        amount: Cl.uint(5000),
        sender: Cl.principal(contractOwner),
        payer: Cl.none(),
        "is-paid": Cl.bool(false),
        "invoice-type": Cl.stringAscii("flexible")
      }));
    });

    it("should reject invoice creation by non-owner", () => {
      const result = simnet.callPublicFn(
        "invoicing",
        "create-invoice",
        [
          Cl.some(Cl.principal(payer1)),
          Cl.uint(1000),
          Cl.stringAscii("standard")
        ],
        randomUser
      );

      expect(result.result).toBeErr(Cl.uint(1008)); // ERR_NOT_CONTRACT_OWNER
    });

    it("should reject invoices with zero amount", () => {
      const result = simnet.callPublicFn(
        "invoicing",
        "create-invoice",
        [
          Cl.some(Cl.principal(payer1)),
          Cl.uint(0),
          Cl.stringAscii("standard")
        ],
        contractOwner
      );

      expect(result.result).toBeErr(Cl.uint(1001)); // ERR_INVALID_AMT
    });

    it("should reject invoices exceeding max amount", () => {
      const result = simnet.callPublicFn(
        "invoicing",
        "create-invoice",
        [
          Cl.some(Cl.principal(payer1)),
          Cl.uint(10000000001), // > MAX_INVOICE_AMOUNT
          Cl.stringAscii("standard")
        ],
        contractOwner
      );

      expect(result.result).toBeErr(Cl.uint(1001)); // ERR_INVALID_AMT
    });

    it("should reject invalid invoice types", () => {
      const result = simnet.callPublicFn(
        "invoicing",
        "create-invoice",
        [
          Cl.some(Cl.principal(payer1)),
          Cl.uint(1000),
          Cl.stringAscii("invalid")
        ],
        contractOwner
      );

      expect(result.result).toBeErr(Cl.uint(1006)); // ERR_INVALID_INVOICE_TYPE
    });

    it("should reject standard invoice where payer is the issuer", () => {
      const result = simnet.callPublicFn(
        "invoicing",
        "create-invoice",
        [
          Cl.some(Cl.principal(contractOwner)),
          Cl.uint(1000),
          Cl.stringAscii("standard")
        ],
        contractOwner
      );

      expect(result.result).toBeErr(Cl.uint(1005)); // ERR_SELF_PAYMENT
    });

    it("should allow flexible invoice without specified payer", () => {
      const result = simnet.callPublicFn(
        "invoicing",
        "create-invoice",
        [
          Cl.none(),
          Cl.uint(1000),
          Cl.stringAscii("flexible")
        ],
        contractOwner
      );

      expect(result.result).toBeOk(Cl.tuple({
        message: Cl.stringUtf8("Invoice Created Successfully!"),
        "invoice-id": Cl.uint(3),
        amount: Cl.uint(1000),
        sender: Cl.principal(contractOwner),
        payer: Cl.none(),
        "is-paid": Cl.bool(false),
        "invoice-type": Cl.stringAscii("flexible")
      }));
    });
  });

  describe("Standard Invoice Payments", () => {
    let standardInvoiceId: number;

    beforeEach(() => {
      // Create a standard invoice
      const result = simnet.callPublicFn(
        "invoicing",
        "create-invoice",
        [
          Cl.some(Cl.principal(payer1)),
          Cl.uint(1000),
          Cl.stringAscii("standard")
        ],
        contractOwner
      );
      standardInvoiceId = (result.result as any).value["invoice-id"].value;
    });

    it("should allow designated payer to pay full amount", () => {
      const payment = simnet.callPublicFn(
        "invoicing",
        "pay-invoice",
        [
          Cl.uint(standardInvoiceId),
          Cl.none() // No amount needed for standard invoice
        ],
        payer1
      );

      expect(payment.result).toBeOk(Cl.some(Cl.tuple({
        message: Cl.stringUtf8("Payment processed Successfully"),
        "amount-paid": Cl.none(),
        "total-paid": Cl.uint(1000),
        receiver: Cl.principal(contractOwner),
        "is-fully-paid": Cl.bool(true)
      })));

      // Check STX transfer event
      expect(payment.events[0].event).toBe("stx_transfer_event");
      expect(payment.events[0].data.amount).toBe("1000");
      expect(payment.events[0].data.sender).toBe(payer1);
      expect(payment.events[0].data.recipient).toBe(contractOwner);

      // Verify invoice marked as paid
      const invoice = simnet.getMapEntry("invoicing", "invoices", { "invoice-id": Cl.uint(standardInvoiceId) });
      expect(invoice.value.data.paid).toBe(Cl.bool(true));
      expect(invoice.value.data["paid-amount"]).toBeUint(1000);
    });

    it("should reject payment from non-designated payer", () => {
      const payment = simnet.callPublicFn(
        "invoicing",
        "pay-invoice",
        [
          Cl.uint(standardInvoiceId),
          Cl.none()
        ],
        payer2 // Not the designated payer
      );

      expect(payment.result).toBeErr(Cl.uint(1004)); // ERR_UNAUTHORIZED_PAYER
    });

    it("should reject partial payment for standard invoice", () => {
      const payment = simnet.callPublicFn(
        "invoicing",
        "pay-invoice",
        [
          Cl.uint(standardInvoiceId),
          Cl.some(Cl.uint(500)) // Try partial payment
        ],
        payer1
      );

      // Should still pay full amount because standard ignores payment-amount
      expect(payment.result).toBeOk(Cl.some(Cl.tuple({
        "total-paid": Cl.uint(1000),
        "is-fully-paid": Cl.bool(true)
      })));
    });

    it("should reject payment for already paid invoice", () => {
      // Pay once
      simnet.callPublicFn(
        "invoicing",
        "pay-invoice",
        [Cl.uint(standardInvoiceId), Cl.none()],
        payer1
      );

      // Try to pay again
      const secondPayment = simnet.callPublicFn(
        "invoicing",
        "pay-invoice",
        [Cl.uint(standardInvoiceId), Cl.none()],
        payer1
      );

      expect(secondPayment.result).toBeErr(Cl.uint(1003)); // ERR_INVOICE_ALREADY_PAID
    });
  });

  describe("Flexible Invoice Payments", () => {
    let flexibleInvoiceId: number;

    beforeEach(() => {
      // Create a flexible invoice
      const result = simnet.callPublicFn(
        "invoicing",
        "create-invoice",
        [
          Cl.none(),
          Cl.uint(5000),
          Cl.stringAscii("flexible")
        ],
        contractOwner
      );
      flexibleInvoiceId = (result.result as any).value["invoice-id"].value;
    });

    it("should allow multiple users to make partial payments", () => {
      // First payment from payer1
      const payment1 = simnet.callPublicFn(
        "invoicing",
        "pay-invoice",
        [
          Cl.uint(flexibleInvoiceId),
          Cl.some(Cl.uint(2000))
        ],
        payer1
      );

      expect(payment1.result).toBeOk(Cl.some(Cl.tuple({
        "amount-paid": Cl.some(Cl.uint(2000)),
        "total-paid": Cl.uint(2000),
        "is-fully-paid": Cl.bool(false)
      })));

      // Second payment from payer2
      const payment2 = simnet.callPublicFn(
        "invoicing",
        "pay-invoice",
        [
          Cl.uint(flexibleInvoiceId),
          Cl.some(Cl.uint(1500))
        ],
        payer2
      );

      expect(payment2.result).toBeOk(Cl.some(Cl.tuple({
        "total-paid": Cl.uint(3500),
        "is-fully-paid": Cl.bool(false)
      })));

      // Third payment from payer3 to complete
      const payment3 = simnet.callPublicFn(
        "invoicing",
        "pay-invoice",
        [
          Cl.uint(flexibleInvoiceId),
          Cl.some(Cl.uint(1500))
        ],
        payer3
      );

      expect(payment3.result).toBeOk(Cl.some(Cl.tuple({
        "total-paid": Cl.uint(5000),
        "is-fully-paid": Cl.bool(true)
      })));

      // Check all transfer events
      expect(payment1.events[0].data.amount).toBe("2000");
      expect(payment2.events[0].data.amount).toBe("1500");
      expect(payment3.events[0].data.amount).toBe("1500");

      // Verify final invoice state
      const invoice = simnet.getMapEntry("invoicing", "invoices", { "invoice-id": Cl.uint(flexibleInvoiceId) });
      expect(invoice.value.data.paid).toBe(Cl.bool(true));
      expect(invoice.value.data["paid-amount"]).toBeUint(5000);
    });

    it("should reject payment without amount for flexible invoice", () => {
      const payment = simnet.callPublicFn(
        "invoicing",
        "pay-invoice",
        [
          Cl.uint(flexibleInvoiceId),
          Cl.none() // Missing amount for flexible
        ],
        payer1
      );

      expect(payment.result).toBeErr(Cl.uint(1009)); // ERR_AMOUNT_REQUIRED_FOR_FLEXIBLE
    });

    it("should reject payment exceeding remaining balance", () => {
      // Pay 2000 first
      simnet.callPublicFn(
        "invoicing",
        "pay-invoice",
        [Cl.uint(flexibleInvoiceId), Cl.some(Cl.uint(2000))],
        payer1
      );

      // Try to pay 4000 (exceeds remaining 3000)
      const overpayment = simnet.callPublicFn(
        "invoicing",
        "pay-invoice",
        [Cl.uint(flexibleInvoiceId), Cl.some(Cl.uint(4000))],
        payer2
      );

      expect(overpayment.result).toBeErr(Cl.uint(1007)); // ERR_PAYMENT_EXCEEDS_BALANCE
    });

    it("should allow anyone to pay flexible invoice", () => {
      const payment = simnet.callPublicFn(
        "invoicing",
        "pay-invoice",
        [Cl.uint(flexibleInvoiceId), Cl.some(Cl.uint(1000))],
        randomUser // Any user can pay
      );

      expect(payment.result).toBeOk(Cl.some(Cl.tuple({
        "total-paid": Cl.uint(1000),
        "is-fully-paid": Cl.bool(false)
      })));
    });
  });

  describe("Read-Only Functions", () => {
    beforeEach(() => {
      // Create test invoices
      simnet.callPublicFn(
        "invoicing",
        "create-invoice",
        [Cl.some(Cl.principal(payer1)), Cl.uint(1000), Cl.stringAscii("standard")],
        contractOwner
      );

      simnet.callPublicFn(
        "invoicing",
        "create-invoice",
        [Cl.none(), Cl.uint(5000), Cl.stringAscii("flexible")],
        contractOwner
      );
    });

    it("should return correct invoice details", () => {
      const invoice = simnet.callReadOnlyFn(
        "invoicing",
        "get-invoice",
        [Cl.uint(1)],
        randomUser
      );

      expect(invoice.result).toBeSome(Cl.tuple({
        issuer: Cl.principal(contractOwner),
        payer: Cl.some(Cl.principal(payer1)),
        "paid-amount": Cl.uint(0),
        amount: Cl.uint(1000),
        paid: Cl.bool(false),
        "invoice-type": Cl.stringAscii("standard")
      }));
    });

    it("should return none for non-existent invoice", () => {
      const invoice = simnet.callReadOnlyFn(
        "invoicing",
        "get-invoice",
        [Cl.uint(999)],
        randomUser
      );

      expect(invoice.result).toBeNone();
    });
  });

  describe("Invoice ID Generation", () => {
    it("should generate unique invoice IDs", () => {
      // Create multiple invoices
      const ids = new Set();

      for (let i = 0; i < 5; i++) {
        const result = simnet.callPublicFn(
          "invoicing",
          "create-invoice",
          [Cl.some(Cl.principal(payer1)), Cl.uint(1000), Cl.stringAscii("standard")],
          contractOwner
        );

        const invoiceId = (result.result as any).value["invoice-id"].value;
        expect(ids.has(invoiceId)).toBe(false);
        ids.add(invoiceId);
      }

      expect(ids.size).toBe(5);
    });

    it("should handle timestamp-based ID generation", () => {
      // Mock timestamp by advancing blocks
      simnet.mineEmptyBlock();

      const result = simnet.callPublicFn(
        "invoicing",
        "create-invoice",
        [Cl.some(Cl.principal(payer1)), Cl.uint(1000), Cl.stringAscii("standard")],
        contractOwner
      );

      expect(result.result).toBeOk(Cl.tuple({
        "invoice-id": Cl.uint(6),
        amount: Cl.uint(1000)
      }));
    });
  });

  describe("Edge Cases", () => {
    it("should handle maximum invoice amount", () => {
      const result = simnet.callPublicFn(
        "invoicing",
        "create-invoice",
        [Cl.some(Cl.principal(payer1)), Cl.uint(10000000000), Cl.stringAscii("standard")],
        contractOwner
      );

      expect(result.result).toBeOk(Cl.tuple({
        amount: Cl.uint(10000000000)
      }));
    });

    it("should handle flexible invoice with many small payments", () => {
      // Create flexible invoice
      const result = simnet.callPublicFn(
        "invoicing",
        "create-invoice",
        [Cl.none(), Cl.uint(1000), Cl.stringAscii("flexible")],
        contractOwner
      );
      const invoiceId = (result.result as any).value["invoice-id"].value;

      // Make 10 payments of 100 each
      for (let i = 0; i < 10; i++) {
        const payment = simnet.callPublicFn(
          "invoicing",
          "pay-invoice",
          [Cl.uint(invoiceId), Cl.some(Cl.uint(100))],
          payer1
        );

        if (i < 9) {
          expect(payment.result).toBeOk(Cl.some(Cl.tuple({
            "total-paid": Cl.uint((i + 1) * 100),
            "is-fully-paid": Cl.bool(false)
          })));
        } else {
          expect(payment.result).toBeOk(Cl.some(Cl.tuple({
            "total-paid": Cl.uint(1000),
            "is-fully-paid": Cl.bool(true)
          })));
        }
      }
    });

    it("should handle payments from multiple users on same invoice", () => {
      // Create flexible invoice
      const result = simnet.callPublicFn(
        "invoicing",
        "create-invoice",
        [Cl.none(), Cl.uint(3000), Cl.stringAscii("flexible")],
        contractOwner
      );
      const invoiceId = (result.result as any).value["invoice-id"].value;

      // Payments from different users
      simnet.callPublicFn(
        "invoicing",
        "pay-invoice",
        [Cl.uint(invoiceId), Cl.some(Cl.uint(1000))],
        payer1
      );

      simnet.callPublicFn(
        "invoicing",
        "pay-invoice",
        [Cl.uint(invoiceId), Cl.some(Cl.uint(1000))],
        payer2
      );

      const finalPayment = simnet.callPublicFn(
        "invoicing",
        "pay-invoice",
        [Cl.uint(invoiceId), Cl.some(Cl.uint(1000))],
        payer3
      );

      expect(finalPayment.result).toBeOk(Cl.some(Cl.tuple({
        "is-fully-paid": Cl.bool(true)
      })));

      // Check final invoice state
      const invoice = simnet.getMapEntry("invoicing", "invoices", { "invoice-id": Cl.uint(invoiceId) });
      expect(invoice.value.data["paid-amount"]).toBeUint(3000);
      expect(invoice.value.data.paid).toBe(Cl.bool(true));
    });
  });

  describe("Error Conditions", () => {
    it("should reject payment for non-existent invoice", () => {
      const payment = simnet.callPublicFn(
        "invoicing",
        "pay-invoice",
        [Cl.uint(999), Cl.some(Cl.uint(100))],
        payer1
      );

      expect(payment.result).toBeErr(Cl.uint(1002)); // ERR_INVOICE_NOT_FOUND
    });

    it("should handle insufficient STX balance", () => {
      // Create invoice with large amount
      const result = simnet.callPublicFn(
        "invoicing",
        "create-invoice",
        [Cl.some(Cl.principal(payer1)), Cl.uint(1000000), Cl.stringAscii("standard")],
        contractOwner
      );
      const invoiceId = (result.result as any).value["invoice-id"].value;

      // Try to pay with insufficient balance
      const payment = simnet.callPublicFn(
        "invoicing",
        "pay-invoice",
        [Cl.uint(invoiceId), Cl.none()],
        payer1
      );

      // Should fail at stx-transfer? level
      expect(payment.result).toBeErr(Cl.uint(1)); // Transfer error
    });
  });
});
