// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../base/AnkaraMultiToken.sol";

/**
 * @title CommodityBatchToken
 * @author Cranebolt Technologies
 * @notice Ankara Chain ERC-1155 template — tokenized warehouse commodity batches.
 *
 * One contract per warehouse/operator. One token ID per commodity batch (lot).
 * Tokens are fungible within a batch (fractional warehouse receipt shares).
 *
 * Use cases:
 * - Warehouse receipt financing (cocoa, coffee, maize, gold, etc.)
 * - Commodity collateral for DeFi protocols
 * - Supply chain provenance + custody tracking
 * - Cross-batch consolidation via mergeBatches()
 *
 * Architecture:
 * - Each batch is registered as a token ID with a BatchMetadata struct
 * - MANAGER_ROLE can expire, revalue, and merge compatible batches
 * - MINTER_ROLE can mint tokens against a registered batch
 * - Batch tokens are transferable subject to per-ID identity verification
 *
 * Deploy via MultiTokenFactory. Never deploy directly.
 */
contract CommodityBatchToken is AnkaraMultiToken {

    // ─── Structs ───────────────────────────────────────────────────────────

    struct WarehouseMetadata {
        string   warehouseId;           // Unique warehouse identifier (e.g. "WH-LAG-001")
        string   warehouseLocation;     // Physical location
        address  operatorAddress;       // Warehouse operator / custodian wallet
        bytes32  warehouseLicenseHash;  // IPFS CID of warehouse operating license
        uint256  certificationExpiry;   // Unix timestamp when warehouse cert expires
    }

    struct BatchMetadata {
        string   commodityType;         // cocoa | coffee | maize | gold | crude-oil | etc.
        uint256  quantityKg;            // Total quantity in this batch (kilograms)
        string   gradeClassification;   // e.g. "Grade A", "Premium", "Robusta"
        uint256  depositDate;           // Unix timestamp of deposit into warehouse
        uint256  expiryDate;            // Unix timestamp when batch expires / must be sold
        bytes32  inspectionReportHash;  // IPFS CID of inspection / quality report
        uint256  valuationUSD;          // Current USD valuation (18-decimal)
        string   harvestSeason;         // e.g. "2025-Q1", "Oct-Dec 2025"
        string   originCountry;         // ISO 3166-1 alpha-2 (e.g. "NG", "GH", "CI")
    }

    // ─── State ─────────────────────────────────────────────────────────────

    WarehouseMetadata private _warehouse;
    mapping(uint256 => BatchMetadata) private _batches;
    uint256[] private _batchIds;

    // ─── Storage gap ───────────────────────────────────────────────────────
    uint256[50] private __gap;

    // ─── Errors ────────────────────────────────────────────────────────────
    error BatchAlreadyRegistered(uint256 id);
    error BatchNotRegistered(uint256 id);
    error IncompatibleBatches(uint256 fromId, uint256 toId);
    error BatchIsExpired(uint256 id);

    // ─── Events ────────────────────────────────────────────────────────────

    event BatchRegistered(
        uint256 indexed id,
        string  commodityType,
        uint256 quantityKg
    );

    event BatchExpired(uint256 indexed id, uint256 timestamp);

    event BatchesMerged(
        uint256 indexed fromId,
        uint256 indexed toId,
        uint256 amount,
        address holder
    );

    event ValuationUpdated(
        uint256 indexed id,
        uint256 oldValuation,
        uint256 newValuation,
        uint256 timestamp
    );

    // ─── Initializer ───────────────────────────────────────────────────────

    function initialize(
        string memory name_,
        string memory countryCode_,
        string memory baseURI_,
        address admin_,
        WarehouseMetadata memory warehouse_
    ) external initializer {
        __AnkaraMultiToken_init(name_, countryCode_, baseURI_, admin_);
        _warehouse = warehouse_;
    }

    // ─── Batch registration ─────────────────────────────────────────────────

    /**
     * @notice Register a new commodity batch as a token ID.
     * @dev MANAGER_ROLE. Token ID must not already be registered.
     *      maxSupply of the TokenDefinition is set to batchMeta.quantityKg (1 token = 1 kg).
     */
    function registerBatch(uint256 id, BatchMetadata memory batchMeta)
        external
        onlyRole(MANAGER_ROLE)
    {
        if (_registered[id]) revert BatchAlreadyRegistered(id);

        TokenDefinition memory def = TokenDefinition({
            isFungible:  true,
            name:        batchMeta.commodityType,
            symbol:      "",
            maxSupply:   batchMeta.quantityKg,
            status:      AssetStatus.ACTIVE,
            metadataURI: ""
        });

        _registerTokenId(id, def);
        batchMeta.depositDate = block.timestamp;
        _batches[id]          = batchMeta;
        _batchIds.push(id);

        emit BatchRegistered(id, batchMeta.commodityType, batchMeta.quantityKg);
    }

    // ─── Batch management ───────────────────────────────────────────────────

    /**
     * @notice Update the USD valuation of a batch.
     * @dev MANAGER_ROLE. Emits ValuationUpdated with old and new values.
     */
    function updateBatchValuation(uint256 id, uint256 newValuationUSD)
        external
        onlyRole(MANAGER_ROLE)
    {
        if (!_registered[id]) revert BatchNotRegistered(id);
        uint256 old = _batches[id].valuationUSD;
        _batches[id].valuationUSD = newValuationUSD;
        emit ValuationUpdated(id, old, newValuationUSD, block.timestamp);
    }

    /**
     * @notice Administratively expire a batch before its natural expiry time.
     * @dev MANAGER_ROLE. Sets token ID status to EXPIRED and emits BatchExpired.
     *      Once expired, this batch is blocked from mergeBatches().
     */
    function expireBatch(uint256 id) external onlyRole(MANAGER_ROLE) {
        if (!_registered[id]) revert BatchNotRegistered(id);
        _setAssetStatus(id, AssetStatus.EXPIRED);
        emit BatchExpired(id, block.timestamp);
    }

    /**
     * @notice Merge `amount` tokens of batch `fromId` into batch `toId`.
     * @dev MANAGER_ROLE. Both batches must share the same commodity type and
     *      grade classification. Neither may be expired. Burns from `holder`
     *      (internal, bypassing approval — manager-authorised operation).
     *      Updates total supply for both IDs.
     */
    function mergeBatches(
        uint256 fromId,
        uint256 toId,
        uint256 amount,
        address holder
    ) external onlyRole(MANAGER_ROLE) {
        if (!_registered[fromId]) revert BatchNotRegistered(fromId);
        if (!_registered[toId])   revert BatchNotRegistered(toId);

        BatchMetadata storage fromBatch = _batches[fromId];
        BatchMetadata storage toBatch   = _batches[toId];

        // Validate compatibility: same commodity type and grade
        if (
            keccak256(bytes(fromBatch.commodityType))       != keccak256(bytes(toBatch.commodityType)) ||
            keccak256(bytes(fromBatch.gradeClassification)) != keccak256(bytes(toBatch.gradeClassification))
        ) {
            revert IncompatibleBatches(fromId, toId);
        }

        // Neither batch may be naturally or administratively expired
        if (_isExpiredById(fromId)) revert BatchIsExpired(fromId);
        if (_isExpiredById(toId))   revert BatchIsExpired(toId);

        // Internal burn/mint — bypasses the public burn() approval check.
        // _idTotalSupply is internal in AnkaraMultiToken so we update it directly.
        _burn(holder, fromId, amount);
        _idTotalSupply[fromId] -= amount;

        _mint(holder, toId, amount, "");
        _idTotalSupply[toId] += amount;

        emit BatchesMerged(fromId, toId, amount, holder);
    }

    // ─── Reads ──────────────────────────────────────────────────────────────

    function getBatchMetadata(uint256 id) external view returns (BatchMetadata memory) {
        return _batches[id];
    }

    function getWarehouseMetadata() external view returns (WarehouseMetadata memory) {
        return _warehouse;
    }

    /**
     * @notice Returns true if the batch has passed its natural expiry time.
     * @dev Note: a batch can also be administratively expired via expireBatch()
     *      which sets status to EXPIRED (detectable via getTokenDefinition().status).
     *      This function only checks the timestamp-based expiry.
     */
    function isExpired(uint256 id) external view returns (bool) {
        return _isExpiredById(id);
    }

    /**
     * @notice Count of batch IDs whose natural expiry date has not yet passed.
     */
    function activeBatchCount() external view returns (uint256 count) {
        for (uint256 i = 0; i < _batchIds.length; i++) {
            if (!_isExpiredById(_batchIds[i])) {
                count++;
            }
        }
    }

    function batchIds() external view returns (uint256[] memory) {
        return _batchIds;
    }

    // ─── Internal helpers ────────────────────────────────────────────────────

    function _isExpiredById(uint256 id) internal view returns (bool) {
        // Administratively expired via expireBatch()
        if (_tokenDefs[id].status == AssetStatus.EXPIRED) return true;
        // Naturally expired by timestamp
        uint256 expiry = _batches[id].expiryDate;
        return expiry > 0 && block.timestamp > expiry;
    }
}
