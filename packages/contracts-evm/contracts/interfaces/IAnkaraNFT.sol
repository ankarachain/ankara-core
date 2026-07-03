// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./IAnkaraChainToken.sol";

/**
 * @title IAnkaraNFT
 * @author Cranebolt Technologies
 * @notice Common interface shared by all Ankara Chain NFT asset record contracts.
 *         Mirrors the IAnkaraChainToken pattern for the ERC-721 layer.
 */
interface IAnkaraNFT {
    // Re-use the same status enum
    enum AssetStatus { DRAFT, ACTIVE, SUSPENDED, REDEEMED, EXPIRED }

    // ─── Events ───────────────────────────────────────────────────────────────
    event AssetStatusChanged(
        AssetStatus indexed oldStatus,
        AssetStatus indexed newStatus,
        uint256 timestamp
    );
    event IdentityVerifierUpdated(
        address indexed oldVerifier,
        address indexed newVerifier
    );
    event ERC20Linked(address indexed erc20Address);

    // ─── Reads ────────────────────────────────────────────────────────────────
    function assetId() external view returns (bytes32);
    function countryCode() external view returns (string memory);
    function status() external view returns (AssetStatus);
    function identityVerifier() external view returns (address);
    function linkedERC20() external view returns (address);

    // ─── Writes ───────────────────────────────────────────────────────────────
    function setStatus(AssetStatus newStatus) external;
    function setIdentityVerifier(address verifier) external;
    function linkToERC20(address erc20Address) external;
    function pause() external;
    function unpause() external;
}
