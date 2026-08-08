// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../base/AnkaraNFTBase.sol";

/**
 * @title RealEstateNFT
 * @author PIE Drops Studio
 * @notice Ankara Chain NFT template — unique on-chain property title deed.
 *
 * Each token = one unique property (residential, commercial, industrial or land).
 * Unlike the ERC-20 RealEstateToken (fractional shares), each NFT is a unique title.
 * Documents stored on IPFS — referenced by CID hash.
 *
 * Use cases: digital title registry, property transfer, mortgage collateral,
 * rental yield tracking, REIT on-chain governance.
 */
contract RealEstateNFT is AnkaraNFTBase {

    struct RealEstateNFTMetadata {
        string  propertyId;         // Registry / cadastral reference
        string  propertyType;       // Residential | Commercial | Industrial | Land
        string  locationAddress;    // Physical street address
        uint256 totalAreaSqMeters;  // Total floor / land area
        bytes32 titleDocumentHash;  // IPFS CID of title deed
        uint256 valuationUSD;       // Assessed value USD (18 decimal wei)
        uint256 rentalYieldBps;     // Annual rental yield in basis points
        address developerAddress;   // Developer / original issuer
        uint256 lastUpdated;        // Unix timestamp of last update
    }

    mapping(uint256 => RealEstateNFTMetadata) private _tokenMetadata;
    mapping(uint256 => uint256) public metadataVersion;

    event RealEstateNFTMinted(uint256 indexed tokenId, address indexed to, bytes32 assetId);
    event MetadataUpdated(uint256 indexed tokenId, uint256 version, uint256 timestamp);
    event ValuationUpdated(
        uint256 indexed tokenId,
        uint256 oldValue,
        uint256 newValue,
        uint256 timestamp
    );

    uint256[50] private __gap;

    // ─── Initializer ────────────────────────────────────────────────────────

    function initialize(
        string memory name_,
        string memory symbol_,
        bytes32 assetId_,
        string memory countryCode_,
        address admin_,
        address verifier_
    ) external initializer {
        __AnkaraNFTBase_init(name_, symbol_, assetId_, countryCode_, admin_, verifier_);
    }

    // ─── Minting ────────────────────────────────────────────────────────────

    function mint(address to, RealEstateNFTMetadata memory meta)
        external
        onlyRole(MINTER_ROLE)
        returns (uint256 tokenId)
    {
        tokenId = _mintNext(to);
        meta.lastUpdated = block.timestamp;
        _tokenMetadata[tokenId] = meta;
        metadataVersion[tokenId] = 1;
        emit RealEstateNFTMinted(tokenId, to, this.assetId());
        emit MetadataUpdated(tokenId, 1, block.timestamp);
    }

    // ─── Reads ──────────────────────────────────────────────────────────────

    function getMetadata(uint256 tokenId)
        external
        view
        returns (RealEstateNFTMetadata memory)
    {
        return _tokenMetadata[tokenId];
    }

    // ─── Writes (MANAGER_ROLE) ───────────────────────────────────────────────

    function updateMetadata(uint256 tokenId, RealEstateNFTMetadata memory meta)
        external
        onlyRole(MANAGER_ROLE)
    {
        uint256 oldVal = _tokenMetadata[tokenId].valuationUSD;
        meta.lastUpdated = block.timestamp;
        _tokenMetadata[tokenId] = meta;
        uint256 version = ++metadataVersion[tokenId];
        emit MetadataUpdated(tokenId, version, block.timestamp);
        if (oldVal != meta.valuationUSD) {
            emit ValuationUpdated(tokenId, oldVal, meta.valuationUSD, block.timestamp);
        }
    }

    function updateValuation(uint256 tokenId, uint256 newValuationUSD)
        external
        onlyRole(MANAGER_ROLE)
    {
        uint256 old = _tokenMetadata[tokenId].valuationUSD;
        _tokenMetadata[tokenId].valuationUSD = newValuationUSD;
        _tokenMetadata[tokenId].lastUpdated = block.timestamp;
        uint256 version = ++metadataVersion[tokenId];
        emit ValuationUpdated(tokenId, old, newValuationUSD, block.timestamp);
        emit MetadataUpdated(tokenId, version, block.timestamp);
    }
}
