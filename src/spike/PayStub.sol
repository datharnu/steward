// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.28;

/// @notice Spike target only. It holds nothing and pays nothing. The real gate is PayGate.
contract PayStub {
    event Paid(address indexed caller);

    function pay() external {
        emit Paid(msg.sender);
    }
}
