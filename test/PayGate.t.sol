// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {PqAuth} from "haven-pq-kit/PqAuth.sol";
import {VendorSig} from "haven-pq-kit/VendorSig.sol";
import {PqcMockConfig} from "haven-pq-kit-test/mocks/MockQorePQC.sol";
import {PayGate} from "../src/PayGate.sol";
import {PayGateBase} from "./PayGateBase.sol";
import {LyingERC20} from "./mocks/MockERC20.sol";

/// @notice One test per refusal. Every signature is built before `expectRevert`, so the revert is the gate's.
contract PayGateTest is PayGateBase {
    bytes32 internal constant INV1 = keccak256("INV-0001");
    bytes32 internal constant INV2 = keccak256("INV-0002");

    // ================================================================ the paths that pay

    function test_pay_paysAVendorSignedInvoice() public {
        VendorSig.Invoice memory invoice = _invoice(INV1, 400e6);
        bytes memory sig = _signInvoice(vendor, invoice);
        vm.expectEmit(address(gate));
        emit PayGate.InvoicePaid(vendor, INV1, payout, 400e6, false);
        vm.prank(agent);
        gate.pay(invoice, sig);

        assertEq(fusd.balanceOf(payout), 400e6);
        assertEq(fusd.balanceOf(address(gate)), FUNDING - 400e6);
        assertEq(gate.spentToday(), 400e6);
        assertEq(uint8(gate.invoiceState(gate.invoiceKey(vendor, INV1))), uint8(PayGate.InvoiceState.Paid));
    }

    function test_pay_exactlyAtBothCaps() public {
        _timelocked(PayGate.Op.SetDailyCap, abi.encode(VENDOR_CAP));
        _pay(_invoice(INV1, VENDOR_CAP));
        assertEq(fusd.balanceOf(payout), VENDOR_CAP);
    }

    function test_queue_thenOwnerApproves() public {
        VendorSig.Invoice memory invoice = _invoice(INV1, 5_000e6); // over both caps
        _queue(invoice);
        assertEq(fusd.balanceOf(payout), 0);
        assertEq(uint8(gate.invoiceState(gate.invoiceKey(vendor, INV1))), uint8(PayGate.InvoiceState.Queued));

        _approve(vendor, INV1);
        assertEq(fusd.balanceOf(payout), 5_000e6);
        assertEq(gate.spentToday(), 0, "owner approvals do not use the agent's daily budget");
        assertEq(uint8(gate.invoiceState(gate.invoiceKey(vendor, INV1))), uint8(PayGate.InvoiceState.Paid));
    }

    function test_approveQueued_worksWhilePaused() public {
        _queue(_invoice(INV1, 5_000e6));
        _pause();
        _approve(vendor, INV1);
        assertEq(fusd.balanceOf(payout), 5_000e6);
    }

    function test_dailyCap_resetsTheNextDay() public {
        _pay(_invoice(INV1, 1_000e6));
        _pay(_invoice(keccak256("a"), 1_000e6));
        _pay(_invoice(keccak256("b"), 500e6));
        VendorSig.Invoice memory more = _invoice(keccak256("c"), 1);
        bytes memory sig = _signInvoice(vendor, more);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(PayGate.OverDailyCap.selector, DAILY_CAP, 1, DAILY_CAP));
        gate.pay(more, sig);

        vm.warp(block.timestamp + 1 days);
        _pay(_invoice(keccak256("c"), 1));
        assertEq(gate.spentToday(), 1);
    }

    // ================================================================ refusals on pay

    function test_pay_refusesAnUnknownVendor() public {
        VendorSig.Invoice memory invoice = _invoice(INV1, 1e6);
        invoice.vendor = attacker;
        invoice.payee = attacker;
        bytes memory sig = _signInvoice(attacker, invoice); // a real ML-DSA key, just not an approved vendor
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(PayGate.UnknownVendor.selector, attacker));
        gate.pay(invoice, sig);
    }

    /// @dev The prompt-injection case: "pay 0xAttacker". The vendor did sign, but not for that payee.
    function test_pay_refusesAPayeeThatIsNotTheVendorsPayout() public {
        VendorSig.Invoice memory invoice = _invoice(INV1, 1e6);
        invoice.payee = attacker;
        bytes memory sig = _signInvoice(vendor, invoice);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(PayGate.WrongPayee.selector, attacker, payout));
        gate.pay(invoice, sig);
    }

    function test_pay_refusesAnInvoiceSignedByAnotherKey() public {
        VendorSig.Invoice memory invoice = _invoice(INV1, 1e6);
        bytes memory sig = _signInvoice(attacker, invoice);
        vm.prank(agent);
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        gate.pay(invoice, sig);
    }

    function test_pay_refusesATamperedAmount() public {
        VendorSig.Invoice memory invoice = _invoice(INV1, 1e6);
        bytes memory sig = _signInvoice(vendor, invoice);
        invoice.amount = 900e6;
        vm.prank(agent);
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        gate.pay(invoice, sig);
    }

    function test_pay_refusesATamperedMemoOrDueDate() public {
        VendorSig.Invoice memory invoice = _invoice(INV1, 1e6);
        bytes memory sig = _signInvoice(vendor, invoice);
        invoice.memoHash = keccak256("something else");
        vm.prank(agent);
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        gate.pay(invoice, sig);

        invoice = _invoice(INV1, 1e6);
        invoice.dueDate += 1;
        vm.prank(agent);
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        gate.pay(invoice, sig);
    }

    /// @dev A secp256k1 signature is 65 bytes. It never reaches pqcVerify.
    function test_pay_refusesAClassicalOnlySignature() public {
        VendorSig.Invoice memory invoice = _invoice(INV1, 1e6);
        bytes memory ecdsa = new bytes(65);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(PqAuth.BadSignatureLength.selector, 65));
        gate.pay(invoice, ecdsa);
    }

    /// @dev The vendor's key is read live. If the chain no longer holds an ML-DSA key for it, nothing pays.
    function test_pay_refusesAVendorWhoseKeyIsGone() public {
        VendorSig.Invoice memory invoice = _invoice(INV1, 1e6);
        bytes memory sig = _signInvoice(vendor, invoice);
        config.clearKey(vendor);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(PqAuth.KeyNotRegistered.selector, vendor));
        gate.pay(invoice, sig);
    }

    function test_pay_refusesAfterTheVendorKeyRotates() public {
        VendorSig.Invoice memory invoice = _invoice(INV1, 1e6);
        bytes memory sig = _signInvoice(vendor, invoice);
        bytes memory newKey = _pubkey(vendor);
        newKey[100] = 0x42;
        config.setKey(vendor, PqAuth.ML_DSA_87, newKey, true, keccak256("rotated secret"));
        vm.prank(agent);
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        gate.pay(invoice, sig);
    }

    function test_pay_refusesAReplay() public {
        VendorSig.Invoice memory invoice = _invoice(INV1, 1e6);
        bytes memory sig = _signInvoice(vendor, invoice);
        vm.prank(agent);
        gate.pay(invoice, sig);
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(PayGate.InvoiceUsed.selector, vendor, INV1, PayGate.InvoiceState.Paid)
        );
        gate.pay(invoice, sig);
    }

    function test_pay_refusesTheSameIdWithAnotherAmount() public {
        _pay(_invoice(INV1, 1e6));
        VendorSig.Invoice memory again = _invoice(INV1, 2e6);
        bytes memory sig = _signInvoice(vendor, again);
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(PayGate.InvoiceUsed.selector, vendor, INV1, PayGate.InvoiceState.Paid)
        );
        gate.pay(again, sig);
    }

    function test_pay_refusesAQueuedInvoice() public {
        VendorSig.Invoice memory invoice = _invoice(INV1, 1e6);
        bytes memory sig = _signInvoice(vendor, invoice);
        vm.prank(agent);
        gate.queue(invoice, sig);
        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(PayGate.InvoiceUsed.selector, vendor, INV1, PayGate.InvoiceState.Queued)
        );
        gate.pay(invoice, sig);
    }

    function test_pay_refusesOverThePerInvoiceCap() public {
        VendorSig.Invoice memory invoice = _invoice(INV1, VENDOR_CAP + 1);
        bytes memory sig = _signInvoice(vendor, invoice);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(PayGate.OverInvoiceCap.selector, VENDOR_CAP + 1, VENDOR_CAP));
        gate.pay(invoice, sig);
    }

    function test_pay_refusesOverTheDailyCap() public {
        _pay(_invoice(INV1, 1_000e6));
        _pay(_invoice(INV2, 1_000e6));
        VendorSig.Invoice memory invoice = _invoice(keccak256("INV-0003"), 501e6);
        bytes memory sig = _signInvoice(vendor, invoice);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(PayGate.OverDailyCap.selector, 2_000e6, 501e6, DAILY_CAP));
        gate.pay(invoice, sig);
    }

    function test_pay_refusesAnyCallerButTheAgent() public {
        VendorSig.Invoice memory invoice = _invoice(INV1, 1e6);
        bytes memory sig = _signInvoice(vendor, invoice);
        address[3] memory callers = [attacker, owner, vendor];
        for (uint256 i = 0; i < callers.length; i++) {
            vm.prank(callers[i]);
            vm.expectRevert(abi.encodeWithSelector(PayGate.NotAgent.selector, callers[i]));
            gate.pay(invoice, sig);
        }
    }

    function test_pay_refusesAnExpiredAgent() public {
        VendorSig.Invoice memory invoice = _invoice(INV1, 1e6);
        bytes memory sig = _signInvoice(vendor, invoice);
        uint256 until = gate.agentUntil();
        vm.warp(until + 1);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(PayGate.AgentExpired.selector, until));
        gate.pay(invoice, sig);
    }

    function test_pay_refusesAForeignChain() public {
        VendorSig.Invoice memory invoice = _invoice(INV1, 1e6);
        bytes memory sig = _signInvoice(vendor, invoice);
        vm.chainId(9801);
        vm.prank(agent);
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        gate.pay(invoice, sig);
    }

    function test_pay_refusesAnInvoiceSignedForAnotherGate() public {
        PayGate other = new PayGate(owner, address(fusd), DELAY, agent, block.timestamp + 1 days, DAILY_CAP);
        VendorSig.Invoice memory invoice = _invoice(INV1, 1e6);
        bytes memory sig = _sign(vendor, other.invoiceMessage(invoice));
        vm.prank(agent);
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        gate.pay(invoice, sig);
    }

    function test_pay_refusesAnotherToken() public {
        VendorSig.Invoice memory invoice = _invoice(INV1, 1e6);
        invoice.token = address(0x70CE);
        bytes memory sig = _signInvoice(vendor, invoice);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(PayGate.WrongToken.selector, address(0x70CE)));
        gate.pay(invoice, sig);
    }

    function test_pay_refusesZero() public {
        VendorSig.Invoice memory invoice = _invoice(INV1, 0);
        bytes memory sig = _signInvoice(vendor, invoice);
        vm.prank(agent);
        vm.expectRevert(PayGate.ZeroAmount.selector);
        gate.pay(invoice, sig);
    }

    function test_pay_refusesWhilePaused() public {
        _pause();
        VendorSig.Invoice memory invoice = _invoice(INV1, 1e6);
        bytes memory sig = _signInvoice(vendor, invoice);
        vm.prank(agent);
        vm.expectRevert(PayGate.IsPaused.selector);
        gate.pay(invoice, sig);
        vm.prank(agent);
        vm.expectRevert(PayGate.IsPaused.selector);
        gate.queue(invoice, sig);
    }

    // ================================================================ a precompile that is off or lies

    function test_pay_failsClosedWhenStatusIsInactive() public {
        VendorSig.Invoice memory invoice = _invoice(INV1, 1e6);
        bytes memory sig = _signInvoice(vendor, invoice);
        config.setStatusMode(PqcMockConfig.StatusMode.Inactive);
        vm.prank(agent);
        vm.expectRevert(PqAuth.PqPrecompileUnavailable.selector);
        gate.pay(invoice, sig);
    }

    function test_pay_failsClosedWhenStatusReverts() public {
        VendorSig.Invoice memory invoice = _invoice(INV1, 1e6);
        bytes memory sig = _signInvoice(vendor, invoice);
        config.setStatusMode(PqcMockConfig.StatusMode.Revert);
        vm.prank(agent);
        vm.expectRevert(PqAuth.PqPrecompileUnavailable.selector);
        gate.pay(invoice, sig);
    }

    function test_pay_failsClosedWhenVerifyIsInactive() public {
        VendorSig.Invoice memory invoice = _invoice(INV1, 1e6);
        bytes memory sig = _signInvoice(vendor, invoice);
        config.setVerifyMode(PqcMockConfig.VerifyMode.Inactive);
        vm.prank(agent);
        vm.expectRevert(PqAuth.PqPrecompileUnavailable.selector);
        gate.pay(invoice, sig);
    }

    function test_pay_failsClosedWhenVerifyReverts() public {
        VendorSig.Invoice memory invoice = _invoice(INV1, 1e6);
        bytes memory sig = _signInvoice(vendor, invoice);
        config.setVerifyMode(PqcMockConfig.VerifyMode.Revert);
        vm.prank(agent);
        vm.expectRevert(PqAuth.PqPrecompileUnavailable.selector);
        gate.pay(invoice, sig);
    }

    function test_pay_refusesWhenVerifySaysNo() public {
        VendorSig.Invoice memory invoice = _invoice(INV1, 1e6);
        bytes memory sig = _signInvoice(vendor, invoice);
        config.setVerifyMode(PqcMockConfig.VerifyMode.AlwaysInvalid);
        vm.prank(agent);
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        gate.pay(invoice, sig);
    }

    /// @dev Even a precompile that says yes to everything cannot move money to a payee the owner did not set.
    function test_lyingVerify_stillCannotRedirect() public {
        config.setVerifyMode(PqcMockConfig.VerifyMode.AlwaysValid);
        VendorSig.Invoice memory invoice = _invoice(INV1, 1e6);
        invoice.payee = attacker;
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(PayGate.WrongPayee.selector, attacker, payout));
        gate.pay(invoice, new bytes(PqAuth.SIG_LEN));
    }

    // ================================================================ the queue

    function test_approveQueued_refusesAnotherSigner() public {
        _queue(_invoice(INV1, 5_000e6));
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 args = gate.approveArgsHash(vendor, INV1, payout, 5_000e6);
        bytes memory sig = _sign(attacker, gate.ownerMessage(gate.ACTION_APPROVE(), args, deadline));
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        gate.approveQueued(vendor, INV1, deadline, sig);
    }

    function test_approveQueued_refusesASignatureForAnotherAction() public {
        _queue(_invoice(INV1, 5_000e6));
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 args = gate.approveArgsHash(vendor, INV1, payout, 5_000e6);
        bytes memory sig = _ownerSig(gate.ACTION_PAUSE(), args, deadline);
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        gate.approveQueued(vendor, INV1, deadline, sig);
    }

    function test_approveQueued_refusesAnExpiredSignature() public {
        _queue(_invoice(INV1, 5_000e6));
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 args = gate.approveArgsHash(vendor, INV1, payout, 5_000e6);
        bytes memory sig = _ownerSig(gate.ACTION_APPROVE(), args, deadline);
        vm.warp(deadline + 1);
        vm.expectRevert(abi.encodeWithSelector(PqAuth.Expired.selector, deadline));
        gate.approveQueued(vendor, INV1, deadline, sig);
    }

    function test_approveQueued_refusesTwice() public {
        _queue(_invoice(INV1, 5_000e6));
        _approve(vendor, INV1);
        vm.expectRevert(abi.encodeWithSelector(PayGate.NotQueued.selector, vendor, INV1));
        gate.approveQueued(vendor, INV1, block.timestamp + 1 hours, new bytes(PqAuth.SIG_LEN));
    }

    function test_approveQueued_refusesAfterThePayoutChanges() public {
        _queue(_invoice(INV1, 5_000e6));
        _timelocked(PayGate.Op.SetPayout, abi.encode(vendor, address(0xB0B2)));
        vm.expectRevert(abi.encodeWithSelector(PayGate.QueuedVoided.selector, vendor, INV1));
        gate.approveQueued(vendor, INV1, block.timestamp + 1 hours, new bytes(PqAuth.SIG_LEN));
    }

    function test_approveQueued_refusesAfterRevokeAndReAdd() public {
        _queue(_invoice(INV1, 5_000e6));
        _timelocked(PayGate.Op.Revoke, abi.encode(vendor));
        _timelocked(PayGate.Op.AddVendor, abi.encode(vendor, payout, VENDOR_CAP));
        vm.expectRevert(abi.encodeWithSelector(PayGate.QueuedVoided.selector, vendor, INV1));
        gate.approveQueued(vendor, INV1, block.timestamp + 1 hours, new bytes(PqAuth.SIG_LEN));
    }

    function test_queue_refusesAWrongPayee() public {
        VendorSig.Invoice memory invoice = _invoice(INV1, 5_000e6);
        invoice.payee = attacker;
        bytes memory sig = _signInvoice(vendor, invoice);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(PayGate.WrongPayee.selector, attacker, payout));
        gate.queue(invoice, sig);
    }

    function test_queue_refusesAnyCallerButTheAgent() public {
        VendorSig.Invoice memory invoice = _invoice(INV1, 5_000e6);
        bytes memory sig = _signInvoice(vendor, invoice);
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(PayGate.NotAgent.selector, attacker));
        gate.queue(invoice, sig);
    }

    // ================================================================ the timelock

    function test_propose_refusesAnotherSigner() public {
        bytes memory params = abi.encode(attacker, attacker, type(uint256).max);
        bytes32 opHash = keccak256(abi.encode(uint8(PayGate.Op.AddVendor), params));
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(attacker, gate.ownerMessage(gate.ACTION_PROPOSE(), opHash, deadline));
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        gate.propose(PayGate.Op.AddVendor, params, deadline, sig);
    }

    function test_propose_refusesASignatureForOtherParams() public {
        bytes memory params = abi.encode(vendor, address(0xB0B2));
        bytes32 signedFor = keccak256(abi.encode(uint8(PayGate.Op.SetPayout), params));
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _ownerSig(gate.ACTION_PROPOSE(), signedFor, deadline);
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        gate.propose(PayGate.Op.SetPayout, abi.encode(vendor, attacker), deadline, sig);
    }

    function test_execute_refusesBeforeTheDelay() public {
        bytes memory params = abi.encode(vendor, address(0xB0B2));
        _propose(PayGate.Op.SetPayout, params);
        vm.warp(block.timestamp + DELAY - 1);
        vm.expectRevert(abi.encodeWithSelector(PayGate.TooEarly.selector, block.timestamp + 1));
        gate.execute(PayGate.Op.SetPayout, params);
    }

    function test_execute_refusesAfterTheGrace() public {
        bytes memory params = abi.encode(vendor, address(0xB0B2));
        _propose(PayGate.Op.SetPayout, params);
        uint256 eta = block.timestamp + DELAY;
        vm.warp(eta + gate.EXECUTION_GRACE() + 1);
        vm.expectRevert(abi.encodeWithSelector(PayGate.OpStale.selector, eta));
        gate.execute(PayGate.Op.SetPayout, params);
    }

    function test_execute_refusesAnUnproposedOp() public {
        bytes memory params = abi.encode(vendor, attacker);
        bytes32 opHash = keccak256(abi.encode(uint8(PayGate.Op.SetPayout), params));
        vm.expectRevert(abi.encodeWithSelector(PayGate.NotPendingOp.selector, opHash));
        gate.execute(PayGate.Op.SetPayout, params);
    }

    function test_execute_refusesTwice() public {
        bytes memory params = abi.encode(uint256(1e6));
        _timelocked(PayGate.Op.SetDailyCap, params);
        bytes32 opHash = keccak256(abi.encode(uint8(PayGate.Op.SetDailyCap), params));
        vm.expectRevert(abi.encodeWithSelector(PayGate.NotPendingOp.selector, opHash));
        gate.execute(PayGate.Op.SetDailyCap, params);
    }

    function test_propose_refusesADuplicate() public {
        bytes memory params = abi.encode(uint256(1e6));
        bytes32 opHash = _propose(PayGate.Op.SetDailyCap, params);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _ownerSig(gate.ACTION_PROPOSE(), opHash, deadline);
        vm.expectRevert(abi.encodeWithSelector(PayGate.AlreadyPending.selector, opHash));
        gate.propose(PayGate.Op.SetDailyCap, params, deadline, sig);
    }

    function test_cancel_stopsAProposal() public {
        bytes memory params = abi.encode(vendor, attacker);
        bytes32 opHash = _propose(PayGate.Op.SetPayout, params);
        uint256 deadline = block.timestamp + 1 hours;
        gate.cancel(opHash, deadline, _ownerSig(gate.ACTION_CANCEL(), opHash, deadline));
        vm.warp(block.timestamp + DELAY);
        vm.expectRevert(abi.encodeWithSelector(PayGate.NotPendingOp.selector, opHash));
        gate.execute(PayGate.Op.SetPayout, params);
    }

    function test_addVendor_refusesAVendorWithoutAnMlDsaKey() public {
        address classical = address(0xC1A55);
        bytes memory params = abi.encode(classical, classical, VENDOR_CAP);
        bytes32 opHash = keccak256(abi.encode(uint8(PayGate.Op.AddVendor), params));
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _ownerSig(gate.ACTION_PROPOSE(), opHash, deadline);
        vm.expectRevert(abi.encodeWithSelector(PqAuth.KeyNotRegistered.selector, classical));
        gate.propose(PayGate.Op.AddVendor, params, deadline, sig);
    }

    function test_addVendor_rechecksTheKeyAtExecute() public {
        address v2 = address(0xE11B);
        _register(v2);
        bytes memory params = abi.encode(v2, address(0xB0B3), VENDOR_CAP);
        _propose(PayGate.Op.AddVendor, params);
        config.clearKey(v2);
        vm.warp(block.timestamp + DELAY);
        vm.expectRevert(abi.encodeWithSelector(PqAuth.KeyNotRegistered.selector, v2));
        gate.execute(PayGate.Op.AddVendor, params);
    }

    function test_setPayout_refusesBadPayouts() public {
        address[3] memory bad = [address(0), address(gate), address(fusd)];
        for (uint256 i = 0; i < bad.length; i++) {
            bytes memory params = abi.encode(vendor, bad[i]);
            bytes32 opHash = keccak256(abi.encode(uint8(PayGate.Op.SetPayout), params));
            uint256 deadline = block.timestamp + 1 hours;
            bytes memory sig = _ownerSig(gate.ACTION_PROPOSE(), opHash, deadline);
            vm.expectRevert(abi.encodeWithSelector(PayGate.BadPayout.selector, bad[i]));
            gate.propose(PayGate.Op.SetPayout, params, deadline, sig);
        }
    }

    function test_setPayout_redirectsOnlyAfterTheDelay() public {
        address newPayout = address(0xB0B2);
        _propose(PayGate.Op.SetPayout, abi.encode(vendor, newPayout));
        // During the delay the old payout still applies: an invoice to the new one is refused.
        VendorSig.Invoice memory early = _invoice(INV1, 1e6);
        early.payee = newPayout;
        bytes memory sig = _signInvoice(vendor, early);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(PayGate.WrongPayee.selector, newPayout, payout));
        gate.pay(early, sig);

        vm.warp(block.timestamp + DELAY);
        gate.execute(PayGate.Op.SetPayout, abi.encode(vendor, newPayout));
        VendorSig.Invoice memory late = _invoice(INV2, 1e6);
        late.payee = newPayout;
        _pay(late);
        assertEq(fusd.balanceOf(newPayout), 1e6);
    }

    function test_revoke_stopsPayments() public {
        _timelocked(PayGate.Op.Revoke, abi.encode(vendor));
        VendorSig.Invoice memory invoice = _invoice(INV1, 1e6);
        bytes memory sig = _signInvoice(vendor, invoice);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(PayGate.UnknownVendor.selector, vendor));
        gate.pay(invoice, sig);
    }

    function test_setAgent_movesTheAgent() public {
        address agent2 = address(0xA6E8);
        _timelocked(PayGate.Op.SetAgent, abi.encode(agent2, block.timestamp + 1 days));
        VendorSig.Invoice memory invoice = _invoice(INV1, 1e6);
        bytes memory sig = _signInvoice(vendor, invoice);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(PayGate.NotAgent.selector, agent));
        gate.pay(invoice, sig);
        vm.prank(agent2);
        gate.pay(invoice, sig);
    }

    function test_withdraw_goesOnlyToTheOwner() public {
        _timelocked(PayGate.Op.Withdraw, abi.encode(uint256(10_000e6)));
        assertEq(fusd.balanceOf(owner), 10_000e6);
        assertEq(fusd.balanceOf(address(gate)), FUNDING - 10_000e6);
    }

    function test_propose_refusesAnOutOfRangeOp() public {
        bytes memory data = abi.encodeWithSelector(
            PayGate.propose.selector, uint8(7), abi.encode(uint256(1)), block.timestamp + 1 hours, new bytes(0)
        );
        (bool ok,) = address(gate).call(data);
        assertFalse(ok);
    }

    // ================================================================ pause

    function test_pause_refusesAnotherSigner() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(attacker, gate.ownerMessage(gate.ACTION_PAUSE(), bytes32(0), deadline));
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        gate.pause(deadline, sig);
    }

    function test_unpause_restoresPayments() public {
        _pause();
        uint256 deadline = block.timestamp + 1 hours;
        gate.unpause(deadline, _ownerSig(gate.ACTION_UNPAUSE(), bytes32(0), deadline));
        _pay(_invoice(INV1, 1e6));
        assertEq(fusd.balanceOf(payout), 1e6);
    }

    function test_ownerSignatures_cannotBeReplayed() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory pauseSig = _ownerSig(gate.ACTION_PAUSE(), bytes32(0), deadline);
        gate.pause(deadline, pauseSig);
        gate.unpause(deadline, _ownerSig(gate.ACTION_UNPAUSE(), bytes32(0), deadline));
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        gate.pause(deadline, pauseSig);
    }

    // ================================================================ token and constructor

    function test_transfer_failsClosedOnALyingToken() public {
        LyingERC20 liar = new LyingERC20();
        PayGate g = new PayGate(owner, address(liar), DELAY, agent, block.timestamp + 30 days, DAILY_CAP);
        liar.mint(address(g), FUNDING);
        gate = g;
        fusd = liar;
        _timelocked(PayGate.Op.AddVendor, abi.encode(vendor, payout, VENDOR_CAP));
        VendorSig.Invoice memory invoice = _invoice(INV1, 1e6);
        bytes memory sig = _signInvoice(vendor, invoice);
        vm.prank(agent);
        vm.expectRevert(PayGate.TransferFailed.selector);
        g.pay(invoice, sig);
    }

    function test_transfer_refusesWithoutFunds() public {
        _timelocked(PayGate.Op.Withdraw, abi.encode(FUNDING));
        VendorSig.Invoice memory invoice = _invoice(INV1, 1e6);
        bytes memory sig = _signInvoice(vendor, invoice);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(PayGate.InsufficientFunds.selector, 0, 1e6));
        gate.pay(invoice, sig);
    }

    function test_constructor_refusesAnOwnerWithoutAnMlDsaKey() public {
        vm.expectRevert(abi.encodeWithSelector(PqAuth.KeyNotRegistered.selector, address(0xC1A55)));
        new PayGate(address(0xC1A55), address(fusd), DELAY, agent, block.timestamp + 1 days, DAILY_CAP);
    }

    function test_constructor_refusesABadDelay() public {
        vm.expectRevert(abi.encodeWithSelector(PayGate.BadDelay.selector, 59));
        new PayGate(owner, address(fusd), 59, agent, block.timestamp + 1 days, DAILY_CAP);
    }

    // ================================================================ fuzz

    function testFuzz_pay_withinCapsPaysExactly(uint256 amount) public {
        amount = bound(amount, 1, VENDOR_CAP);
        _pay(_invoice(INV1, amount));
        assertEq(fusd.balanceOf(payout), amount);
        assertEq(fusd.balanceOf(address(gate)), FUNDING - amount);
    }

    function testFuzz_pay_overTheCapAlwaysRefused(uint256 amount) public {
        amount = bound(amount, VENDOR_CAP + 1, type(uint128).max);
        VendorSig.Invoice memory invoice = _invoice(INV1, amount);
        bytes memory sig = _signInvoice(vendor, invoice);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(PayGate.OverInvoiceCap.selector, amount, VENDOR_CAP));
        gate.pay(invoice, sig);
    }

    /// @dev Random amounts across random days. No day ever spends more than the cap.
    function testFuzz_dailyCap_holdsAcrossDays(uint256[12] memory amounts, uint8[12] memory gaps) public {
        // via-ir may cache block.timestamp across vm.warp inside one test, so track time here.
        uint256 spentThisDay;
        uint256 now_ = vm.getBlockTimestamp();
        uint256 day = now_ / 1 days;
        for (uint256 i = 0; i < amounts.length; i++) {
            now_ += bound(gaps[i], 0, 48) * 1 hours; // 12 steps stay inside the agent's 30-day expiry
            vm.warp(now_);
            if (now_ / 1 days != day) {
                day = now_ / 1 days;
                spentThisDay = 0;
            }
            uint256 amount = bound(amounts[i], 1, VENDOR_CAP);
            VendorSig.Invoice memory invoice = _invoice(keccak256(abi.encode("fuzz", i)), amount);
            bytes memory sig = _signInvoice(vendor, invoice);
            vm.prank(agent);
            if (spentThisDay + amount > DAILY_CAP) {
                vm.expectRevert(
                    abi.encodeWithSelector(PayGate.OverDailyCap.selector, spentThisDay, amount, DAILY_CAP)
                );
                gate.pay(invoice, sig);
            } else {
                gate.pay(invoice, sig);
                spentThisDay += amount;
            }
            assertLe(gate.spentToday(), DAILY_CAP);
            assertEq(gate.spentToday(), spentThisDay);
        }
    }

    function testFuzz_pay_anyFieldChangeBreaksTheSignature(uint8 field, uint256 delta) public {
        delta = bound(delta, 1, 1e12);
        VendorSig.Invoice memory invoice = _invoice(INV1, 100e6);
        bytes memory sig = _signInvoice(vendor, invoice);
        field = uint8(bound(field, 0, 2));
        if (field == 0) invoice.amount = invoice.amount + delta > VENDOR_CAP ? invoice.amount - 1 : invoice.amount + delta;
        else if (field == 1) invoice.invoiceId = bytes32(uint256(invoice.invoiceId) ^ delta);
        else invoice.dueDate += delta;
        vm.prank(agent);
        vm.expectRevert(PqAuth.SignatureInvalid.selector);
        gate.pay(invoice, sig);
    }

    function testFuzz_ownerDeadline(uint256 ttl) public {
        ttl = bound(ttl, 0, 60 days);
        _queue(_invoice(INV1, 5_000e6));
        uint256 deadline = block.timestamp + ttl;
        bytes32 args = gate.approveArgsHash(vendor, INV1, payout, 5_000e6);
        bytes memory sig = _ownerSig(gate.ACTION_APPROVE(), args, deadline);
        if (ttl > gate.OWNER_AUTH_TTL()) {
            vm.expectRevert(abi.encodeWithSelector(PqAuth.DeadlineTooFar.selector, deadline, gate.OWNER_AUTH_TTL()));
        }
        gate.approveQueued(vendor, INV1, deadline, sig);
    }

    // ================================================================ helpers

    function _pause() internal {
        uint256 deadline = block.timestamp + 1 hours;
        gate.pause(deadline, _ownerSig(gate.ACTION_PAUSE(), bytes32(0), deadline));
    }
}
