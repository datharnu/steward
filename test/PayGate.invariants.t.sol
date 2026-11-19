// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PqAuth} from "haven-pq-kit/PqAuth.sol";
import {VendorSig} from "haven-pq-kit/VendorSig.sol";
import {PqTestKeys} from "haven-pq-kit-test/PqTestKeys.sol";
import {PayGate} from "../src/PayGate.sol";
import {PayGateBase} from "./PayGateBase.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @notice Random honest work mixed with every attack the agent, a stranger or a forger can make.
/// Any hostile call that does not revert is counted, and the count must stay zero.
contract GateHandler is Test {
    PayGate public immutable gate;
    MockERC20 public immutable fusd;
    address public immutable owner;
    address public immutable agent;
    address public immutable vendor;
    address public immutable payout;
    address public immutable attacker;
    uint256 public immutable vendorCap;

    uint256 public ghostPaid;
    uint256 public ghostPaidCount;
    uint256 public hostileAccepted;
    uint256 internal nextId;

    VendorSig.Invoice[] internal paid;
    bytes[] internal paidSigs;
    bytes32[] internal queuedIds;
    uint256[] public daysTouched;
    mapping(uint256 => bool) internal dayKnown;

    constructor(PayGate gate_, MockERC20 fusd_, address[5] memory who, uint256 vendorCap_) {
        gate = gate_;
        fusd = fusd_;
        owner = who[0];
        agent = who[1];
        vendor = who[2];
        payout = who[3];
        attacker = who[4];
        vendorCap = vendorCap_;
    }

    function daysTouchedLength() external view returns (uint256) {
        return daysTouched.length;
    }

    // ------------------------------------------------------------ honest

    function payHonest(uint256 amountSeed) public {
        VendorSig.Invoice memory invoice = _fresh(bound(amountSeed, 1, vendorCap * 3 / 2));
        bytes memory sig = _vendorSign(vendor, invoice);
        _touchToday();
        vm.prank(agent);
        try gate.pay(invoice, sig) {
            ghostPaid += invoice.amount;
            ghostPaidCount += 1;
            if (paid.length < 32) {
                paid.push(invoice);
                paidSigs.push(sig);
            }
        } catch {}
    }

    /// @dev Several invoices inside one hour, so the daily cap is actually under pressure.
    function payBurst(uint256 seed) external {
        for (uint256 i = 0; i < 4; i++) {
            payHonest(uint256(keccak256(abi.encode(seed, i))));
        }
    }

    function queueHonest(uint256 amountSeed) external {
        VendorSig.Invoice memory invoice = _fresh(bound(amountSeed, 1, vendorCap * 4));
        bytes memory sig = _vendorSign(vendor, invoice);
        vm.prank(agent);
        try gate.queue(invoice, sig) {
            queuedIds.push(invoice.invoiceId);
        } catch {}
    }

    function approveHonest(uint256 index) external {
        if (queuedIds.length == 0) return;
        bytes32 id = queuedIds[bound(index, 0, queuedIds.length - 1)];
        bytes32 key = gate.invoiceKey(vendor, id);
        if (gate.invoiceState(key) != PayGate.InvoiceState.Queued) return;
        (address payee, uint256 amount,,) = gate.queued(key);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = PqTestKeys.sign(
            owner, gate.ownerMessage(gate.ACTION_APPROVE(), gate.approveArgsHash(vendor, id, payee, amount), deadline)
        );
        try gate.approveQueued(vendor, id, deadline, sig) {
            ghostPaid += amount;
            ghostPaidCount += 1;
        } catch {}
    }

    function warp(uint256 hoursSeed) external {
        vm.warp(block.timestamp + bound(hoursSeed, 1, 8) * 1 hours);
    }

    // ------------------------------------------------------------ hostile

    function replayPaid(uint256 index) external {
        if (paid.length == 0) return;
        uint256 i = bound(index, 0, paid.length - 1);
        vm.prank(agent);
        try gate.pay(paid[i], paidSigs[i]) {
            hostileAccepted += 1;
        } catch {}
    }

    function forgedByAttacker(uint256 amountSeed) external {
        VendorSig.Invoice memory invoice = _fresh(bound(amountSeed, 1, vendorCap));
        bytes memory sig = _vendorSign(attacker, invoice);
        vm.prank(agent);
        try gate.pay(invoice, sig) {
            hostileAccepted += 1;
        } catch {}
    }

    /// @dev The prompt-injected agent, with a real vendor signature, but naming the attacker as payee.
    function redirectToAttacker(uint256 amountSeed) external {
        VendorSig.Invoice memory invoice = _fresh(bound(amountSeed, 1, vendorCap));
        invoice.payee = attacker;
        bytes memory sig = _vendorSign(vendor, invoice);
        vm.prank(agent);
        try gate.pay(invoice, sig) {
            hostileAccepted += 1;
        } catch {}
    }

    function attackerAsVendor(uint256 amountSeed) external {
        VendorSig.Invoice memory invoice = _fresh(bound(amountSeed, 1, vendorCap));
        invoice.vendor = attacker;
        invoice.payee = attacker;
        bytes memory sig = _vendorSign(attacker, invoice);
        vm.prank(agent);
        try gate.pay(invoice, sig) {
            hostileAccepted += 1;
        } catch {}
    }

    function strangerCallsPay(uint256 amountSeed) external {
        VendorSig.Invoice memory invoice = _fresh(bound(amountSeed, 1, vendorCap));
        bytes memory sig = _vendorSign(vendor, invoice);
        vm.prank(attacker);
        try gate.pay(invoice, sig) {
            hostileAccepted += 1;
        } catch {}
    }

    function classicalSignature(uint256 amountSeed, bytes32 junk) external {
        VendorSig.Invoice memory invoice = _fresh(bound(amountSeed, 1, vendorCap));
        bytes memory sig = abi.encodePacked(junk, junk, uint8(27));
        vm.prank(agent);
        try gate.pay(invoice, sig) {
            hostileAccepted += 1;
        } catch {}
    }

    function tamperedAmount(uint256 amountSeed, uint256 delta) external {
        VendorSig.Invoice memory invoice = _fresh(bound(amountSeed, 1, vendorCap / 2));
        bytes memory sig = _vendorSign(vendor, invoice);
        invoice.amount += bound(delta, 1, vendorCap / 2);
        vm.prank(agent);
        try gate.pay(invoice, sig) {
            hostileAccepted += 1;
        } catch {}
    }

    function attackerApproves(uint256 index) external {
        if (queuedIds.length == 0) return;
        bytes32 id = queuedIds[bound(index, 0, queuedIds.length - 1)];
        bytes32 key = gate.invoiceKey(vendor, id);
        if (gate.invoiceState(key) != PayGate.InvoiceState.Queued) return;
        (address payee, uint256 amount,,) = gate.queued(key);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = PqTestKeys.sign(
            attacker,
            gate.ownerMessage(gate.ACTION_APPROVE(), gate.approveArgsHash(vendor, id, payee, amount), deadline)
        );
        try gate.approveQueued(vendor, id, deadline, sig) {
            hostileAccepted += 1;
        } catch {}
    }

    function attackerProposesPayout() external {
        bytes memory params = abi.encode(vendor, attacker);
        bytes32 opHash = keccak256(abi.encode(uint8(PayGate.Op.SetPayout), params));
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = PqTestKeys.sign(attacker, gate.ownerMessage(gate.ACTION_PROPOSE(), opHash, deadline));
        try gate.propose(PayGate.Op.SetPayout, params, deadline, sig) {
            hostileAccepted += 1;
        } catch {}
    }

    // ------------------------------------------------------------ helpers

    function _fresh(uint256 amount) internal returns (VendorSig.Invoice memory) {
        nextId += 1;
        return VendorSig.Invoice({
            vendor: vendor,
            payee: payout,
            token: address(fusd),
            amount: amount,
            invoiceId: keccak256(abi.encode("handler", nextId)),
            dueDate: block.timestamp + 14 days,
            memoHash: bytes32(nextId)
        });
    }

    function _vendorSign(address signer, VendorSig.Invoice memory invoice) internal view returns (bytes memory) {
        return PqTestKeys.sign(signer, gate.invoiceMessage(invoice));
    }

    function _touchToday() internal {
        uint256 day = block.timestamp / 1 days;
        if (!dayKnown[day]) {
            dayKnown[day] = true;
            daysTouched.push(day);
        }
    }
}

