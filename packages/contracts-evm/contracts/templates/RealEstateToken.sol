// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../base/AnkaraChainBaseToken.sol";

/**
 * @title RealEstateToken
 * @author Cranebolt Technologies — Ankara Chain SDK
 * @notice Fractional ownership shares in African real estate.
 *
 * Each token = 1 fractional share of the underlying property.
 * Use cases:
 * - Diaspora investment in Lagos / Nairobi / Accra / Cape Town property
 * - Off-plan development financing
 * - Commercial property fractionalisation
 *
 * Rental income distribution is triggered by the platform operator
 * via distributeRental() — actual payment logic lives off-chain
 * or in a separate distribution contract. This contract tracks
 * the declaration and emits an event for indexers.
 */
contract RealEstateToken is AnkaraChainBaseToken {

    struct RealEstateMetadata {
        string  propertyId;           // Land registry reference number
        string  propertyType;         // Residential | Commercial | Industrial | Land
        string  locationAddress;      // Physical address with GPS coordinates
        uint256 totalAreaSqMeters;    // Total property area in square metres
        bytes32 titleDocumentHash;    // IPFS CID of title deed / C of O
        uint256 valuationUSD;         // Current market valuation (18 decimal wei)
        uint256 rentalYieldBps;       // Annual rental yield in basis points (600 = 6%)
        string  occupancyStatus;      // Vacant | Owner-occupied | Tenanted
        address developerAddress;     // Developer / property owner on-chain address
        uint256 lastUpdated;
    }

    RealEstateMetadata private _metadata;
    uint256 public metadataVersion;

    /// @notice Total rental income distributed so far (18 decimal wei, USD)
    uint256 public totalRentalDistributed;

    event MetadataUpdated(uint256 indexed version, uint256 timestamp);
    event ValuationUpdated(uint256 oldValue, uint256 newValue, uint256 timestamp);
    event OccupancyUpdated(string oldStatus, string newStatus, uint256 timestamp);
    event RentalDeclared(uint256 amountUSD, uint256 perTokenUSD, uint256 timestamp);

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
        RealEstateMetadata memory metadata_
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

    function getMetadata() external view returns (RealEstateMetadata memory) {
        return _metadata;
    }

    function valuationUSD() external view returns (uint256) {
        return _metadata.valuationUSD;
    }

    function rentalYieldBps() external view returns (uint256) {
        return _metadata.rentalYieldBps;
    }

    function occupancyStatus() external view returns (string memory) {
        return _metadata.occupancyStatus;
    }

    function titleDocumentHash() external view returns (bytes32) {
        return _metadata.titleDocumentHash;
    }

    // ─── Writes (MANAGER_ROLE) ───────────────────────────────────────────────

    function updateMetadata(RealEstateMetadata memory metadata_)
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

    function updateOccupancyStatus(string memory newStatus)
        external
        onlyRole(MANAGER_ROLE)
    {
        string memory old = _metadata.occupancyStatus;
        _metadata.occupancyStatus = newStatus;
        _metadata.lastUpdated = block.timestamp;
        metadataVersion++;
        emit OccupancyUpdated(old, newStatus, block.timestamp);
        emit MetadataUpdated(metadataVersion, block.timestamp);
    }

    /**
     * @notice Declare a rental income distribution event.
     * @dev Emits RentalDeclared for off-chain indexers to process.
     *      Actual payment distribution happens off-chain or via a
     *      separate distribution contract — this is the on-chain record.
     * @param amountUSD Total rental amount in USD (18 decimal wei)
     */
    function declareRentalDistribution(uint256 amountUSD)
        external
        onlyRole(MANAGER_ROLE)
    {
        uint256 supply = totalSupply();
        require(supply > 0, "No tokens in circulation");
        uint256 perToken = amountUSD / supply;
        totalRentalDistributed += amountUSD;
        emit RentalDeclared(amountUSD, perToken, block.timestamp);
    }
}
