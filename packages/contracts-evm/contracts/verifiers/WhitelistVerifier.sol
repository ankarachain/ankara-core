// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IIdentityVerifier.sol";

/**
 * @title WhitelistVerifier
 * @author PIE Drops Studio
 * @notice Reference implementation of IIdentityVerifier using a simple whitelist.
 *
 * THIS IS FOR TESTING AND DEVELOPMENT ONLY.
 * In production, replace with a real KYC provider:
 * - Smile Identity on-chain attestation
 * - Persona webhook + oracle
 * - Nigeria BVN/NIN verifier
 * - Any on-chain identity attestation system
 *
 * Swap this out by calling token.setIdentityVerifier(newVerifier) — no redeployment needed.
 */
contract WhitelistVerifier is Ownable, IIdentityVerifier {

    string private constant _NAME = "WhitelistVerifier";

    mapping(address => bool) private _verified;

    constructor(address initialOwner) Ownable(initialOwner) {}

    function verifierName() external pure override returns (string memory) {
        return _NAME;
    }

    function isVerified(address account) external view override returns (bool) {
        return _verified[account];
    }

    function verifyIdentity(address account) external override onlyOwner {
        _verified[account] = true;
        emit IdentityVerified(account, block.timestamp);
    }

    function revokeIdentity(address account) external override onlyOwner {
        _verified[account] = false;
        emit IdentityRevoked(account, block.timestamp);
    }

    /// @notice Batch verify multiple addresses (saves gas for initial setup)
    function batchVerify(address[] calldata accounts) external onlyOwner {
        for (uint256 i = 0; i < accounts.length; i++) {
            _verified[accounts[i]] = true;
            emit IdentityVerified(accounts[i], block.timestamp);
        }
    }
}
