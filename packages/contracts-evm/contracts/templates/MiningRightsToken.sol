// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../base/AnkaraChainBaseToken.sol";

/**
 * @title MiningRightsToken
 * @author Cranebolt Technologies — Ankara Chain SDK
 * @notice Tokenized mineral rights for African mining projects.
 *
 * Each token = 1 fractional share of a mining license or concession.
 * Use cases:
 * - Artisanal and small-scale mining (ASM) financing
 * - Junior miner capital raising
 * - Mineral royalty tokenization
 * - Nigerian / Zambian / DRC / Ghanaian mineral rights
 *
 * Royalty events are declared on-chain by the operator;
 * actual payment distribution is off-chain or via a separate contract.
 */
contract MiningRightsToken is AnkaraChainBaseToken {

    struct MiningRightsMetadata {
        string  licenseNumber;          // Official mining license number
        string  mineralType;            // Gold | Coltan | Copper | Diamond | Coal | Lithium
        string  concessionArea;         // GPS boundary or survey reference
        uint256 areaHectares;           // Concession area in hectares
        uint256 licenseExpiry;          // Unix timestamp of license expiry
        string  issuingAuthority;       // Government body (e.g. "Nigerian Mining Cadastre")
        bytes32 licenseDocumentHash;    // IPFS CID of mining license
        uint256 royaltyRateBps;         // Royalty to token holders on extraction (basis points)
        uint256 lastUpdated;
    }

    MiningRightsMetadata private _metadata;
    uint256 public metadataVersion;

    /// @notice Cumulative royalties declared (18 decimal wei, USD)
    uint256 public totalRoyaltiesDeclared;

    event MetadataUpdated(uint256 indexed version, uint256 timestamp);
    event LicenseExpired(bytes32 indexed assetId, uint256 timestamp);
    event RoyaltyDeclared(
        uint256 extractionValueUSD,
        uint256 royaltyAmountUSD,
        uint256 perTokenUSD,
        uint256 timestamp
    );
    event LicenseRenewed(uint256 oldExpiry, uint256 newExpiry, uint256 timestamp);

    uint256[50] private __gap;

    error LicenseAlreadyExpired();

    // ─── Initializer ────────────────────────────────────────────────────────

    function initialize(
        string memory name_,
        string memory symbol_,
        bytes32 assetId_,
        string memory countryCode_,
        address admin_,
        address verifier_,
        address feeRecipient_,
        MiningRightsMetadata memory metadata_
    ) external initializer {
        __AnkaraChainBaseToken_init(
            name_, symbol_, assetId_, countryCode_,
            admin_, verifier_, feeRecipient_
        );
        _metadata = metadata_;
        _metadata.lastUpdated = block.timestamp;
        metadataVersion = 1;
        emit MetadataUpdated(1, block.timestamp);
    }

    // ─── Reads ──────────────────────────────────────────────────────────────

    function getMetadata() external view returns (MiningRightsMetadata memory) {
        return _metadata;
    }

    function isLicenseExpired() external view returns (bool) {
        return block.timestamp > _metadata.licenseExpiry;
    }

    function daysUntilExpiry() external view returns (int256) {
        return (int256(_metadata.licenseExpiry) - int256(block.timestamp)) / 1 days;
    }

    function mineralType() external view returns (string memory) {
        return _metadata.mineralType;
    }

    function royaltyRateBps() external view returns (uint256) {
        return _metadata.royaltyRateBps;
    }

    function areaHectares() external view returns (uint256) {
        return _metadata.areaHectares;
    }

    // ─── Writes (MANAGER_ROLE) ───────────────────────────────────────────────

    function updateMetadata(MiningRightsMetadata memory metadata_)
        external
        onlyRole(MANAGER_ROLE)
    {
        _metadata = metadata_;
        _metadata.lastUpdated = block.timestamp;
        metadataVersion++;
        emit MetadataUpdated(metadataVersion, block.timestamp);
    }

    /**
     * @notice Declare a royalty distribution from extraction activity.
     * @param extractionValueUSD Total value of minerals extracted (18 decimal wei)
     */
    function declareRoyalty(uint256 extractionValueUSD)
        external
        onlyRole(MANAGER_ROLE)
    {
        uint256 supply = totalSupply();
        require(supply > 0, "No tokens in circulation");
        uint256 royaltyAmount = (extractionValueUSD * _metadata.royaltyRateBps) / 10000;
        uint256 perToken = royaltyAmount / supply;
        totalRoyaltiesDeclared += royaltyAmount;
        emit RoyaltyDeclared(
            extractionValueUSD,
            royaltyAmount,
            perToken,
            block.timestamp
        );
    }

    /**
     * @notice Renew the mining license with a new expiry date.
     */
    function renewLicense(uint256 newExpiry) external onlyRole(MANAGER_ROLE) {
        uint256 old = _metadata.licenseExpiry;
        _metadata.licenseExpiry = newExpiry;
        _metadata.lastUpdated = block.timestamp;
        metadataVersion++;
        emit LicenseRenewed(old, newExpiry, block.timestamp);
        emit MetadataUpdated(metadataVersion, block.timestamp);
    }

    /**
     * @notice Mark license as expired and update asset status.
     */
    function markLicenseExpired() external onlyRole(MANAGER_ROLE) {
        if (block.timestamp <= _metadata.licenseExpiry) revert LicenseAlreadyExpired();
        this.setStatus(AssetStatus.EXPIRED);
        emit LicenseExpired(this.assetId(), block.timestamp);
    }
}
