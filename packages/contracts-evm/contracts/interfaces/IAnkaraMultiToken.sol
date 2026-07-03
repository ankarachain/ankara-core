// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IAnkaraMultiToken
 * @author Cranebolt Technologies
 * @notice Common interface for all Ankara Chain ERC-1155 multi-token contracts.
 *         Mirrors the IAnkaraNFT pattern for the ERC-1155 layer.
 *
 *         Key difference from ERC-20/ERC-721: identity verification is
 *         per-token-ID — different token IDs within the same contract can
 *         have different identity rules.
 */
interface IAnkaraMultiToken {

    // ─── Enums ────────────────────────────────────────────────────────────────

    enum AssetStatus { DRAFT, ACTIVE, SUSPENDED, REDEEMED, EXPIRED }

    // ─── Structs ──────────────────────────────────────────────────────────────

    struct TokenDefinition {
        bool        isFungible;   // true = fungible fractional shares; false = non-fungible unit
        string      name;         // Human-readable name for this token ID
        string      symbol;       // Short symbol
        uint256     maxSupply;    // 0 = unlimited; > 0 = hard cap
        AssetStatus status;       // Lifecycle status for this token ID
        string      metadataURI;  // IPFS URI for token-level metadata JSON
    }

    // ─── Events ───────────────────────────────────────────────────────────────

    event TokenIdRegistered(
        uint256 indexed id,
        bool    isFungible,
        string  name
    );

    event TokenVerifierUpdated(
        uint256 indexed id,
        address indexed oldVerifier,
        address indexed newVerifier
    );

    event TokenStatusChanged(
        uint256 indexed id,
        AssetStatus oldStatus,
        AssetStatus newStatus,
        uint256 timestamp
    );

    // ─── Reads ────────────────────────────────────────────────────────────────

    function getTokenDefinition(uint256 id) external view returns (TokenDefinition memory);
    function isRegistered(uint256 id) external view returns (bool);
    function totalSupply(uint256 id) external view returns (uint256);

    // ─── Writes ───────────────────────────────────────────────────────────────

    function registerTokenId(uint256 id, TokenDefinition calldata def) external;
    function setTokenVerifier(uint256 id, address verifier) external;
    function setAssetStatus(uint256 id, AssetStatus newStatus) external;
    function pause() external;
    function unpause() external;
}
