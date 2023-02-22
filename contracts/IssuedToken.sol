// SPDX-License-Identifier: MIT
pragma solidity ^0.8.8;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract IssuedToken is ERC20 {
  address public immutable issuer;

  constructor(
    string memory name_,
    string memory symbol_,
    address issuer_
  ) ERC20(name_, symbol_) {
    issuer = issuer_;
  }

  function mint(address to, uint256 amount) external {
    require(msg.sender == issuer, "Only registered issuer can mint");
    _mint(to, amount);
  }
}