// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {PqAuth} from "haven-pq-kit/PqAuth.sol";
import {VendorSig} from "haven-pq-kit/VendorSig.sol";
import {PayGate} from "../src/PayGate.sol";
import {PayGateBase} from "./PayGateBase.sol";

contract VectorsTest is PayGateBase {
    function test_opHashesAndKeysMatchTypescript() public view {
        string memory json = vm.readFile("vectors/messages.json");

        address v = vm.parseJsonAddress(json, ".vendor");
        address p = vm.parseJsonAddress(json, ".payout");
        bytes32 invId = vm.parseJsonBytes32(json, ".approve.invoiceId");

        assertEq(gate.invoiceKey(v, invId), vm.parseJsonBytes32(json, ".invoiceKey"));

        bytes memory addParams = vm.parseJsonBytes(json, ".addVendor.params");
        assertEq(gate.opHashOf(PayGate.Op.AddVendor, addParams), vm.parseJsonBytes32(json, ".addVendor.opHash"));

        bytes memory payoutParams = vm.parseJsonBytes(json, ".setPayout.params");
        assertEq(gate.opHashOf(PayGate.Op.SetPayout, payoutParams), vm.parseJsonBytes32(json, ".setPayout.opHash"));

        uint256 approveAmount = vm.parseJsonUint(json, ".approve.amount");
        assertEq(
            gate.approveArgsHash(v, invId, p, approveAmount), vm.parseJsonBytes32(json, ".approve.argsHash")
        );
    }

    function test_invoiceMessageMatchesTypescript() public view {
        string memory json = vm.readFile("vectors/messages.json");
        VendorSig.Invoice memory invoice = VendorSig.Invoice({
            vendor: vm.parseJsonAddress(json, ".invoice.vendor"),
            payee: vm.parseJsonAddress(json, ".invoice.payee"),
            token: vm.parseJsonAddress(json, ".invoice.token"),
            amount: vm.parseJsonUint(json, ".invoice.amount"),
            invoiceId: vm.parseJsonBytes32(json, ".invoice.invoiceId"),
            dueDate: vm.parseJsonUint(json, ".invoice.dueDate"),
            memoHash: vm.parseJsonBytes32(json, ".invoice.memoHash")
        });
        bytes memory got =
            VendorSig.encode(vm.parseJsonUint(json, ".invoice.chainId"), vm.parseJsonAddress(json, ".invoice.gate"), invoice);
        assertEq(got, vm.parseJsonBytes(json, ".invoice.message"));
    }

    function test_ownerAuthMessagesMatchTypescript() public view {
        string memory json = vm.readFile("vectors/messages.json");
        bytes memory proposeMsg = PqAuth.encodeMessage(
            vm.parseJsonUint(json, ".ownerPropose.chainId"),
            vm.parseJsonAddress(json, ".ownerPropose.contract"),
            vm.parseJsonAddress(json, ".ownerPropose.signer"),
            vm.parseJsonBytes32(json, ".ownerPropose.action"),
            vm.parseJsonUint(json, ".ownerPropose.nonce"),
            vm.parseJsonUint(json, ".ownerPropose.deadline"),
            vm.parseJsonBytes32(json, ".ownerPropose.argsHash")
        );
        assertEq(proposeMsg, vm.parseJsonBytes(json, ".ownerPropose.message"));

        bytes memory approveMsg = PqAuth.encodeMessage(
            vm.parseJsonUint(json, ".ownerApprove.chainId"),
            vm.parseJsonAddress(json, ".ownerApprove.contract"),
            vm.parseJsonAddress(json, ".ownerApprove.signer"),
            vm.parseJsonBytes32(json, ".ownerApprove.action"),
            vm.parseJsonUint(json, ".ownerApprove.nonce"),
            vm.parseJsonUint(json, ".ownerApprove.deadline"),
            vm.parseJsonBytes32(json, ".ownerApprove.argsHash")
        );
        assertEq(approveMsg, vm.parseJsonBytes(json, ".ownerApprove.message"));
    }
}
