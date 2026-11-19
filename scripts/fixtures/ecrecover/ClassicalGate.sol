// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

/// @notice Fixture for `npm run cbom:check`: the check must refuse this. Not compiled or deployed.
contract ClassicalGate {
    address internal constant OWNER = 0x1111111111111111111111111111111111111111;

    function allowed(bytes32 digest, uint8 v, bytes32 r, bytes32 s) external pure returns (bool) {
        return ecrecover(digest, v, r, s) == OWNER;
    }
}
