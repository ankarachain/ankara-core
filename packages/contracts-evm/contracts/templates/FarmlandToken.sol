// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../base/AnkaraChainBaseToken.sol";

/**
 * @title FarmlandToken
 * @author Cranebolt Technologies
 * @notice Ankara Chain template — tokenized agricultural land.
 *
 * Each token = 1 fractional share of the underlying land parcel.
 * Metadata stores GPS, area, soil type, title document hash, valuation.
 * Documents (title deed, survey) stored on IPFS — referenced by CID hash.
 *
 * Use cases: smallholder farm financing, cross-border farm investment,
 * diaspora investment in Nigerian/Ghanaian/Kenyan farmland.
 */
contract FarmlandToken is AnkaraChainBaseToken {

    struct FarmlandMetadata {
        string  location;           // GPS decimal degrees or cadastral ref
        uint256 areaSqMeters;       // Land area in square metres
        string  soilType;           // loam | clay | sandy | silt | peaty
        string  irrigationType;     // none | rain-fed | drip | canal | borehole
        string  cropHistory;        // Last 3 seasons (e.g. "maize,sorghum,fallow")
        bytes32 titleDocumentHash;  // IPFS CID of land title / C of O
        uint256 valuationUSD;       // Assessed value USD (18 decimal wei)
        string  stateRegion;        // State or province
        uint256 lastUpdated;        // Unix timestamp of last update
    }

    FarmlandMetadata private _metadata;
    uint256 public metadataVersion;

    event MetadataUpdated(uint256 indexed version, uint256 timestamp);
    event ValuationUpdated(uint256 oldValue, uint256 newValue, uint256 timestamp);

    uint256[50] private __gap;

    // ─── Initializer ────────────────────────────────────────────────────────

    function initialize(
        string memory name_,
        string memory symbol_,
        bytes32 assetId_,
        string memory countryCode_,
        address admin_,
        address verifier_,
        address feeRecipient_,
        FarmlandMetadata memory metadata_
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

    function getMetadata() external view returns (FarmlandMetadata memory) {
        return _metadata;
    }

    function valuationUSD() external view returns (uint256) {
        return _metadata.valuationUSD;
    }

    function titleDocumentHash() external view returns (bytes32) {
        return _metadata.titleDocumentHash;
    }

    function areaSqMeters() external view returns (uint256) {
        return _metadata.areaSqMeters;
    }

    // ─── Writes (MANAGER_ROLE) ───────────────────────────────────────────────

    function updateMetadata(FarmlandMetadata memory metadata_)
        external
        onlyRole(MANAGER_ROLE)
    {
        uint256 oldVal = _metadata.valuationUSD;
        _metadata = metadata_;
        _metadata.lastUpdated = block.timestamp;
        metadataVersion++;
        emit MetadataUpdated(metadataVersion, block.timestamp);
        if (oldVal != metadata_.valuationUSD) {
            emit ValuationUpdated(oldVal, metadata_.valuationUSD, block.timestamp);
        }
    }

    function updateValuation(uint256 newValuationUSD)
        external
        onlyRole(MANAGER_ROLE)
    {
        uint256 old = _metadata.valuationUSD;
        _metadata.valuationUSD = newValuationUSD;
        _metadata.lastUpdated = block.timestamp;
        metadataVersion++;
        emit ValuationUpdated(old, newValuationUSD, block.timestamp);
        emit MetadataUpdated(metadataVersion, block.timestamp);
    }

    function updateTitleDocument(bytes32 newHash)
        external
        onlyRole(MANAGER_ROLE)
    {
        _metadata.titleDocumentHash = newHash;
        _metadata.lastUpdated = block.timestamp;
        metadataVersion++;
        emit MetadataUpdated(metadataVersion, block.timestamp);
    }
}
