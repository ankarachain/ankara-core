// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../base/AnkaraChainBaseToken.sol";

/**
 * @title CommodityReceiptToken
 * @author Cranebolt Technologies
 * @notice Ankara Chain template — tokenized warehouse commodity receipts.
 *
 * Represents a claim on physical commodity in a certified warehouse.
 * Use cases: cocoa/coffee/maize financing, cooperative receipt financing,
 * cross-border commodity trade settlement.
 */
contract CommodityReceiptToken is AnkaraChainBaseToken {

    struct CommodityMetadata {
        string  commodityType;          // cocoa|coffee|maize|cotton|soybean|palm-oil
        uint256 quantityKg;             // Quantity in kilograms
        string  gradeClassification;    // e.g. "Grade A", "FAQ", "GC1"
        string  warehouseId;            // Certified warehouse identifier
        string  warehouseLocation;      // GPS or address of storage
        uint256 depositDate;            // Unix timestamp of deposit
        uint256 expiryDate;             // Unix timestamp of receipt expiry
        bytes32 inspectionReportHash;   // IPFS CID of inspection report
        uint256 valuationUSD;           // Market value at issuance (18 decimal)
        string  harvestSeason;          // e.g. "2025/2026"
        uint256 lastUpdated;
    }

    CommodityMetadata private _metadata;
    uint256 public metadataVersion;

    event MetadataUpdated(uint256 indexed version, uint256 timestamp);
    event ReceiptExpired(bytes32 indexed assetId_, uint256 timestamp);

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
        CommodityMetadata memory metadata_
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

    function getMetadata() external view returns (CommodityMetadata memory) {
        return _metadata;
    }

    function isExpired() external view returns (bool) {
        return block.timestamp > _metadata.expiryDate;
    }

    function commodityType() external view returns (string memory) {
        return _metadata.commodityType;
    }

    function quantityKg() external view returns (uint256) {
        return _metadata.quantityKg;
    }

    function valuationUSD() external view returns (uint256) {
        return _metadata.valuationUSD;
    }

    // ─── Writes (MANAGER_ROLE) ───────────────────────────────────────────────

    function updateMetadata(CommodityMetadata memory metadata_)
        external
        onlyRole(MANAGER_ROLE)
    {
        _metadata = metadata_;
        _metadata.lastUpdated = block.timestamp;
        metadataVersion++;
        emit MetadataUpdated(metadataVersion, block.timestamp);
    }

    function markExpired() external onlyRole(MANAGER_ROLE) {
        _setStatus(AssetStatus.EXPIRED);
        emit ReceiptExpired(this.assetId(), block.timestamp);
    }
}
