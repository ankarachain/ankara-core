// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../base/AnkaraChainBaseToken.sol";

/**
 * @title InvoiceToken
 * @author PIE Drops Studio — Ankara Chain SDK
 * @notice Tokenized trade receivables for African SME financing.
 *
 * Represents a claim on a real invoice or trade receivable.
 * Use cases:
 * - SME invoice discounting
 * - Supply chain financing
 * - African export receivables
 * - Diaspora-backed business lending
 *
 * Lifecycle: PENDING → FUNDED → REPAID (or DEFAULTED)
 * The invoice lifecycle maps to the asset status enum.
 */
contract InvoiceToken is AnkaraChainBaseToken {

    struct InvoiceMetadata {
        string  invoiceNumber;          // Original invoice reference
        string  debtorReference;        // Off-chain identity reference of debtor
        uint256 faceValueUSD;           // Total invoice face value (18 decimal wei)
        uint256 discountRateBps;        // Financing discount in basis points
        uint256 issuanceDate;           // Invoice creation date (Unix timestamp)
        uint256 dueDate;                // Payment due date (Unix timestamp)
        bytes32 invoiceDocumentHash;    // IPFS CID of original invoice PDF
        string  currency;               // ISO 4217 (NGN, GHS, KES, ZAR, USD)
        uint256 lastUpdated;
    }

    enum InvoiceStatus { PENDING, FUNDED, REPAID, DEFAULTED }

    InvoiceMetadata private _metadata;
    InvoiceStatus private _invoiceStatus;
    uint256 public metadataVersion;

    event MetadataUpdated(uint256 indexed version, uint256 timestamp);
    event InvoiceStatusChanged(
        InvoiceStatus indexed oldStatus,
        InvoiceStatus indexed newStatus,
        uint256 timestamp
    );
    event InvoiceRepaid(uint256 faceValueUSD, uint256 timestamp);
    event InvoiceDefaulted(string reason, uint256 timestamp);

    uint256[50] private __gap;

    error InvoiceAlreadySettled();

    // ─── Initializer ────────────────────────────────────────────────────────

    function initialize(
        string memory name_,
        string memory symbol_,
        bytes32 assetId_,
        string memory countryCode_,
        address admin_,
        address verifier_,
        address feeRecipient_,
        InvoiceMetadata memory metadata_
    ) external initializer {
        __AnkaraChainBaseToken_init(
            name_, symbol_, assetId_, countryCode_,
            admin_, verifier_, feeRecipient_
        );
        _metadata = metadata_;
        _metadata.lastUpdated = block.timestamp;
        _invoiceStatus = InvoiceStatus.PENDING;
        metadataVersion = 1;
        emit MetadataUpdated(1, block.timestamp);
    }

    // ─── Reads ──────────────────────────────────────────────────────────────

    function getMetadata() external view returns (InvoiceMetadata memory) {
        return _metadata;
    }

    function invoiceStatus() external view returns (InvoiceStatus) {
        return _invoiceStatus;
    }

    function faceValueUSD() external view returns (uint256) {
        return _metadata.faceValueUSD;
    }

    function isOverdue() external view returns (bool) {
        return block.timestamp > _metadata.dueDate &&
               _invoiceStatus == InvoiceStatus.FUNDED;
    }

    function daysUntilDue() external view returns (int256) {
        return (int256(_metadata.dueDate) - int256(block.timestamp)) / 1 days;
    }

    // ─── Writes (MANAGER_ROLE) ───────────────────────────────────────────────

    function updateMetadata(InvoiceMetadata memory metadata_)
        external
        onlyRole(MANAGER_ROLE)
    {
        if (_invoiceStatus == InvoiceStatus.REPAID ||
            _invoiceStatus == InvoiceStatus.DEFAULTED) {
            revert InvoiceAlreadySettled();
        }
        _metadata = metadata_;
        _metadata.lastUpdated = block.timestamp;
        metadataVersion++;
        emit MetadataUpdated(metadataVersion, block.timestamp);
    }

    /**
     * @notice Mark invoice as funded — tokens have been issued to investors
     */
    function markFunded() external onlyRole(MANAGER_ROLE) {
        InvoiceStatus old = _invoiceStatus;
        _invoiceStatus = InvoiceStatus.FUNDED;
        _setStatus(AssetStatus.ACTIVE);
        emit InvoiceStatusChanged(old, InvoiceStatus.FUNDED, block.timestamp);
    }

    /**
     * @notice Mark invoice as repaid — debtor has paid
     * @dev Burns all tokens after repayment confirmation
     */
    function markRepaid() external onlyRole(MANAGER_ROLE) {
        if (_invoiceStatus == InvoiceStatus.REPAID ||
            _invoiceStatus == InvoiceStatus.DEFAULTED) {
            revert InvoiceAlreadySettled();
        }
        InvoiceStatus old = _invoiceStatus;
        _invoiceStatus = InvoiceStatus.REPAID;
        _setStatus(AssetStatus.REDEEMED);
        emit InvoiceRepaid(_metadata.faceValueUSD, block.timestamp);
        emit InvoiceStatusChanged(old, InvoiceStatus.REPAID, block.timestamp);
    }

    /**
     * @notice Mark invoice as defaulted
     * @param reason Human-readable reason for default
     */
    function markDefaulted(string memory reason) external onlyRole(MANAGER_ROLE) {
        if (_invoiceStatus == InvoiceStatus.REPAID ||
            _invoiceStatus == InvoiceStatus.DEFAULTED) {
            revert InvoiceAlreadySettled();
        }
        InvoiceStatus old = _invoiceStatus;
        _invoiceStatus = InvoiceStatus.DEFAULTED;
        _setStatus(AssetStatus.SUSPENDED);
        emit InvoiceDefaulted(reason, block.timestamp);
        emit InvoiceStatusChanged(old, InvoiceStatus.DEFAULTED, block.timestamp);
    }
}