contract PayGateInvariants is PayGateBase {
    GateHandler internal handler;

    function setUp() public override {
        super.setUp();
        // Keep the agent live for the whole run.
        _timelocked(PayGate.Op.SetAgent, abi.encode(agent, block.timestamp + 3650 days));
        handler = new GateHandler(gate, fusd, [owner, agent, vendor, payout, attacker], VENDOR_CAP);
        targetContract(address(handler));
    }

    /// @notice No forged, redirected, replayed, stranger or classical call ever succeeded.
    function invariant_noHostileCallSucceeds() public view {
        assertEq(handler.hostileAccepted(), 0);
    }

    /// @notice Money only leaves to the vendor's registered payout, and none is created or lost.
    function invariant_tokenConservation() public view {
        assertEq(fusd.balanceOf(address(gate)) + fusd.balanceOf(payout), FUNDING);
        assertEq(fusd.balanceOf(attacker), 0);
        assertEq(fusd.balanceOf(agent), 0);
    }

    /// @notice The payout received exactly the sum of distinct signed invoices that succeeded: nothing twice.
    function invariant_eachInvoicePaidOnce() public view {
        assertEq(fusd.balanceOf(payout), handler.ghostPaid());
    }

    /// @notice No day's agent spending ever went over the daily cap.
    function invariant_noDayOverTheCap() public view {
        uint256 n = handler.daysTouchedLength();
        for (uint256 i = 0; i < n; i++) {
            assertLe(gate.spentOnDay(handler.daysTouched(i)), gate.dailyCap());
        }
    }
}
