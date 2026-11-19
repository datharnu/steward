// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {PqAuth} from "haven-pq-kit/PqAuth.sol";
import {VendorSig} from "haven-pq-kit/VendorSig.sol";
import {PqTestBase} from "haven-pq-kit-test/PqTestBase.sol";
import {PayGate} from "../src/PayGate.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @notice A funded gate, one approved vendor, and helpers that sign like the real clients do.
contract PayGateBase is PqTestBase {
    PayGate internal gate;
    MockERC20 internal fusd;

    address internal owner = address(0x0A11CE);
    address internal agent = address(0xA6E7);
    address internal vendor = address(0xE11A);
    address internal payout = address(0xB0B);
    address internal attacker = address(0xBAD);

    uint256 internal constant DELAY = 15 minutes;
    uint256 internal constant VENDOR_CAP = 1_000e6;
    uint256 internal constant DAILY_CAP = 2_500e6;
    uint256 internal constant FUNDING = 100_000e6;

    function setUp() public virtual override {
        super.setUp();
        _register(owner);
        _register(vendor);
        _register(attacker);
        fusd = new MockERC20();
        gate = new PayGate(owner, address(fusd), DELAY, agent, block.timestamp + 30 days, DAILY_CAP);
        fusd.mint(address(gate), FUNDING);
        _timelocked(PayGate.Op.AddVendor, abi.encode(vendor, payout, VENDOR_CAP));
    }

    // ---- invoices

    function _invoice(bytes32 id, uint256 amount) internal view returns (VendorSig.Invoice memory) {
        return VendorSig.Invoice({
            vendor: vendor,
            payee: payout,
            token: address(fusd),
            amount: amount,
            invoiceId: id,
            dueDate: block.timestamp + 14 days,
            memoHash: keccak256("services, November")
        });
    }

    function _signInvoice(address signer, VendorSig.Invoice memory invoice) internal view returns (bytes memory) {
        return _sign(signer, gate.invoiceMessage(invoice));
    }

    function _pay(VendorSig.Invoice memory invoice) internal {
        bytes memory sig = _signInvoice(invoice.vendor, invoice);
        vm.prank(agent);
        gate.pay(invoice, sig);
    }

    function _queue(VendorSig.Invoice memory invoice) internal {
        bytes memory sig = _signInvoice(invoice.vendor, invoice);
        vm.prank(agent);
        gate.queue(invoice, sig);
    }

    // ---- owner signatures

    function _ownerSig(bytes32 action, bytes32 argsHash, uint256 deadline) internal view returns (bytes memory) {
        return _sign(owner, gate.ownerMessage(action, argsHash, deadline));
    }

    function _propose(PayGate.Op kind, bytes memory params) internal returns (bytes32 opHash) {
        opHash = keccak256(abi.encode(uint8(kind), params));
        uint256 deadline = block.timestamp + 1 hours;
        gate.propose(kind, params, deadline, _ownerSig(gate.ACTION_PROPOSE(), opHash, deadline));
    }

    function _timelocked(PayGate.Op kind, bytes memory params) internal {
        _propose(kind, params);
        vm.warp(block.timestamp + DELAY);
        gate.execute(kind, params);
    }

    function _approve(address v, bytes32 id) internal {
        (address payee, uint256 amount,,) = gate.queued(gate.invoiceKey(v, id));
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _ownerSig(gate.ACTION_APPROVE(), gate.approveArgsHash(v, id, payee, amount), deadline);
        gate.approveQueued(v, id, deadline, sig);
    }
}
