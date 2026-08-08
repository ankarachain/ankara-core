// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IIdentityVerifier
 * @author PIE Drops Studio
 * @notice Pluggable identity verification interface for Ankara Chain tokens.
 *
 * Ankara Chain does NOT implement KYC or AML. This interface defines the
 * standard hook that developers implement to connect their chosen identity
 * provider — Smile Identity, Persona, BVN/NIN verifier, or a whitelist.
 *
 * Swap providers at any time without redeploying your asset contracts.
 */
interface IIdentityVerifier {
    event IdentityVerified(address indexed account, uint256 timestamp);
    event IdentityRevoked(address indexed account, uint256 timestamp);

    /// @notice Check if an address is currently verified
    function isVerified(address account) external view returns (bool);

    /// @notice Verify an address (called by authorized identity agents)
    function verifyIdentity(address account) external;

    /// @notice Revoke verification for an address
    function revokeIdentity(address account) external;

    /// @notice Human-readable name of this verifier implementation
    function verifierName() external view returns (string memory);
}
