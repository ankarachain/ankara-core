// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IAnkaraChainToken
 * @author PIE Drops Studio
 * @notice Common interface shared by all Ankara Chain RWA tokens.
 */
interface IAnkaraChainToken {
    enum AssetStatus { DRAFT, ACTIVE, SUSPENDED, REDEEMED, EXPIRED }

    event AssetStatusChanged(
        AssetStatus indexed oldStatus,
        AssetStatus indexed newStatus,
        uint256 timestamp
    );
    event IdentityVerifierUpdated(
        address indexed oldVerifier,
        address indexed newVerifier
    );

    function assetId() external view returns (bytes32);
    function countryCode() external view returns (string memory);
    function status() external view returns (AssetStatus);
    function identityVerifier() external view returns (address);

    function setStatus(AssetStatus newStatus) external;
    function setIdentityVerifier(address verifier) external;
    function pause() external;
    function unpause() external;
}
