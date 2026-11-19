// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

/// @notice Test token: 6 decimals like fUSD, mint for anyone.
contract MockERC20 {
    string public constant name = "Mock fUSD";
    string public constant symbol = "fUSD";
    uint8 public constant decimals = 6;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;

    event Transfer(address indexed from, address indexed to, uint256 amount);

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external virtual returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }
}

/// @notice Says yes and moves nothing.
contract LyingERC20 is MockERC20 {
    function transfer(address, uint256) external pure override returns (bool) {
        return true;
    }
}
